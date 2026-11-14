// Shared lesson-discussion operations. Terms (Thread, Hidden Comment, Flag…)
// are defined in CONTEXT.md under "Lesson discussion".
//
// These functions do not check permissions — callers must confirm the acting
// user is Staff for the comment's course before calling the moderation ones.

import { and, eq, isNull } from "drizzle-orm";
import { db } from "~/db";
import { commentFlags, comments } from "~/db/schema";

function getComment(commentId: number) {
  return db.select().from(comments).where(eq(comments.id, commentId)).get();
}

/**
 * The id of the Thread a comment belongs to: its top-level ancestor.
 * Returns the comment's own id when it is top-level. Throws if missing.
 */
export function getThreadRootId(commentId: number): number {
  let current = getComment(commentId);
  if (!current) throw new Error("Comment not found");

  // Bounded walk guards against a corrupt parent cycle.
  for (let depth = 0; depth < 10_000; depth++) {
    if (current.parentId === null) return current.id;
    const parent = getComment(current.parentId);
    if (!parent) throw new Error("Parent comment not found");
    current = parent;
  }
  throw new Error("Comment ancestry is cyclic");
}

/**
 * Staff hide a comment. Hiding resolves any active Flags on it.
 * Hiding an already-hidden comment is a no-op.
 */
export function hideComment(commentId: number, staffUserId: number) {
  const existing = getComment(commentId);
  if (!existing) throw new Error("Comment not found");
  if (existing.deletedAt !== null) throw new Error("Comment has been deleted");
  if (existing.hiddenAt !== null) return;

  const now = new Date().toISOString();
  db.transaction((tx) => {
    tx.update(comments)
      .set({ hiddenAt: now, hiddenById: staffUserId })
      .where(eq(comments.id, commentId))
      .run();
    tx.update(commentFlags)
      .set({ dismissedAt: now })
      .where(
        and(
          eq(commentFlags.commentId, commentId),
          isNull(commentFlags.dismissedAt)
        )
      )
      .run();
  });
}

/** Staff unhide a comment. Unhiding a visible comment is a no-op. */
export function unhideComment(commentId: number) {
  const existing = getComment(commentId);
  if (!existing) throw new Error("Comment not found");

  db.update(comments)
    .set({ hiddenAt: null, hiddenById: null })
    .where(eq(comments.id, commentId))
    .run();
}

/** Staff dismiss every active Flag on a comment, leaving it visible. */
export function dismissFlags(commentId: number) {
  db.update(commentFlags)
    .set({ dismissedAt: new Date().toISOString() })
    .where(
      and(
        eq(commentFlags.commentId, commentId),
        isNull(commentFlags.dismissedAt)
      )
    )
    .run();
}

/**
 * Whether a Hidden Comment was edited by its author after Staff hid it, and
 * so needs Staff to look again.
 */
export function needsReReview(comment: {
  hiddenAt: string | null;
  editedAt: string | null;
}): boolean {
  return (
    comment.hiddenAt !== null &&
    comment.editedAt !== null &&
    comment.editedAt > comment.hiddenAt
  );
}
