// Pure lesson-discussion tree logic: builds the nested Threads for one lesson
// as a given viewer is allowed to see them. No database access, so it can be
// unit-tested directly. Terms (Comment, Reply, Thread, Deleted Comment, Hidden
// Comment, Flag, Reaction, Thread Participant, Muted Thread) are defined in
// CONTEXT.md under "Lesson discussion".

import { ReactionKind } from "~/db/schema";

/** The fixed Reaction set, in display order. The one place kinds map to emoji. */
export const REACTIONS: ReadonlyArray<{
  kind: ReactionKind;
  emoji: string;
  label: string;
}> = [
  { kind: ReactionKind.ThumbsUp, emoji: "👍", label: "Thumbs up" },
  { kind: ReactionKind.Heart, emoji: "❤️", label: "Heart" },
  { kind: ReactionKind.Party, emoji: "🎉", label: "Party" },
  { kind: ReactionKind.Thinking, emoji: "🤔", label: "Thinking" },
  { kind: ReactionKind.Eyes, emoji: "👀", label: "Eyes" },
];

/**
 * Past this depth, Replies stop indenting further so deep Threads stay
 * readable next to the video; they show "replying to X" instead.
 */
export const MAX_INDENT_DEPTH = 4;

export type CommentAuthor = {
  id: number;
  name: string;
  avatarUrl: string | null;
  isInstructor: boolean;
  isAdmin: boolean;
};

/** One comments row for the lesson, joined with its author. */
export type CommentRow = {
  id: number;
  parentId: number | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  hiddenAt: string | null;
  author: CommentAuthor;
};

export type ReactionRow = {
  commentId: number;
  userId: number;
  kind: ReactionKind;
};

export type ThreadViewer = {
  userId: number | null;
  /** Staff for this course (owning instructor or admin). */
  isStaff: boolean;
  canViewContent: boolean;
};

export type ReactionSummary = {
  kind: ReactionKind;
  count: number;
  /** The viewer has added this Reaction. */
  reacted: boolean;
};

export type ThreadNode = {
  id: number;
  parentId: number | null;
  /** 0 for a top-level Comment. */
  depth: number;
  createdAt: string;
  editedAt: string | null;
  /** A Deleted Comment kept as an anonymous placeholder. */
  deleted: boolean;
  hidden: boolean;
  /** Null when the viewer may not see the author (deleted, or hidden from them). */
  author: CommentAuthor | null;
  /** Raw markdown. Null when withheld from the viewer. */
  body: string | null;
  /**
   * Who the parent was, as the viewer may see it. Null for top-level
   * Comments. Shown once indentation stops at MAX_INDENT_DEPTH.
   */
  replyingTo: string | null;
  reactions: ReactionSummary[];
  /** The viewer has a Flag on this Comment (active or dismissed). */
  flagged: boolean;
  canReply: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canReact: boolean;
  canFlag: boolean;
  canHide: boolean;
  canUnhide: boolean;
  /** Top-level only: the viewer is a Thread Participant and may mute it. */
  canMute: boolean;
  /** Top-level only: the viewer has muted this Thread. */
  muted: boolean;
  replies: ThreadNode[];
};

type Moderatable = {
  authorId: number;
  deletedAt: string | null;
  hiddenAt: string | null;
};

/** You can't reply to a Deleted or Hidden Comment. */
export function canReplyTo(comment: Omit<Moderatable, "authorId">): boolean {
  return comment.deletedAt === null && comment.hiddenAt === null;
}

/** Reactions are only for someone else's live, visible Comment. */
export function canReactTo(
  comment: Moderatable,
  userId: number | null
): boolean {
  return (
    userId !== null &&
    comment.authorId !== userId &&
    comment.deletedAt === null &&
    comment.hiddenAt === null
  );
}

/**
 * Anyone but the author can Flag a live Comment. Staff hide instead of
 * flagging, and a Hidden Comment is already in front of Staff.
 */
export function canFlag(
  comment: Moderatable,
  userId: number | null,
  isStaff: boolean
): boolean {
  return (
    userId !== null &&
    !isStaff &&
    comment.authorId !== userId &&
    comment.deletedAt === null &&
    comment.hiddenAt === null
  );
}

/** Walk a lesson's rows up to the Thread's top-level Comment id. */
export function findThreadRootId(
  rows: ReadonlyArray<Pick<CommentRow, "id" | "parentId">>,
  commentId: number
): number | null {
  const byId = new Map(rows.map((r) => [r.id, r]));
  let current = byId.get(commentId);
  for (let i = 0; current && i < rows.length + 1; i++) {
    if (current.parentId === null) return current.id;
    current = byId.get(current.parentId);
  }
  return null;
}

/**
 * A Thread Participant has at least one Comment in the Thread they haven't
 * deleted. Hidden Comments still count.
 */
export function isThreadParticipant(
  rows: ReadonlyArray<CommentRow>,
  threadId: number,
  userId: number | null
): boolean {
  if (userId === null) return false;
  return rows.some(
    (r) =>
      r.author.id === userId &&
      r.deletedAt === null &&
      findThreadRootId(rows, r.id) === threadId
  );
}

