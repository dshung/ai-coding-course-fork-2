// Unanswered Threads (see "Unanswered Thread" in CONTEXT.md): the instructor
// questions queue and the analytics count share this definition.

import {
  and,
  desc,
  eq,
  isNull,
  ne,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db } from "~/db";
import {
  comments,
  courses,
  lessons,
  modules,
  users,
  UserRole,
} from "~/db/schema";

/**
 * Correlated EXISTS: is there a live (non-deleted) Reply by Staff anywhere
 * beneath the outer `comments` row, at any depth?
 *
 * Staff are admins and the outer `courses` row's instructor, so the outer
 * query must select from `comments` and join `courses` unaliased. Inner tables
 * are aliased so `"comments"` / `"courses"` resolve to the outer query.
 *
 * UNION (not UNION ALL) drops repeats, so a corrupt parent cycle terminates.
 */
export function staffReplyInThread(): SQL {
  return sql`exists (
    with recursive descendants(id) as (
      select child.id from ${comments} as child
        where child.parent_id = ${comments.id}
      union
      select c.id from ${comments} as c
        inner join descendants as d on c.parent_id = d.id
    )
    select 1 from descendants as d
      inner join ${comments} as r on r.id = d.id
      inner join ${users} as ru on ru.id = r.user_id
    where r.deleted_at is null
      and (ru.role = ${UserRole.Admin} or r.user_id = ${courses.instructorId})
  )`;
}

/**
 * WHERE conditions selecting Unanswered Threads by their top-level comment.
 * Expects the query to select from `comments`, join `courses` (via lessons and
 * modules) unaliased, and join the comment's author as `authorRole`'s table.
 */
export function unansweredQuestionConditions(
  authorRole: AnyColumn,
  instructorId: number | null
): SQL[] {
  const conditions: SQL[] = [
    isNull(comments.parentId),
    isNull(comments.deletedAt),
    // Staff hid it, so it isn't a question waiting on an answer.
    isNull(comments.hiddenAt),
    // Staff asking their own question shouldn't queue up as work for themselves.
    ne(authorRole, UserRole.Admin),
    ne(comments.userId, courses.instructorId),
    sql`not ${staffReplyInThread()}`,
  ];

  // Admins (null) span every course; instructors see only their own.
  if (instructorId !== null) {
    conditions.push(eq(courses.instructorId, instructorId));
  }

  return conditions;
}

export type QueuedQuestion = {
  id: number;
  body: string;
  createdAt: string;
  lessonId: number;
  lessonTitle: string;
  courseTitle: string;
  courseSlug: string;
  authorId: number;
  authorName: string;
  authorAvatarUrl: string | null;
};

/** Top-level comments of Unanswered Threads, newest first. */
export function getUnansweredQuestions(
  instructorId: number | null
): QueuedQuestion[] {
  const author = alias(users, "author");

  return db
    .select({
      id: comments.id,
      body: comments.body,
      createdAt: comments.createdAt,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      authorId: author.id,
      authorName: author.name,
      authorAvatarUrl: author.avatarUrl,
    })
    .from(comments)
    .innerJoin(author, eq(comments.userId, author.id))
    .innerJoin(lessons, eq(comments.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(and(...unansweredQuestionConditions(author.role, instructorId)))
    .orderBy(desc(comments.createdAt), desc(comments.id))
    .all();
}
