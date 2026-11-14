// Reply Notifications. See "Reply Notification" and "Muted Thread" in
// CONTEXT.md. The recipient and visibility rules live in ./notifications
// (pure); this module does the reads and writes.

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  comments,
  courses,
  lessons,
  modules,
  notifications,
  threadMutes,
  users,
} from "~/db/schema";
import { getAccess } from "~/lib/access.server";
import {
  collectThread,
  isNotificationVisible,
  selectReplyRecipients,
} from "~/lib/notifications";

/**
 * Called once, right after a Reply is inserted. Writes a notification row for
 * every recipient the glossary rules allow. Does nothing for top-level comments.
 *
 * Doesn't check content access: there's no request (and so no country) at
 * write time. Access is applied when notifications are read.
 *
 * Never throws: the Reply is already saved, so a notification failure is
 * logged rather than surfaced to the person who posted it.
 */
export function createReplyNotifications(replyId: number): void {
  try {
    writeReplyNotifications(replyId);
  } catch (error) {
    console.error(`Failed to create notifications for reply ${replyId}`, error);
  }
}

function writeReplyNotifications(replyId: number): void {
  const reply = db
    .select()
    .from(comments)
    .where(eq(comments.id, replyId))
    .get();
  if (!reply || reply.parentId === null) return;

  // Lesson threads are small: load the lesson's comments and walk in memory.
  const lessonComments = db
    .select({
      id: comments.id,
      userId: comments.userId,
      parentId: comments.parentId,
      deletedAt: comments.deletedAt,
    })
    .from(comments)
    .where(eq(comments.lessonId, reply.lessonId))
    .all();

  const thread = collectThread(lessonComments, reply.id);
  const root = thread[0];
  if (!root) return;

  const mutedUserIds = db
    .select({ userId: threadMutes.userId })
    .from(threadMutes)
    .where(eq(threadMutes.threadId, root.id))
    .all()
    .map((m) => m.userId);

  const recipients = selectReplyRecipients(thread, mutedUserIds, reply);
  if (recipients.length === 0) return;

  db.insert(notifications)
    .values(recipients.map((userId) => ({ userId, commentId: reply.id })))
    .onConflictDoNothing()
    .run();
}

// ─── Reading ───

/**
 * Which of these courses the requesting user can view content for right now
 * (same rule as the lesson page, including PPP). One access check per course.
 */
async function getViewableCourseIds(
  request: Request,
  courseIds: Iterable<number>
): Promise<Set<number>> {
  const distinct = [...new Set(courseIds)];
  const results = await Promise.all(
    distinct.map(async (courseId) => ({
      courseId,
      canView: (await getAccess(request, courseId)).canViewContent,
    }))
  );
  return new Set(results.filter((r) => r.canView).map((r) => r.courseId));
}

export type NotificationListItem = {
  id: number;
  createdAt: string;
  readAt: string | null;
  replyId: number;
  replyBody: string;
  authorName: string;
  authorAvatarUrl: string | null;
  lessonId: number;
  lessonTitle: string;
  courseId: number;
  courseTitle: string;
  courseSlug: string;
};

/**
 * The user's notifications, newest first, with anything they shouldn't see
 * right now filtered out (deleted/hidden Reply, no content access).
 */
export async function getNotificationsForUser(
  request: Request,
  userId: number
): Promise<NotificationListItem[]> {
  const rows = db
    .select({
      id: notifications.id,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
      replyId: comments.id,
      replyBody: comments.body,
      replyDeletedAt: comments.deletedAt,
      replyHiddenAt: comments.hiddenAt,
      authorName: users.name,
      authorAvatarUrl: users.avatarUrl,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(notifications)
    .innerJoin(comments, eq(notifications.commentId, comments.id))
    .innerJoin(users, eq(comments.userId, users.id))
    .innerJoin(lessons, eq(comments.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .all();

  const viewable = await getViewableCourseIds(
    request,
    rows.map((r) => r.courseId)
  );

  return rows
    .filter((r) => isNotificationVisible(r, viewable))
    .map(({ replyDeletedAt: _d, replyHiddenAt: _h, ...item }) => item);
}

/**
 * Unread count for the bell, with the same filters as the list. One query
 * grouped by course, then an access check per course with unread items.
 */
export async function getUnreadNotificationCount(
  request: Request,
  userId: number
): Promise<number> {
  const perCourse = db
    .select({
      courseId: modules.courseId,
      count: sql<number>`count(*)`,
    })
    .from(notifications)
    .innerJoin(comments, eq(notifications.commentId, comments.id))
    .innerJoin(lessons, eq(comments.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        isNull(comments.deletedAt),
        isNull(comments.hiddenAt)
      )
    )
    .groupBy(modules.courseId)
    .all();

  if (perCourse.length === 0) return 0;

  const viewable = await getViewableCourseIds(
    request,
    perCourse.map((r) => r.courseId)
  );

  return perCourse
    .filter((r) => viewable.has(r.courseId))
    .reduce((sum, r) => sum + r.count, 0);
}

/**
 * Marks one of the user's notifications read and returns where it links, or
 * undefined if it isn't theirs.
 */
export function openNotification(
  userId: number,
  notificationId: number
): { courseSlug: string; lessonId: number; replyId: number } | undefined {
  const target = db
    .select({
      readAt: notifications.readAt,
      replyId: comments.id,
      lessonId: lessons.id,
      courseSlug: courses.slug,
    })
    .from(notifications)
    .innerJoin(comments, eq(notifications.commentId, comments.id))
    .innerJoin(lessons, eq(comments.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId)
      )
    )
    .get();

  if (!target) return undefined;

  if (target.readAt === null) {
    db.update(notifications)
      .set({ readAt: new Date().toISOString() })
      .where(eq(notifications.id, notificationId))
      .run();
  }

  return {
    courseSlug: target.courseSlug,
    lessonId: target.lessonId,
    replyId: target.replyId,
  };
}

/**
 * Marks every notification the user can currently see as read. Ones hidden
 * by lost access stay unread, so they come back unread when access returns.
 */
export async function markAllNotificationsRead(
  request: Request,
  userId: number
): Promise<void> {
  const visibleUnread = (await getNotificationsForUser(request, userId))
    .filter((n) => n.readAt === null)
    .map((n) => n.id);
  if (visibleUnread.length === 0) return;

  db.update(notifications)
    .set({ readAt: new Date().toISOString() })
    .where(
      and(
        eq(notifications.userId, userId),
        inArray(notifications.id, visibleUnread)
      )
    )
    .run();
}
