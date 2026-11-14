import { describe, it, expect, vi, beforeEach } from "vitest";
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

import { getUnansweredQuestions } from "./unanswered-questions.server";

function addUser(name: string, role: schema.UserRole) {
  return testDb
    .insert(schema.users)
    .values({ name, email: `${name}@example.com`, role })
    .returning()
    .get();
}

function comment(
  userId: number,
  parentId: number | null = null,
  extra: Partial<typeof schema.comments.$inferInsert> = {}
) {
  return testDb
    .insert(schema.comments)
    .values({ lessonId, userId, parentId, body: "text", ...extra })
    .returning()
    .get();
}

function unansweredIds(instructorId: number | null = null) {
  return getUnansweredQuestions(instructorId).map((q) => q.id);
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

describe("getUnansweredQuestions", () => {
  it("lists a question with no replies", () => {
    const q = comment(base.user.id);
    expect(unansweredIds()).toEqual([q.id]);
  });

  it("is answered by an instructor reply three levels deep", () => {
    const other = addUser("other", schema.UserRole.Student);
    const q = comment(base.user.id);
    const r1 = comment(other.id, q.id);
    const r2 = comment(base.user.id, r1.id);
    comment(base.instructor.id, r2.id);

    expect(unansweredIds()).toEqual([]);
  });

  it("stays unanswered when only students replied", () => {
    const other = addUser("other", schema.UserRole.Student);
    const q = comment(base.user.id);
    const r1 = comment(other.id, q.id);
    comment(base.user.id, r1.id);

    expect(unansweredIds()).toEqual([q.id]);
  });

  it("stays unanswered when the only Staff reply is deleted", () => {
    const other = addUser("other", schema.UserRole.Student);
    const q = comment(base.user.id);
    const r1 = comment(other.id, q.id);
    comment(base.instructor.id, r1.id, {
      deletedAt: new Date().toISOString(),
    });

    expect(unansweredIds()).toEqual([q.id]);
  });

  it("counts a live Staff reply beneath a deleted comment", () => {
    const q = comment(base.user.id);
    const r1 = comment(base.user.id, q.id, {
      deletedAt: new Date().toISOString(),
    });
    comment(base.instructor.id, r1.id);

    expect(unansweredIds()).toEqual([]);
  });

  it("counts an admin's reply, at any depth", () => {
    const admin = addUser("admin", schema.UserRole.Admin);
    const q = comment(base.user.id);
    const r1 = comment(base.user.id, q.id);
    comment(admin.id, r1.id);

    expect(unansweredIds()).toEqual([]);
  });

  it("does not count a reply from an instructor who isn't Staff for the course", () => {
    const otherInstructor = addUser("other-inst", schema.UserRole.Instructor);
    const q = comment(base.user.id);
    comment(otherInstructor.id, q.id);

    expect(unansweredIds()).toEqual([q.id]);
  });

  it("does not let a reply in another Thread answer this one", () => {
    const q1 = comment(base.user.id);
    const q2 = comment(base.user.id);
    comment(base.instructor.id, q2.id);

    expect(unansweredIds()).toEqual([q1.id]);
  });

  it("leaves out deleted, hidden and Staff-authored questions", () => {
    const admin = addUser("admin", schema.UserRole.Admin);
    const now = new Date().toISOString();
    comment(base.user.id, null, { deletedAt: now });
    comment(base.user.id, null, { hiddenAt: now, hiddenById: admin.id });
    comment(base.instructor.id);
    comment(admin.id);

    expect(unansweredIds()).toEqual([]);
  });

  it("scopes to the instructor's own courses", () => {
    const q = comment(base.user.id);
    const otherInstructor = addUser("other-inst", schema.UserRole.Instructor);

    expect(unansweredIds(base.instructor.id)).toEqual([q.id]);
    expect(unansweredIds(otherInstructor.id)).toEqual([]);
  });
});
