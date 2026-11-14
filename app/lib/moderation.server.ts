// Staff moderation review: Flagged Comments, and Hidden Comments their author
// edited after hiding. Terms are defined in CONTEXT.md under "Lesson discussion".
//
// Nothing here checks permissions. Callers confirm the acting user is Staff for
// the comment's course (see getCommentCourseId) before acting.

import {
  and,
  count,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "~/db";
import {
  commentFlags,
  comments,
  courses,
  lessons,
  modules,
  users,
} from "~/db/schema";
import { needsReReview } from "~/lib/comments.server";

export type ModerationKind = "flagged" | "editedAfterHiding";

/**
 * Which review list, if any, a comment belongs in.
 * - Deleted comments are never reviewed (authors removed them).
 * - A Hidden Comment comes back only when its author edited it after hiding.
 * - A visible comment comes up while it has at least one active Flag.
 */
export function classifyForModeration(comment: {
  deletedAt: string | null;
  hiddenAt: string | null;
  editedAt: string | null;
  activeFlagCount: number;
}): ModerationKind | null {
  if (comment.deletedAt !== null) return null;
  if (comment.hiddenAt !== null) {
    return needsReReview(comment) ? "editedAfterHiding" : null;
  }
  return comment.activeFlagCount > 0 ? "flagged" : null;
}

export type ModerationItem = {
  id: number;
  body: string;
  createdAt: string;
  editedAt: string | null;
  hiddenAt: string | null;
  lessonId: number;
  lessonTitle: string;
  courseTitle: string;
  courseSlug: string;
  authorId: number;
  authorName: string;
  authorAvatarUrl: string | null;
  activeFlagCount: number;
  latestFlagAt: string | null;
};

export type ModerationQueue = {
  flagged: ModerationItem[];
  editedAfterHiding: ModerationItem[];
};

/**
 * Comments awaiting Staff review on the courses in scope. `instructorId` null
 * means every course (admins); otherwise only that instructor's courses.
 */
export function getModerationQueue(
  instructorId: number | null
): ModerationQueue {
  const activeFlags = db
    .select({
      commentId: commentFlags.commentId,
      activeFlagCount: count(commentFlags.id).as("active_flag_count"),
      latestFlagAt: sql<string>`max(${commentFlags.createdAt})`.as(
        "latest_flag_at"
      ),
    })
    .from(commentFlags)
    .where(isNull(commentFlags.dismissedAt))
    .groupBy(commentFlags.commentId)
    .as("active_flags");

  const conditions: SQL[] = [
    isNull(comments.deletedAt),
    // Coarse SQL pre-filter; classifyForModeration makes the final call.
    or(isNotNull(comments.hiddenAt), gt(activeFlags.activeFlagCount, 0))!,
  ];
  if (instructorId !== null) {
    conditions.push(eq(courses.instructorId, instructorId));
  }

  const rows = db
    .select({
      id: comments.id,
      body: comments.body,
      createdAt: comments.createdAt,
      editedAt: comments.editedAt,
      hiddenAt: comments.hiddenAt,
      deletedAt: comments.deletedAt,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      authorId: users.id,
      authorName: users.name,
      authorAvatarUrl: users.avatarUrl,
      activeFlagCount: activeFlags.activeFlagCount,
      latestFlagAt: activeFlags.latestFlagAt,
    })
    .from(comments)
    .innerJoin(users, eq(comments.userId, users.id))
    .innerJoin(lessons, eq(comments.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .leftJoin(activeFlags, eq(activeFlags.commentId, comments.id))
    .where(and(...conditions))
    .all();

  const queue: ModerationQueue = { flagged: [], editedAfterHiding: [] };

  for (const { deletedAt, ...row } of rows) {
    const item: ModerationItem = {
      ...row,
      activeFlagCount: row.activeFlagCount ?? 0,
      latestFlagAt: row.latestFlagAt ?? null,
    };
    const kind = classifyForModeration({ ...item, deletedAt });
    if (kind) queue[kind].push(item);
  }

  // Most recent activity first: the newest Flag, or the newest author edit.
  queue.flagged.sort(byDesc((item) => item.latestFlagAt ?? ""));
  queue.editedAfterHiding.sort(byDesc((item) => item.editedAt ?? ""));

  return queue;
}

function byDesc<T>(key: (item: T) => string) {
  return (a: T, b: T) => key(b).localeCompare(key(a));
}

/** The course a comment belongs to, for the Staff check. Undefined if missing. */
export function getCommentCourseId(commentId: number): number | undefined {
  return db
    .select({ courseId: modules.courseId })
    .from(comments)
    .innerJoin(lessons, eq(comments.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(comments.id, commentId))
    .get()?.courseId;
}

/**
 * Staff reviewed an edited Hidden Comment and decided it stays hidden.
 *
 * Re-review is derived (needsReReview: editedAt > hiddenAt), with no column
 * of its own, so clearing it means moving hiddenAt past the edit. hideComment
 * can't do that: it is a no-op on an already-hidden comment. This re-stamps
 * hiddenAt to now and keeps hiddenById (who originally hid it). A later author
 * edit puts it back in front of Staff, as the glossary requires.
 *
 * A no-op on a comment that isn't hidden, so a stale click can't hide it.
 */
export function keepHidden(commentId: number) {
  db.update(comments)
    .set({ hiddenAt: new Date().toISOString() })
    .where(and(eq(comments.id, commentId), isNotNull(comments.hiddenAt)))
    .run();
}
