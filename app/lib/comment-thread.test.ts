import { describe, it, expect } from "vitest";
import { ReactionKind } from "~/db/schema";
import {
  buildLessonThreads,
  canReactTo,
  findThreadRootId,
  isThreadParticipant,
  type CommentRow,
  type ReactionRow,
  type ThreadNode,
  type ThreadViewer,
} from "./comment-thread";

// ─── Fixtures ───

const ALICE = 1;
const BOB = 2;
const CAROL = 3;
const INSTRUCTOR = 10;

function row(
  id: number,
  authorId: number,
  parentId: number | null,
  overrides: Partial<CommentRow> = {}
): CommentRow {
  return {
    id,
    parentId,
    body: `body ${id}`,
    createdAt: `2026-01-01T00:00:${String(id).padStart(2, "0")}.000Z`,
    editedAt: null,
    deletedAt: null,
    hiddenAt: null,
    author: {
      id: authorId,
      name: `User ${authorId}`,
      avatarUrl: null,
      isInstructor: authorId === INSTRUCTOR,
      isAdmin: false,
    },
    ...overrides,
  };
}

const student = (userId: number | null): ThreadViewer => ({
  userId,
  isStaff: false,
  canViewContent: userId !== null,
});
const staff: ThreadViewer = {
  userId: INSTRUCTOR,
  isStaff: true,
  canViewContent: true,
};

function build(
  rows: CommentRow[],
  viewer: ThreadViewer,
  extra: {
    reactions?: ReactionRow[];
    flagged?: number[];
    muted?: number[];
  } = {}
) {
  return buildLessonThreads({
    rows,
    reactions: extra.reactions ?? [],
    flaggedCommentIds: new Set(extra.flagged ?? []),
    mutedThreadIds: new Set(extra.muted ?? []),
    viewer,
  });
}

function find(nodes: ThreadNode[], id: number): ThreadNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const inReplies = find(node.replies, id);
    if (inReplies) return inReplies;
  }
  return undefined;
}

const DELETED = { deletedAt: "2026-01-02T00:00:00.000Z" };
const HIDDEN = { hiddenAt: "2026-01-02T00:00:00.000Z" };

