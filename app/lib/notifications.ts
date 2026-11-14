// Pure rules for Reply Notifications. Terms (Thread, Thread Participant,
// Muted Thread, Hidden Comment…) are defined in CONTEXT.md under
// "Lesson discussion". No database access here, so the rules unit-test cleanly.

export type ThreadComment = {
  id: number;
  userId: number;
  parentId: number | null;
  deletedAt: string | null;
};

/**
 * The comments in the Thread that `commentId` belongs to: its top-level
 * ancestor plus every descendant at any depth. `lessonComments` is every
 * comment on the lesson (a Thread never spans lessons). Returns [] when the
 * comment isn't in the list.
 */
export function collectThread<T extends ThreadComment>(
  lessonComments: T[],
  commentId: number
): T[] {
  const byId = new Map(lessonComments.map((c) => [c.id, c]));

  let root = byId.get(commentId);
  if (!root) return [];
  // Bounded walk guards against a corrupt parent cycle.
  for (let depth = 0; root.parentId !== null && depth < 10_000; depth++) {
    const parent = byId.get(root.parentId);
    if (!parent) break;
    root = parent;
  }

  const children = new Map<number, T[]>();
  for (const c of lessonComments) {
    if (c.parentId === null) continue;
    const siblings = children.get(c.parentId) ?? [];
    siblings.push(c);
    children.set(c.parentId, siblings);
  }

  const thread: T[] = [];
  const seen = new Set<number>();
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current.id)) continue;
    seen.add(current.id);
    thread.push(current);
    stack.push(...(children.get(current.id) ?? []));
  }
  return thread;
}

/**
 * Who gets a Reply Notification for `reply`.
 *
 * - Nobody, if the comment is top-level.
 * - Otherwise every Thread Participant (a user with at least one non-deleted
 *   Comment in the Thread; Hidden Comments count), except the Reply's author
 *   and anyone who muted the Thread.
 * - Muting never blocks the author of the Reply's direct parent, as long as
 *   that parent isn't deleted.
 *
 * Returns user ids in ascending order.
 */
export function selectReplyRecipients(
  threadComments: ThreadComment[],
  mutedUserIds: Iterable<number>,
  reply: { id: number; userId: number; parentId: number | null }
): number[] {
  if (reply.parentId === null) return [];

  const muted = new Set(mutedUserIds);
  const participants = new Set(
    threadComments.filter((c) => c.deletedAt === null).map((c) => c.userId)
  );

  const parent = threadComments.find((c) => c.id === reply.parentId);
  const directParentAuthor =
    parent && parent.deletedAt === null ? parent.userId : null;

  return [...participants]
    .filter((userId) => userId !== reply.userId)
    .filter((userId) => !muted.has(userId) || userId === directParentAuthor)
    .sort((a, b) => a - b);
}

export type NotificationVisibilityInput = {
  courseId: number;
  replyDeletedAt: string | null;
  replyHiddenAt: string | null;
};

/**
 * Whether a stored notification should be shown right now. Hidden while the
 * Reply is deleted or hidden, or while the user can't view the course's
 * content (e.g. PPP-blocked). Rows are never deleted for this, so they come
 * back when the condition clears.
 */
export function isNotificationVisible(
  item: NotificationVisibilityInput,
  viewableCourseIds: ReadonlySet<number>
): boolean {
  return (
    item.replyDeletedAt === null &&
    item.replyHiddenAt === null &&
    viewableCourseIds.has(item.courseId)
  );
}

/**
 * A short plain-text preview of a Markdown comment body: strips the common
 * Markdown punctuation, collapses whitespace, and truncates with an ellipsis.
 */
export function excerpt(markdown: string, maxLength = 120): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

/** Where a notification takes you: the Reply, anchored on the lesson page. */
export function notificationHref(item: {
  courseSlug: string;
  lessonId: number;
  replyId: number;
}): string {
  return `/courses/${item.courseSlug}/lessons/${item.lessonId}#comment-${item.replyId}`;
}
