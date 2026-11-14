import { describe, it, expect, vi, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let currentUserId: number | null = null;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

vi.mock("~/lib/session", () => ({
  getCurrentUserId: vi.fn(async () => currentUserId),
}));

import { action } from "./instructor.questions";

type ActionArgs = Parameters<typeof action>[0];

function callAction(fields: Record<string, string | number>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    body.set(key, String(value));
  }
  const request = new Request("http://localhost/instructor/questions", {
    method: "POST",
    body,
  });
  const args: ActionArgs = {
    request,
    url: new URL(request.url),
    pattern: "/instructor/questions",
    params: {},
    context: new RouterContextProvider(),
  };
  return action(args);
}

// `data(...)` from react-router throws a DataWithResponseInit, whose status
// lives on `init`.
async function thrownStatus(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "init" in error &&
      typeof error.init === "object" &&
      error.init !== null &&
      "status" in error.init
    ) {
      return error.init.status;
    }
    throw error;
  }
  return null;
}

function addUser(name: string, role: schema.UserRole) {
  return testDb
    .insert(schema.users)
    .values({ name, email: `${name}@example.com`, role })
    .returning()
    .get();
}

function comment(extra: Partial<typeof schema.comments.$inferInsert> = {}) {
  return testDb
    .insert(schema.comments)
    .values({ lessonId, userId: base.user.id, body: "text", ...extra })
    .returning()
    .get();
}

function getComment(id: number) {
  return testDb
    .select()
    .from(schema.comments)
    .where(eq(schema.comments.id, id))
    .get()!;
}

function activeFlags(commentId: number) {
  return testDb
    .select()
    .from(schema.commentFlags)
    .where(eq(schema.commentFlags.commentId, commentId))
    .all()
    .filter((f) => f.dismissedAt === null);
}

beforeEach(() => {
  testDb = createTestDb();
  base = seedBaseData(testDb);
  currentUserId = null;
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "M", position: 1 })
    .returning()
    .get();
  lessonId = testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: "L", position: 1 })
    .returning()
    .get().id;
});

describe("instructor questions action: moderation", () => {
  it("lets the course's instructor hide a flagged comment, resolving its flags", async () => {
    const flagger = addUser("flagger", schema.UserRole.Student);
    const c = comment();
    testDb
      .insert(schema.commentFlags)
      .values({ commentId: c.id, userId: flagger.id })
      .run();
    currentUserId = base.instructor.id;

    const result = await callAction({ intent: "hide", commentId: c.id });

    expect(result).toMatchObject({ ok: true });
    expect(getComment(c.id).hiddenById).toBe(base.instructor.id);
    expect(activeFlags(c.id)).toEqual([]);
  });

  it("lets an admin dismiss flags on any course", async () => {
    const admin = addUser("admin", schema.UserRole.Admin);
    const flagger = addUser("flagger", schema.UserRole.Student);
    const c = comment();
    testDb
      .insert(schema.commentFlags)
      .values({ commentId: c.id, userId: flagger.id })
      .run();
    currentUserId = admin.id;

    await callAction({ intent: "dismissFlags", commentId: c.id });

    expect(activeFlags(c.id)).toEqual([]);
    expect(getComment(c.id).hiddenAt).toBeNull();
  });

  it("refuses an instructor who isn't Staff for the comment's course", async () => {
    const otherInstructor = addUser("other", schema.UserRole.Instructor);
    const c = comment();
    currentUserId = otherInstructor.id;

    expect(
      await thrownStatus(callAction({ intent: "hide", commentId: c.id }))
    ).toBe(403);
    expect(getComment(c.id).hiddenAt).toBeNull();
  });

  it("refuses a student", async () => {
    const c = comment({ hiddenAt: "2026-01-01T00:00:00.000Z" });
    currentUserId = base.user.id;

    expect(
      await thrownStatus(callAction({ intent: "unhide", commentId: c.id }))
    ).toBe(403);
    expect(getComment(c.id).hiddenAt).not.toBeNull();
  });

  it("returns 404 for a missing comment", async () => {
    currentUserId = base.instructor.id;
    expect(
      await thrownStatus(callAction({ intent: "hide", commentId: 9999 }))
    ).toBe(404);
  });

  it("unhides and keeps hidden", async () => {
    const a = comment({
      hiddenAt: "2026-01-01T00:00:00.000Z",
      hiddenById: base.instructor.id,
      editedAt: "2026-01-02T00:00:00.000Z",
    });
    const b = comment({
      hiddenAt: "2026-01-01T00:00:00.000Z",
      hiddenById: base.instructor.id,
      editedAt: "2026-01-02T00:00:00.000Z",
    });
    currentUserId = base.instructor.id;

    await callAction({ intent: "unhide", commentId: a.id });
    await callAction({ intent: "keepHidden", commentId: b.id });

    expect(getComment(a.id).hiddenAt).toBeNull();
    const kept = getComment(b.id);
    expect(kept.hiddenById).toBe(base.instructor.id);
    expect(kept.hiddenAt! > kept.editedAt!).toBe(true);
  });

  it("posts a Staff reply that answers the question", async () => {
    const q = comment();
    currentUserId = base.instructor.id;

    const result = await callAction({
      intent: "reply",
      commentId: q.id,
      body: "Here's the answer.",
    });

    expect(result).toMatchObject({ ok: true });
    const replies = testDb
      .select()
      .from(schema.comments)
      .where(eq(schema.comments.parentId, q.id))
      .all();
    expect(replies).toHaveLength(1);
    expect(replies[0].userId).toBe(base.instructor.id);
  });
});