describe("buildLessonThreads", () => {
  // ─── Nesting ───

  describe("nesting", () => {
    it("nests Replies to any depth", () => {
      const rows = [1, 2, 3, 4, 5, 6, 7].map((id) =>
        row(id, id % 2 ? ALICE : BOB, id === 1 ? null : id - 1)
      );
      const threads = build(rows, student(CAROL));

      expect(threads).toHaveLength(1);
      let node = threads[0];
      for (let depth = 0; depth < 7; depth++) {
        expect(node.id).toBe(depth + 1);
        expect(node.depth).toBe(depth);
        node = node.replies[0];
      }
      expect(node).toBeUndefined();
    });

    it("keeps Replies oldest-first in input order", () => {
      const rows = [row(1, ALICE, null), row(2, BOB, 1), row(3, CAROL, 1)];
      const [thread] = build(rows, student(ALICE));
      expect(thread.replies.map((r) => r.id)).toEqual([2, 3]);
    });

    it("records who each Reply is replying to", () => {
      const rows = [row(1, ALICE, null), row(2, BOB, 1)];
      const [thread] = build(rows, student(CAROL));
      expect(thread.replyingTo).toBeNull();
      expect(thread.replies[0].replyingTo).toBe("User 1");
    });

    it("finds the Thread root from any depth", () => {
      const rows = [row(1, ALICE, null), row(2, BOB, 1), row(3, ALICE, 2)];
      expect(findThreadRootId(rows, 3)).toBe(1);
      expect(findThreadRootId(rows, 1)).toBe(1);
      expect(findThreadRootId(rows, 99)).toBeNull();
    });
  });

  // ─── Deleted Comments ───

  describe("deleted comments", () => {
    it("prunes a Deleted Comment with no Replies", () => {
      const rows = [row(1, ALICE, null), row(2, BOB, 1, DELETED)];
      const [thread] = build(rows, student(CAROL));
      expect(thread.replies).toEqual([]);
    });

    it("prunes cascading chains of Deleted Comments bottom-up", () => {
      const rows = [
        row(1, ALICE, null, DELETED),
        row(2, BOB, 1, DELETED),
        row(3, ALICE, 2, DELETED),
      ];
      expect(build(rows, student(CAROL))).toEqual([]);
    });

    it("keeps a deleted ancestor chain when a live Reply sits deep beneath", () => {
      const rows = [
        row(1, ALICE, null, DELETED),
        row(2, BOB, 1, DELETED),
        row(3, CAROL, 2),
        row(4, ALICE, 1, DELETED), // pruned sibling branch
      ];
      const [thread] = build(rows, student(BOB));
      expect(thread.id).toBe(1);
      expect(thread.replies.map((r) => r.id)).toEqual([2]);
      expect(thread.replies[0].replies[0].id).toBe(3);
    });

    it("renders a kept Deleted Comment as an anonymous placeholder", () => {
      const rows = [row(1, ALICE, null, DELETED), row(2, BOB, 1)];
      // Even the author sees no name, body or reactions.
      const [thread] = build(rows, student(ALICE), {
        reactions: [{ commentId: 1, userId: BOB, kind: ReactionKind.Heart }],
      });
      expect(thread.deleted).toBe(true);
      expect(thread.author).toBeNull();
      expect(thread.body).toBeNull();
      expect(thread.reactions).toEqual([]);
      expect(thread.canEdit).toBe(false);
      expect(thread.canDelete).toBe(false);
      expect(thread.canReply).toBe(false);
      expect(thread.replies[0].replyingTo).toBe("a deleted comment");
    });
  });

  // ─── Hidden Comments ───

  describe("hidden comments", () => {
    const rows = [row(1, ALICE, null, HIDDEN), row(2, BOB, 1)];

    it("withholds the body and author from other readers", () => {
      const [thread] = build(rows, student(BOB));
      expect(thread.hidden).toBe(true);
      expect(thread.body).toBeNull();
      expect(thread.author).toBeNull();
      expect(thread.replies[0].replyingTo).toBe("a hidden comment");
    });

    it("withholds it from signed-out viewers too", () => {
      const [thread] = build(rows, student(null));
      expect(thread.body).toBeNull();
    });

    it("shows the author their own body, still editable", () => {
      const [thread] = build(rows, student(ALICE));
      expect(thread.body).toBe("body 1");
      expect(thread.author?.id).toBe(ALICE);
      expect(thread.canEdit).toBe(true);
    });

    it("shows Staff the body with Unhide", () => {
      const [thread] = build(rows, staff);
      expect(thread.body).toBe("body 1");
      expect(thread.canUnhide).toBe(true);
      expect(thread.canHide).toBe(false);
    });

    it("keeps its Replies visible", () => {
      const [thread] = build(rows, student(CAROL));
      expect(thread.replies[0].body).toBe("body 2");
    });

    it("still shows the placeholder with no Replies", () => {
      const [thread] = build([row(1, ALICE, null, HIDDEN)], student(BOB));
      expect(thread.id).toBe(1);
      expect(thread.body).toBeNull();
    });

    it("can't be replied to", () => {
      expect(build(rows, student(ALICE))[0].canReply).toBe(false);
      expect(build(rows, staff)[0].canReply).toBe(false);
    });

    it("only Staff can hide", () => {
      const live = [row(1, ALICE, null)];
      expect(build(live, staff)[0].canHide).toBe(true);
      expect(build(live, student(BOB))[0].canHide).toBe(false);
    });
  });

  // ─── Deletion rights ───

  it("only the author can delete, never Staff", () => {
    const rows = [row(1, ALICE, null)];
    expect(build(rows, student(ALICE))[0].canDelete).toBe(true);
    expect(build(rows, student(BOB))[0].canDelete).toBe(false);
    expect(build(rows, staff)[0].canDelete).toBe(false);
  });

  // ─── Reactions ───

  describe("reactions", () => {
    it("counts each kind and marks the viewer's own", () => {
      const rows = [row(1, ALICE, null)];
      const reactions: ReactionRow[] = [
        { commentId: 1, userId: BOB, kind: ReactionKind.ThumbsUp },
        { commentId: 1, userId: CAROL, kind: ReactionKind.ThumbsUp },
        { commentId: 1, userId: CAROL, kind: ReactionKind.Eyes },
      ];
      const [thread] = build(rows, student(BOB), { reactions });
      const byKind = Object.fromEntries(
        thread.reactions.map((r) => [r.kind, r])
      );

      expect(thread.reactions).toHaveLength(5);
      expect(byKind[ReactionKind.ThumbsUp]).toEqual({
        kind: ReactionKind.ThumbsUp,
        count: 2,
        reacted: true,
      });
      expect(byKind[ReactionKind.Eyes]).toMatchObject({
        count: 1,
        reacted: false,
      });
      expect(byKind[ReactionKind.Heart]).toMatchObject({ count: 0 });
    });

    it("never reorders Comments", () => {
      const rows = [row(1, ALICE, null), row(2, BOB, null)];
      const reactions: ReactionRow[] = [
        { commentId: 2, userId: CAROL, kind: ReactionKind.Heart },
      ];
      expect(
        build(rows, student(CAROL), { reactions }).map((t) => t.id)
      ).toEqual([1, 2]);
    });

    it("is allowed only on someone else's live, visible Comment", () => {
      const rows = [
        row(1, ALICE, null),
        row(2, BOB, 1),
        row(3, BOB, 1, HIDDEN),
        row(4, BOB, 1, DELETED),
        row(5, CAROL, 4),
      ];
      const threads = build(rows, student(BOB));
      expect(find(threads, 1)?.canReact).toBe(true);
      expect(find(threads, 2)?.canReact).toBe(false); // own
      expect(find(threads, 3)?.canReact).toBe(false); // hidden
      expect(find(threads, 4)?.canReact).toBe(false); // deleted

      const author = 9;
      expect(
        canReactTo({ authorId: author, deletedAt: null, hiddenAt: null }, null)
      ).toBe(false);
    });
  });

  // ─── Flags ───

  describe("flags", () => {
    it("lets others flag, but not the author, Staff, or on Deleted Comments", () => {
      const rows = [row(1, ALICE, null), row(2, BOB, 1)];
      expect(build(rows, student(BOB))[0].canFlag).toBe(true);
      expect(build(rows, student(ALICE))[0].canFlag).toBe(false);
      expect(build(rows, staff)[0].canFlag).toBe(false);

      const deleted = [row(1, ALICE, null, DELETED), row(2, BOB, 1)];
      expect(build(deleted, student(CAROL))[0].canFlag).toBe(false);
    });

    it("marks the viewer's existing Flag", () => {
      const rows = [row(1, ALICE, null)];
      expect(build(rows, student(BOB), { flagged: [1] })[0].flagged).toBe(true);
      expect(build(rows, student(BOB))[0].flagged).toBe(false);
    });
  });

  // ─── Thread Participants and Muted Threads ───

  describe("muting", () => {
    it("offers Mute only to Thread Participants, on the top-level Comment", () => {
      const rows = [row(1, ALICE, null), row(2, BOB, 1), row(3, ALICE, 2)];
      const [forBob] = build(rows, student(BOB));
      expect(forBob.canMute).toBe(true);
      expect(forBob.replies[0].canMute).toBe(false);
      expect(build(rows, student(CAROL))[0].canMute).toBe(false);
    });

    it("drops Participants who deleted all their Comments, but counts hidden ones", () => {
      const rows = [
        row(1, ALICE, null),
        row(2, BOB, 1, DELETED),
        row(3, CAROL, 1, HIDDEN),
      ];
      expect(isThreadParticipant(rows, 1, BOB)).toBe(false);
      expect(isThreadParticipant(rows, 1, CAROL)).toBe(true);
      expect(build(rows, student(CAROL))[0].canMute).toBe(true);
    });

    it("reports muted Threads", () => {
      const rows = [row(1, ALICE, null)];
      expect(build(rows, student(ALICE), { muted: [1] })[0].muted).toBe(true);
    });
  });
});
