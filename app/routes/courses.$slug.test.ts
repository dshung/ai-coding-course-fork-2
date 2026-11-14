import { describe, it, expect, vi, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
let currentUserId: number | null = null;

// A getter, not `db: testDb`: vi.mock is hoisted above the `let`, and
// beforeEach reassigns testDb, so a plain value would capture `undefined`.
vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

vi.mock("~/lib/session", () => ({
  getCurrentUserId: vi.fn(async () => currentUserId),
}));

import { action } from "./courses.$slug";

type ActionArgs = Parameters<typeof action>[0];

function rateRequest(rating: string) {
  const body = new FormData();
  body.set("rating", rating);
  return new Request(`http://localhost/courses/${base.course.slug}`, {
    method: "POST",
    body,
  });
}

function callAction(rating: string) {
  const request = rateRequest(rating);
  const args: ActionArgs = {
    request,
    url: new URL(request.url),
    pattern: "/courses/:slug",
    params: { slug: base.course.slug },
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
    if (error instanceof Response) return error.status;
    throw error;
  }
  throw new Error("Expected the action to throw");
}

function enroll(userId: number) {
  testDb
    .insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
    .run();
}

function ratingsFor(userId: number) {
  return testDb
    .select()
    .from(schema.courseRatings)
    .where(
      and(
        eq(schema.courseRatings.userId, userId),
        eq(schema.courseRatings.courseId, base.course.id)
      )
    )
    .all();
}

describe("courses.$slug action (rating)", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    currentUserId = null;
  });

  it("rejects a logged-out user with 401", async () => {
    expect(await thrownStatus(callAction("4"))).toBe(401);
  });

  it("rejects a logged-in user who is not enrolled with 403", async () => {
    currentUserId = base.user.id;
    expect(await thrownStatus(callAction("4"))).toBe(403);
    expect(ratingsFor(base.user.id)).toHaveLength(0);
  });

  it("rejects the course's own instructor, even when enrolled, with 403", async () => {
    enroll(base.instructor.id);
    currentUserId = base.instructor.id;
    expect(await thrownStatus(callAction("5"))).toBe(403);
    expect(ratingsFor(base.instructor.id)).toHaveLength(0);
  });

  it("saves a rating for an enrolled student", async () => {
    enroll(base.user.id);
    currentUserId = base.user.id;

    const result = await callAction("4");

    expect(result).toEqual({ ok: true, error: null });
    const rows = ratingsFor(base.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rating).toBe(4);
  });

  it("updates the existing rating instead of adding a second one", async () => {
    enroll(base.user.id);
    currentUserId = base.user.id;

    await callAction("4");
    await callAction("2");

    const rows = ratingsFor(base.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rating).toBe(2);
  });

  it.each(["0", "6", "3.5", "abc"])(
    "returns an error and writes nothing for an invalid rating (%s)",
    async (rating) => {
      enroll(base.user.id);
      currentUserId = base.user.id;

      const result = await callAction(rating);

      expect(result).toEqual({
        ok: false,
        error: "Please choose a rating from 1 to 5.",
      });
      expect(ratingsFor(base.user.id)).toHaveLength(0);
    }
  );
});
