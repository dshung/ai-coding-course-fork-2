import { describe, it, expect, vi, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  classifyForModeration,
  getCommentCourseId,
  getModerationQueue,
  keepHidden,
} from "./moderation.server";
import { needsReReview } from "./comments.server";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";
const T3 = "2026-01-03T00:00:00.000Z";

describe("classifyForModeration", () => {
  const visible = {
    deletedAt: null,
    hiddenAt: null,
    editedAt: null,
    activeFlagCount: 0,
  };

  it("puts a visible comment with active Flags in flagged", () => {
    expect(classifyForModeration({ ...visible, activeFlagCount: 2 })).toBe(
      "flagged"
    );
  });

  it("ignores a visible comment with no active Flags", () => {
    expect(classifyForModeration(visible)).toBeNull();
  });

  it("ignores deleted comments, flagged or not", () => {
    expect(
      classifyForModeration({ ...visible, deletedAt: T1, activeFlagCount: 1 })
    ).toBeNull();
  });

  it("puts a hidden comment edited after hiding in editedAfterHiding", () => {
    expect(
      classifyForModeration({ ...visible, hiddenAt: T1, editedAt: T2 })
    ).toBe("editedAfterHiding");
  });

  it("ignores a hidden comment edited before hiding, or never edited", () => {
    expect(
      classifyForModeration({ ...visible, hiddenAt: T2, editedAt: T1 })
    ).toBeNull();
    expect(classifyForModeration({ ...visible, hiddenAt: T2 })).toBeNull();
  });

  it("doesn't list a hidden comment as flagged", () => {
    expect(
      classifyForModeration({ ...visible, hiddenAt: T1, activeFlagCount: 3 })
    ).toBeNull();
  });
});

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

function flag(
  commentId: number,
  userId: number,
  createdAt: string,
  dismissedAt: string | null = null
) {
  testDb
    .insert(schema.commentFlags)
    .values({ commentId, userId, createdAt, dismissedAt })
    .run();
}

function getComment(id: number) {
  return testDb
    .select()
    .from(schema.comments)
    .where(eq(schema.comments.id, id))
    .get()!;
}

beforeEach(() => {
  testDb = createTestDb();
  base = seedBaseData(testDb);
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

describe("getModerationQueue", () => {
  it("lists flagged comments with active flag count and latest flag time", () => {
    const a = addUser("a", schema.UserRole.Student);
    const b = addUser("b", schema.UserRole.Student);
    const c = addUser("c", schema.UserRole.Student);
    const flagged = comment();
    flag(flagged.id, a.id, T1);
    flag(flagged.id, b.id, T2);
    flag(flagged.id, c.id, T3, T3); // dismissed: doesn't count

    const queue = getModerationQueue(null);

    expect(queue.flagged).toHaveLength(1);
    expect(queue.flagged[0]).toMatchObject({
      id: flagged.id,
      activeFlagCount: 2,
      latestFlagAt: T2,
      courseSlug: base.course.slug,
      lessonId,
      authorName: base.user.name,
    });
    expect(queue.editedAfterHiding).toEqual([]);
  });

  it("drops comments whose flags were all dismissed, and deleted comments", () => {
    const a = addUser("a", schema.UserRole.Student);
    const dismissed = comment();
    flag(dismissed.id, a.id, T1, T2);
    const deleted = comment({ deletedAt: T2 });
    flag(deleted.id, a.id, T1);

    expect(getModerationQueue(null).flagged).toEqual([]);
  });

  it("lists hidden comments edited after hiding, not other hidden ones", () => {
    const edited = comment({
      hiddenAt: T1,
      hiddenById: base.instructor.id,
      editedAt: T2,
    });
    comment({ hiddenAt: T2, hiddenById: base.instructor.id, editedAt: T1 });
    comment({ hiddenAt: T2, hiddenById: base.instructor.id });
    comment({
      hiddenAt: T1,
      hiddenById: base.instructor.id,
      editedAt: T2,
      deletedAt: T3,
    });

    const queue = getModerationQueue(null);

    expect(queue.editedAfterHiding.map((i) => i.id)).toEqual([edited.id]);
    expect(queue.flagged).toEqual([]);
  });

  it("scopes to the instructor's own courses", () => {
    const a = addUser("a", schema.UserRole.Student);
    const otherInstructor = addUser("other", schema.UserRole.Instructor);
    const flagged = comment();
    flag(flagged.id, a.id, T1);

    expect(getModerationQueue(base.instructor.id).flagged).toHaveLength(1);
    expect(getModerationQueue(otherInstructor.id).flagged).toEqual([]);
  });
});

describe("keepHidden", () => {
  it("clears re-review, keeping who hid it", () => {
    const edited = comment({
      hiddenAt: T1,
      hiddenById: base.instructor.id,
      editedAt: T2,
    });

    keepHidden(edited.id);

    const after = getComment(edited.id);
    expect(after.hiddenById).toBe(base.instructor.id);
    expect(needsReReview(after)).toBe(false);
    expect(getModerationQueue(null).editedAfterHiding).toEqual([]);
  });

  it("does not hide a visible comment", () => {
    const visible = comment();
    keepHidden(visible.id);
    expect(getComment(visible.id).hiddenAt).toBeNull();
  });
});

describe("getCommentCourseId", () => {
  it("resolves a comment's course, or undefined", () => {
    const c = comment();
    expect(getCommentCourseId(c.id)).toBe(base.course.id);
    expect(getCommentCourseId(9999)).toBeUndefined();
  });
});
