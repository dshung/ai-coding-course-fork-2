import { describe, it, expect } from "vitest";
import {
  collectThread,
  excerpt,
  isNotificationVisible,
  notificationHref,
  selectReplyRecipients,
  type ThreadComment,
} from "./notifications";

const DELETED = "2026-01-01T00:00:00.000Z";

function comment(
  id: number,
  userId: number,
  parentId: number | null,
  deletedAt: string | null = null
): ThreadComment {
  return { id, userId, parentId, deletedAt };
}

describe("selectReplyRecipients", () => {
  // Thread: 1 (user 10) → 2 (user 20) → 3 (user 30) → 4 (user 40)
  const thread = [
    comment(1, 10, null),
    comment(2, 20, 1),
    comment(3, 30, 2),
    comment(4, 40, 3),
  ];

  it("gives no recipients for a top-level comment", () => {
    expect(selectReplyRecipients(thread, [], comment(1, 10, null))).toEqual(
      []
    );
  });

  it("excludes the Reply's author", () => {
    expect(selectReplyRecipients(thread, [], comment(4, 40, 3))).toEqual([
      10, 20, 30,
    ]);
  });

  it("excludes the author even when they have other comments in the Thread", () => {
    const withMore = [...thread, comment(5, 20, 4)];
    expect(selectReplyRecipients(withMore, [], comment(5, 20, 4))).toEqual([
      10, 30, 40,
    ]);
  });

  it("includes Participants at any depth, not just ancestors", () => {
    // Reply on a sibling branch: 5 (user 50) replies to 1.
    const branched = [...thread, comment(5, 50, 1)];
    expect(selectReplyRecipients(branched, [], comment(5, 50, 1))).toEqual([
      10, 20, 30, 40,
    ]);
  });

  it("notifies each Participant once, however many comments they have", () => {
    const repeated = [...thread, comment(5, 10, 4), comment(6, 50, 5)];
    expect(selectReplyRecipients(repeated, [], comment(6, 50, 5))).toEqual([
      10, 20, 30, 40,
    ]);
  });

  it("excludes a user whose only comments are deleted", () => {
    const withDeleted = [
      comment(1, 10, null),
      comment(2, 20, 1, DELETED),
      comment(3, 30, 2),
    ];
    expect(selectReplyRecipients(withDeleted, [], comment(3, 30, 2))).toEqual([
      10,
    ]);
  });

  it("keeps a user who deleted one comment but still has a live one", () => {
    const partlyDeleted = [
      comment(1, 10, null),
      comment(2, 20, 1, DELETED),
      comment(3, 20, 1),
      comment(4, 30, 1),
    ];
    expect(selectReplyRecipients(partlyDeleted, [], comment(4, 30, 1))).toEqual(
      [10, 20]
    );
  });

  it("includes the author of a Hidden Comment", () => {
    // Hidden comments aren't deleted, so they carry deletedAt: null. The
    // rules never look at hiddenAt — hiding wasn't the author's choice.
    const withHidden = [
      comment(1, 10, null),
      { ...comment(2, 20, 1), hiddenAt: DELETED },
      comment(3, 30, 1),
    ];
    expect(selectReplyRecipients(withHidden, [], comment(3, 30, 1))).toEqual([
      10, 20,
    ]);
  });

  it("excludes users who muted the Thread", () => {
    expect(selectReplyRecipients(thread, [10, 20], comment(4, 40, 3))).toEqual(
      [30]
    );
  });

  it("still notifies the direct parent's author when they muted", () => {
    expect(
      selectReplyRecipients(thread, [10, 20, 30], comment(4, 40, 3))
    ).toEqual([30]);
  });

  it("gives no mute exception when the direct parent is deleted", () => {
    // User 30's parent comment is deleted, but they're still a Participant
    // through comment 5 — and they muted, so the mute wins.
    const parentDeleted = [
      comment(1, 10, null),
      comment(2, 20, 1),
      comment(3, 30, 2, DELETED),
      comment(5, 30, 1),
      comment(4, 40, 3),
    ];
    expect(
      selectReplyRecipients(parentDeleted, [30], comment(4, 40, 3))
    ).toEqual([10, 20]);
  });

  it("doesn't notify the deleted parent's author when that was their only comment", () => {
    const parentDeleted = [
      comment(1, 10, null),
      comment(2, 20, 1, DELETED),
      comment(3, 30, 2),
    ];
    expect(selectReplyRecipients(parentDeleted, [], comment(3, 30, 2))).toEqual(
      [10]
    );
  });

  it("doesn't notify the Reply's author through the parent exception", () => {
    // Replying to your own comment in a Thread you muted.
    const selfReply = [...thread, comment(5, 40, 4)];
    expect(selectReplyRecipients(selfReply, [40], comment(5, 40, 4))).toEqual([
      10, 20, 30,
    ]);
  });
});

describe("collectThread", () => {
  const lesson = [
    comment(1, 10, null),
    comment(2, 20, 1),
    comment(3, 30, 2),
    comment(4, 40, 3),
    comment(5, 50, null),
    comment(6, 60, 5),
  ];

  it("gathers the top-level comment and every descendant from a deep reply", () => {
    const ids = collectThread(lesson, 3)
      .map((c) => c.id)
      .sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3, 4]);
  });

  it("leaves out other Threads on the same lesson", () => {
    const ids = collectThread(lesson, 6)
      .map((c) => c.id)
      .sort((a, b) => a - b);
    expect(ids).toEqual([5, 6]);
  });

  it("returns nothing for an unknown comment", () => {
    expect(collectThread(lesson, 999)).toEqual([]);
  });
});

describe("isNotificationVisible", () => {
  const viewable = new Set([1]);
  const live = { courseId: 1, replyDeletedAt: null, replyHiddenAt: null };

  it("shows a live Reply in a course the user can view", () => {
    expect(isNotificationVisible(live, viewable)).toBe(true);
  });

  it("hides a deleted Reply", () => {
    expect(
      isNotificationVisible({ ...live, replyDeletedAt: DELETED }, viewable)
    ).toBe(false);
  });

  it("hides a Hidden Reply", () => {
    expect(
      isNotificationVisible({ ...live, replyHiddenAt: DELETED }, viewable)
    ).toBe(false);
  });

  it("hides notifications for a course the user can't currently view", () => {
    expect(isNotificationVisible({ ...live, courseId: 2 }, viewable)).toBe(
      false
    );
  });
});

describe("excerpt", () => {
  it("strips Markdown and collapses whitespace", () => {
    expect(excerpt("**Bold** and [a link](https://x.y)\n\n- item")).toBe(
      "Bold and a link item"
    );
  });

  it("truncates long text with an ellipsis", () => {
    const result = excerpt("a".repeat(200), 20);
    expect(result).toHaveLength(20);
    expect(result.endsWith("…")).toBe(true);
  });

  it("leaves short text alone", () => {
    expect(excerpt("Thanks!", 20)).toBe("Thanks!");
  });
});

describe("notificationHref", () => {
  it("anchors on the Reply in the lesson page", () => {
    expect(
      notificationHref({ courseSlug: "intro", lessonId: 7, replyId: 42 })
    ).toBe("/courses/intro/lessons/7#comment-42");
  });
});
