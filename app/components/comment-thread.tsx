import { useEffect, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import {
  Bell,
  BellOff,
  CornerDownRight,
  Eye,
  EyeOff,
  Flag,
  MessageSquare,
  Pencil,
  Reply,
  Trash2,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Textarea } from "~/components/ui/textarea";
import { UserAvatar } from "~/components/user-avatar";
import { cn, formatRelativeTime } from "~/lib/utils";
import { MAX_COMMENT_LENGTH } from "~/lib/comments";
import {
  MAX_INDENT_DEPTH,
  REACTIONS,
  type ThreadNode,
} from "~/lib/comment-thread";

// Bodies arrive pre-rendered from the server (renderComment), because comments
// are untrusted markdown and the sanitising renderer is server-only. Every
// permission flag and withheld field was decided on the server by
// buildLessonThreads; the server re-checks each action regardless.
export type RenderedComment = Omit<ThreadNode, "replies"> & {
  /** Null when withheld from this viewer (Deleted or Hidden Comment). */
  bodyHtml: string | null;
  replies: RenderedComment[];
};

function AuthorBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
      {label}
    </span>
  );
}

function CommentForm({
  intent,
  parentId,
  commentId,
  defaultValue,
  placeholder,
  submitLabel,
  autoFocus,
  onDone,
}: {
  intent: "create-comment" | "edit-comment";
  parentId?: number;
  commentId?: number;
  defaultValue?: string;
  placeholder: string;
  submitLabel: string;
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const [body, setBody] = useState(defaultValue ?? "");
  const submitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;

    if (fetcher.data.error) {
      toast.error(fetcher.data.error);
      return;
    }

    if (fetcher.data.ok) {
      if (intent === "create-comment") setBody("");
      onDone?.();
    }
    // onDone is recreated each render by callers; depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data, intent]);

  const tooLong = body.length > MAX_COMMENT_LENGTH;
  const empty = body.trim().length === 0;

  return (
    <fetcher.Form method="post" className="space-y-2">
      <input type="hidden" name="intent" value={intent} />
      {parentId !== undefined && (
        <input type="hidden" name="parentId" value={parentId} />
      )}
      {commentId !== undefined && (
        <input type="hidden" name="commentId" value={commentId} />
      )}

      <Textarea
        name="body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        rows={4}
        autoFocus={autoFocus}
        aria-label={placeholder}
      />

      <div className="flex items-center gap-3">
        <Button
          type="submit"
          size="sm"
          disabled={submitting || empty || tooLong}
        >
          {submitting ? "Posting..." : submitLabel}
        </Button>

        {onDone && (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Cancel
          </Button>
        )}

        <span
          className={cn(
            "ml-auto text-xs",
            tooLong ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {body.length} / {MAX_COMMENT_LENGTH}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        Markdown supported. Use ``` for code blocks.
      </p>
    </fetcher.Form>
  );
}

/**
 * A one-click action posted to the lesson route's action as an `intent`.
 * Errors come back as `{ error }` and are toasted.
 */
function IntentButton({
  intent,
  fields,
  confirmMessage,
  disabled,
  variant = "ghost",
  className,
  title,
  ariaPressed,
  children,
}: {
  intent: string;
  fields: Record<string, string | number>;
  confirmMessage?: string;
  disabled?: boolean;
  variant?: "ghost" | "secondary" | "outline";
  className?: string;
  title?: string;
  ariaPressed?: boolean;
  children: ReactNode;
}) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <fetcher.Form
      method="post"
      onSubmit={(event) => {
        if (confirmMessage && !confirm(confirmMessage)) event.preventDefault();
      }}
    >
      <input type="hidden" name="intent" value={intent} />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button
        type="submit"
        variant={variant}
        size="sm"
        className={className}
        title={title}
        aria-pressed={ariaPressed}
        disabled={disabled || fetcher.state !== "idle"}
      >
        {children}
      </Button>
    </fetcher.Form>
  );
}

function Reactions({ comment }: { comment: RenderedComment }) {
  // Readers who can't react still see counts, but only kinds someone used.
  const shown = REACTIONS.map((meta) => ({
    ...meta,
    summary: comment.reactions.find((r) => r.kind === meta.kind),
  })).filter(({ summary }) => comment.canReact || (summary?.count ?? 0) > 0);

  if (shown.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {shown.map(({ kind, emoji, label, summary }) => {
        const count = summary?.count ?? 0;
        const reacted = summary?.reacted ?? false;
        return (
          <IntentButton
            key={kind}
            intent="toggle-reaction"
            fields={{ commentId: comment.id, kind }}
            disabled={!comment.canReact}
            variant="outline"
            ariaPressed={reacted}
            title={reacted ? `Remove ${label}` : label}
            className={cn(
              "h-7 gap-1 rounded-full px-2 text-xs",
              reacted && "border-primary bg-primary/10 text-primary",
              !comment.canReact && "disabled:opacity-100"
            )}
          >
            <span aria-hidden>{emoji}</span>
            {count > 0 && <span>{count}</span>}
            <span className="sr-only">{label}</span>
          </IntentButton>
        );
      })}
    </div>
  );
}

function CommentActions({
  comment,
  onEdit,
  onReply,
}: {
  comment: RenderedComment;
  onEdit: () => void;
  onReply: () => void;
}) {
  const showFlag = comment.canFlag || comment.flagged;
  const any =
    comment.canReply ||
    comment.canEdit ||
    comment.canDelete ||
    comment.canHide ||
    comment.canUnhide ||
    comment.canMute ||
    showFlag;
  if (!any) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {comment.canReply && (
        <Button variant="ghost" size="sm" onClick={onReply}>
          <Reply className="mr-1 size-3.5" />
          Reply
        </Button>
      )}

      {comment.canEdit && (
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="mr-1 size-3.5" />
          Edit
        </Button>
      )}

      {comment.canDelete && (
        <IntentButton
          intent="delete-comment"
          fields={{ commentId: comment.id }}
          confirmMessage="Delete this comment?"
        >
          <Trash2 className="mr-1 size-3.5" />
          Delete
        </IntentButton>
      )}

      {comment.canHide && (
        <IntentButton
          intent="hide-comment"
          fields={{ commentId: comment.id }}
          confirmMessage="Hide this comment from other students?"
        >
          <EyeOff className="mr-1 size-3.5" />
          Hide
        </IntentButton>
      )}

      {comment.canUnhide && (
        <IntentButton
          intent="unhide-comment"
          fields={{ commentId: comment.id }}
        >
          <Eye className="mr-1 size-3.5" />
          Unhide
        </IntentButton>
      )}

      {showFlag && (
        <IntentButton
          intent="flag-comment"
          fields={{ commentId: comment.id }}
          disabled={comment.flagged}
          confirmMessage="Flag this comment for the instructor to review?"
        >
          <Flag className="mr-1 size-3.5" />
          {comment.flagged ? "Flagged" : "Flag"}
        </IntentButton>
      )}

      {comment.canMute && (
        <IntentButton
          intent={comment.muted ? "unmute-thread" : "mute-thread"}
          fields={{ commentId: comment.id }}
          title={
            comment.muted
              ? "Get notified about new replies in this thread"
              : "Stop notifications about new replies in this thread"
          }
        >
          {comment.muted ? (
            <Bell className="mr-1 size-3.5" />
          ) : (
            <BellOff className="mr-1 size-3.5" />
          )}
          {comment.muted ? "Unmute" : "Mute"}
        </IntentButton>
      )}
    </div>
  );
}

function ReplyingTo({ comment }: { comment: RenderedComment }) {
  // Only once indentation has stopped — before that, nesting shows it.
  if (comment.replyingTo === null || comment.depth <= MAX_INDENT_DEPTH) {
    return null;
  }
  return (
    <a
      href={
        comment.parentId !== null ? `#comment-${comment.parentId}` : undefined
      }
      className="mb-1 flex items-center gap-1 text-xs text-muted-foreground hover:underline"
    >
      <CornerDownRight className="size-3" />
      Replying to {comment.replyingTo}
    </a>
  );
}

function CommentItem({ comment }: { comment: RenderedComment }) {
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);

  const anchorProps = {
    id: `comment-${comment.id}`,
    className: cn(
      "scroll-mt-24 rounded-md py-3 target:bg-primary/5",
      // Gap from the indented container's border; none once indenting stops.
      comment.depth > 0 && comment.depth <= MAX_INDENT_DEPTH && "pl-3"
    ),
  };

  // Placeholder: a Deleted Comment kept for its Replies, or a Hidden Comment
  // whose author and body are withheld from this viewer. Anonymous either way.
  if (comment.author === null || comment.bodyHtml === null) {
    return (
      <div {...anchorProps}>
        <ReplyingTo comment={comment} />
        <p className="text-sm italic text-muted-foreground">
          {comment.deleted
            ? "This comment was deleted."
            : "This comment was hidden by the instructor."}
        </p>
        {/* Placeholders can still carry Mute for a Thread Participant. */}
        <CommentActions
          comment={comment}
          onEdit={() => {}}
          onReply={() => {}}
        />
        <Replies comment={comment} />
      </div>
    );
  }

  const author = comment.author;

  return (
    <div {...anchorProps}>
      <ReplyingTo comment={comment} />
      <div className="flex items-start gap-3">
        <UserAvatar
          name={author.name}
          avatarUrl={author.avatarUrl}
          className="size-8 shrink-0"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{author.name}</span>
            {author.isInstructor && <AuthorBadge label="Instructor" />}
            {author.isAdmin && <AuthorBadge label="Admin" />}
            <span
              className="text-xs text-muted-foreground"
              suppressHydrationWarning
            >
              {formatRelativeTime(comment.createdAt)}
            </span>
            {comment.editedAt && (
              <span
                className="text-xs text-muted-foreground"
                title={`Edited ${comment.editedAt}`}
              >
                (edited)
              </span>
            )}
            {comment.hidden && (
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                <EyeOff className="size-3" />
                Hidden by the instructor
              </span>
            )}
          </div>

          {editing ? (
            <div className="mt-2">
              <CommentForm
                intent="edit-comment"
                commentId={comment.id}
                defaultValue={comment.body ?? ""}
                placeholder="Edit your comment"
                submitLabel="Save changes"
                autoFocus
                onDone={() => setEditing(false)}
              />
            </div>
          ) : (
            <div
              className="prose prose-sm prose-neutral dark:prose-invert mt-1 max-w-none"
              dangerouslySetInnerHTML={{ __html: comment.bodyHtml }}
            />
          )}

          {!editing && <Reactions comment={comment} />}

          {!editing && (
            <CommentActions
              comment={comment}
              onEdit={() => setEditing(true)}
              onReply={() => setReplying(true)}
            />
          )}

          {replying && (
            <div className="mt-3">
              <CommentForm
                intent="create-comment"
                parentId={comment.id}
                placeholder={`Reply to ${author.name}`}
                submitLabel="Post reply"
                autoFocus
                onDone={() => setReplying(false)}
              />
            </div>
          )}
        </div>
      </div>

      <Replies comment={comment} />
    </div>
  );
}

function Replies({ comment }: { comment: RenderedComment }) {
  if (comment.replies.length === 0) return null;

  // Indent up to MAX_INDENT_DEPTH; deeper Replies line up with their parent
  // and show "Replying to X" instead, so deep Threads stay readable.
  const indent = comment.depth < MAX_INDENT_DEPTH;

  return (
    <div className={cn("mt-1 space-y-1", indent && "ml-4 border-l sm:ml-6")}>
      {comment.replies.map((reply) => (
        <CommentItem key={reply.id} comment={reply} />
      ))}
    </div>
  );
}

export function CommentThread({
  comments,
  canPost,
  instructorName,
}: {
  comments: RenderedComment[];
  canPost: boolean;
  instructorName: string;
}) {
  return (
    <Card className="mb-8">
      <CardContent className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <MessageSquare className="size-5 text-primary" />
          <h2 className="text-xl font-semibold">Questions &amp; Discussion</h2>
        </div>

        {comments.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="font-medium">Stuck on this lesson?</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ask here — {instructorName} answers questions in this course.
              There&apos;s no such thing as a question that&apos;s too basic.
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {comments.map((comment) => (
              <CommentItem key={comment.id} comment={comment} />
            ))}
          </div>
        )}

        {canPost && (
          <div className="mt-6 border-t pt-6">
            <CommentForm
              intent="create-comment"
              placeholder="Ask a question or share what you found..."
              submitLabel="Post comment"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