function summariseReactions(
  reactions: ReadonlyArray<ReactionRow>,
  userId: number | null
): ReactionSummary[] {
  return REACTIONS.map(({ kind }) => {
    const ofKind = reactions.filter((r) => r.kind === kind);
    return {
      kind,
      count: ofKind.length,
      reacted: userId !== null && ofKind.some((r) => r.userId === userId),
    };
  });
}

/**
 * Builds every Thread on a lesson, nested to any depth, as `viewer` may see
 * it. `rows` should be ordered oldest-first; Replies keep that order.
 *
 * - A Deleted Comment with a live descendant becomes an anonymous placeholder
 *   (no author, no body). Otherwise it is pruned. Pruning is bottom-up, so
 *   a chain of Deleted Comments with nothing live beneath disappears.
 * - A Hidden Comment's author and body go only to its author and Staff.
 *   Everyone else gets a placeholder. Its Replies stay visible.
 */
export function buildLessonThreads(input: {
  rows: ReadonlyArray<CommentRow>;
  reactions: ReadonlyArray<ReactionRow>;
  /** Comment ids the viewer has flagged (including dismissed Flags). */
  flaggedCommentIds: ReadonlySet<number>;
  /** Thread ids the viewer has muted. */
  mutedThreadIds: ReadonlySet<number>;
  viewer: ThreadViewer;
}): ThreadNode[] {
  const { rows, reactions, flaggedCommentIds, mutedThreadIds, viewer } = input;
  const viewerId = viewer.userId;

  const childrenOf = new Map<number | null, CommentRow[]>();
  const ids = new Set(rows.map((r) => r.id));
  for (const row of rows) {
    // Orphans (parent missing) are dropped rather than promoted.
    if (row.parentId !== null && !ids.has(row.parentId)) continue;
    const siblings = childrenOf.get(row.parentId) ?? [];
    siblings.push(row);
    childrenOf.set(row.parentId, siblings);
  }

  const reactionsOf = new Map<number, ReactionRow[]>();
  for (const reaction of reactions) {
    const list = reactionsOf.get(reaction.commentId) ?? [];
    list.push(reaction);
    reactionsOf.set(reaction.commentId, list);
  }

  // Participation is per Thread, computed from the raw rows (pruning never
  // removes a live Comment, but it's clearer not to depend on that).
  const participantThreads = new Set<number>();
  if (viewerId !== null) {
    for (const row of rows) {
      if (row.author.id !== viewerId || row.deletedAt !== null) continue;
      const root = findThreadRootId(rows, row.id);
      if (root !== null) participantThreads.add(root);
    }
  }

  const visibleName = (row: CommentRow): string => {
    if (row.deletedAt !== null) return "a deleted comment";
    if (
      row.hiddenAt !== null &&
      !viewer.isStaff &&
      row.author.id !== viewerId
    ) {
      return "a hidden comment";
    }
    return row.author.name;
  };

  const build = (
    row: CommentRow,
    depth: number,
    parent: CommentRow | null,
    seen: Set<number>
  ): ThreadNode | null => {
    if (seen.has(row.id)) return null; // corrupt cycle guard
    seen.add(row.id);

    const replies = (childrenOf.get(row.id) ?? [])
      .map((child) => build(child, depth + 1, row, seen))
      .filter((node): node is ThreadNode => node !== null);

    const deleted = row.deletedAt !== null;
    if (deleted && replies.length === 0) return null;

    const hidden = !deleted && row.hiddenAt !== null;
    const isAuthor = viewerId !== null && row.author.id === viewerId;
    const revealed = !deleted && (!hidden || isAuthor || viewer.isStaff);
    const moderatable: Moderatable = {
      authorId: row.author.id,
      deletedAt: row.deletedAt,
      hiddenAt: row.hiddenAt,
    };
    const isRoot = row.parentId === null;

    return {
      id: row.id,
      parentId: row.parentId,
      depth,
      createdAt: row.createdAt,
      editedAt: revealed ? row.editedAt : null,
      deleted,
      hidden,
      author: revealed ? row.author : null,
      body: revealed ? row.body : null,
      replyingTo: parent ? visibleName(parent) : null,
      reactions: revealed
        ? summariseReactions(reactionsOf.get(row.id) ?? [], viewerId)
        : [],
      flagged: flaggedCommentIds.has(row.id),
      canReply: viewer.canViewContent && canReplyTo(row),
      canEdit: viewer.canViewContent && isAuthor && !deleted,
      canDelete: viewer.canViewContent && isAuthor && !deleted,
      canReact: viewer.canViewContent && canReactTo(moderatable, viewerId),
      canFlag:
        viewer.canViewContent && canFlag(moderatable, viewerId, viewer.isStaff),
      canHide: viewer.isStaff && !deleted && !hidden,
      canUnhide: viewer.isStaff && hidden,
      canMute: isRoot && participantThreads.has(row.id),
      muted: isRoot && mutedThreadIds.has(row.id),
      replies,
    };
  };

  const seen = new Set<number>();
  return (childrenOf.get(null) ?? [])
    .map((row) => build(row, 0, null, seen))
    .filter((node): node is ThreadNode => node !== null);
}
