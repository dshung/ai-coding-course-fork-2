import { useEffect, useState } from "react";
import {
  Link,
  data,
  isRouteErrorResponse,
  useFetcher,
  useSearchParams,
} from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import type { Route } from "./+types/instructor.questions";
import { requireInstructorOrAdmin, requireStaff } from "~/lib/access.server";
import { renderComment } from "~/lib/comment-markdown.server";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Textarea } from "~/components/ui/textarea";
import { UserAvatar } from "~/components/user-avatar";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Flag,
  PencilLine,
} from "lucide-react";
import { cn, daysSince, formatRelativeTime } from "~/lib/utils";
import { MIN_COMMENT_LENGTH, MAX_COMMENT_LENGTH } from "~/lib/comments";
import { parseFormData } from "~/lib/validation";
import { getUnansweredQuestions } from "~/lib/unanswered-questions.server";
import {
  getCommentCourseId,
  getModerationQueue,
  keepHidden,
  type ModerationItem,
} from "~/lib/moderation.server";
import {
  dismissFlags,
  hideComment,
  unhideComment,
} from "~/lib/comments.server";
import { createReplyNotifications } from "~/lib/notifications.server";
import { db } from "~/db";
import { comments, courses, lessons, modules } from "~/db/schema";
import { eq } from "drizzle-orm";

function getCommentById(commentId: number) {
  return db.select().from(comments).where(eq(comments.id, commentId)).get();
}

function getCourseForLesson(lessonId: number) {
  return db
    .select({
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      instructorId: courses.instructorId,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, lessonId))
    .get();
}

function createComment(
  userId: number,
  lessonId: number,
  parentId: number | null,
  body: string
) {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    throw new Error("Comment cannot be empty");
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new Error(
      `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`
    );
  }

  const course = getCourseForLesson(lessonId);
  if (!course) {
    throw new Error("Lesson not found");
  }

  if (parentId !== null) {
    const parent = getCommentById(parentId);
    if (!parent) {
      throw new Error("Parent comment not found");
    }
    if (parent.lessonId !== lessonId) {
      throw new Error("Parent comment belongs to a different lesson");
    }
  }

  return db
    .insert(comments)
    .values({ userId, lessonId, parentId, body: trimmed })
    .returning()
    .get();
}

// A question sitting this long without an answer gets called out visually.
const STALE_AFTER_DAYS = 3;

const commentIdField = z.coerce.number().int();

const actionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("reply"),
    commentId: commentIdField,
    body: z.string(),
  }),
  z.object({ intent: z.literal("hide"), commentId: commentIdField }),
  z.object({ intent: z.literal("dismissFlags"), commentId: commentIdField }),
  z.object({ intent: z.literal("unhide"), commentId: commentIdField }),
  z.object({ intent: z.literal("keepHidden"), commentId: commentIdField }),
]);

type Intent = z.infer<typeof actionSchema>["intent"];

const TABS = ["questions", "flagged", "edited"] as const;
type Tab = (typeof TABS)[number];

function parseTab(value: string | null): Tab {
  return TABS.find((tab) => tab === value) ?? "questions";
}

export function meta() {
  return [{ title: "Questions & Moderation — Cadence" }];
}

async function withBodyHtml<T extends { body: string }>(items: T[]) {
  return Promise.all(
    items.map(async (item) => ({
      ...item,
      // Comment bodies are untrusted: renderComment, never renderMarkdown.
      bodyHtml: await renderComment(item.body),
    }))
  );
}

export async function loader({ request }: Route.LoaderArgs) {
  const { userId, isAdmin } = await requireInstructorOrAdmin(request);

  // Admins span every course; instructors see only the courses they own.
  const scope = isAdmin ? null : userId;
  const questions = getUnansweredQuestions(scope);
  const moderation = getModerationQueue(scope);

  return {
    questions: await withBodyHtml(questions),
    flagged: await withBodyHtml(moderation.flagged),
    editedAfterHiding: await withBodyHtml(moderation.editedAfterHiding),
    isAdmin,
  };
}

const SUCCESS_MESSAGES: Record<Intent, string> = {
  reply: "Reply posted.",
  hide: "Comment hidden.",
  dismissFlags: "Flags dismissed.",
  unhide: "Comment unhidden.",
  keepHidden: "Comment kept hidden.",
};

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const parsed = parseFormData(formData, actionSchema);

  if (!parsed.success) {
    return {
      ok: false,
      error:
        formData.get("intent") === "reply"
          ? "Enter a reply before posting."
          : "Invalid request.",
    };
  }

  const input = parsed.data;

  const courseId = getCommentCourseId(input.commentId);
  if (courseId === undefined) {
    throw data("Comment not found", { status: 404 });
  }

  // Answering and moderating both act as the course's voice, so it must be
  // the course's own instructor, or an admin. Checked per comment: the
  // comment id comes from the form and can't be trusted to be in scope.
  const access = await requireStaff(request, courseId);
  const staffUserId = access.userId!;

  try {
    switch (input.intent) {
      case "reply": {
        const question = getCommentById(input.commentId)!;
        const reply = createComment(
          staffUserId,
          question.lessonId,
          question.id,
          input.body
        );
        createReplyNotifications(reply.id);
        break;
      }
      case "hide":
        // Also resolves the comment's active Flags.
        hideComment(input.commentId, staffUserId);
        break;
      case "dismissFlags":
        dismissFlags(input.commentId);
        break;
      case "unhide":
        unhideComment(input.commentId);
        break;
      case "keepHidden":
        keepHidden(input.commentId);
        break;
    }
  } catch (error) {
    if (error instanceof Error) {
      return { ok: false, error: error.message };
    }
    throw error;
  }

  return { ok: true, message: SUCCESS_MESSAGES[input.intent] };
}

type Question = Awaited<ReturnType<typeof loader>>["questions"][number];

function QuestionCard({ question }: { question: Question }) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const [body, setBody] = useState("");
  const waitingDays = daysSince(question.createdAt);
  const stale = waitingDays >= STALE_AFTER_DAYS;
  const submitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;

    if (fetcher.data.error) {
      toast.error(fetcher.data.error);
    } else if (fetcher.data.ok) {
      setBody("");
      toast.success("Reply posted.");
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {question.courseTitle}
          </span>
          <span>/</span>
          <span>{question.lessonTitle}</span>
          <Link
            to={`/courses/${question.courseSlug}/lessons/${question.lessonId}`}
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
            Open lesson
          </Link>

          <span
            className={cn(
              "ml-auto rounded-full px-2 py-0.5 text-xs font-medium",
              stale
                ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                : "bg-muted text-muted-foreground"
            )}
            suppressHydrationWarning
          >
            {waitingDays === 0
              ? "Waiting today"
              : `Waiting ${waitingDays} day${waitingDays === 1 ? "" : "s"}`}
          </span>
        </div>

        <div className="flex items-start gap-3">
          <UserAvatar
            name={question.authorName}
            avatarUrl={question.authorAvatarUrl}
            className="size-8 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{question.authorName}</span>
              <span
                className="text-xs text-muted-foreground"
                suppressHydrationWarning
              >
                {formatRelativeTime(question.createdAt)}
              </span>
            </div>
            <div
              className="prose prose-sm prose-neutral dark:prose-invert mt-1 max-w-none"
              dangerouslySetInnerHTML={{ __html: question.bodyHtml }}
            />
          </div>
        </div>

        <fetcher.Form method="post" className="mt-4 space-y-2">
          <input type="hidden" name="intent" value="reply" />
          <input type="hidden" name="commentId" value={question.id} />

          <Textarea
            name="body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Answer this question..."
            rows={3}
            aria-label={`Reply to ${question.authorName}`}
          />

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              size="sm"
              disabled={
                submitting ||
                body.trim().length === 0 ||
                body.length > MAX_COMMENT_LENGTH
              }
            >
              {submitting ? "Posting..." : "Post reply"}
            </Button>
            <span
              className={cn(
                "ml-auto text-xs",
                body.length > MAX_COMMENT_LENGTH
                  ? "text-destructive"
                  : "text-muted-foreground"
              )}
            >
              {body.length} / {MAX_COMMENT_LENGTH}
            </span>
          </div>
        </fetcher.Form>
      </CardContent>
    </Card>
  );
}

type ReviewItem = ModerationItem & { bodyHtml: string };

function ReviewCard({
  item,
  kind,
}: {
  item: ReviewItem;
  kind: "flagged" | "edited";
}) {
  const fetcher = useFetcher<{
    ok?: boolean;
    error?: string;
    message?: string;
  }>();
  const submitting = fetcher.state !== "idle";
  const pendingIntent = submitting ? fetcher.formData?.get("intent") : null;

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;

    if (fetcher.data.error) {
      toast.error(fetcher.data.error);
    } else if (fetcher.data.ok && fetcher.data.message) {
      toast.success(fetcher.data.message);
    }
  }, [fetcher.state, fetcher.data]);

  const actions =
    kind === "flagged"
      ? [
          { intent: "hide", label: "Hide", variant: "destructive" as const },
          {
            intent: "dismissFlags",
            label: "Dismiss flags",
            variant: "outline" as const,
          },
        ]
      : [
          { intent: "unhide", label: "Unhide", variant: "default" as const },
          {
            intent: "keepHidden",
            label: "Keep hidden",
            variant: "outline" as const,
          },
        ];

  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {item.courseTitle}
          </span>
          <span>/</span>
          <span>{item.lessonTitle}</span>
          <Link
            to={`/courses/${item.courseSlug}/lessons/${item.lessonId}#comment-${item.id}`}
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
            View in thread
          </Link>

          {kind === "flagged" ? (
            <span
              className="ml-auto inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-300"
              suppressHydrationWarning
            >
              <Flag className="size-3" />
              {item.activeFlagCount} flag{item.activeFlagCount === 1 ? "" : "s"}
              {item.latestFlagAt &&
                ` · latest ${formatRelativeTime(item.latestFlagAt)}`}
            </span>
          ) : (
            <span
              className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300"
              suppressHydrationWarning
            >
              <PencilLine className="size-3" />
              Edited {item.editedAt && formatRelativeTime(item.editedAt)}
              {item.hiddenAt &&
                ` · hidden ${formatRelativeTime(item.hiddenAt)}`}
            </span>
          )}
        </div>

        <div className="flex items-start gap-3">
          <UserAvatar
            name={item.authorName}
            avatarUrl={item.authorAvatarUrl}
            className="size-8 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{item.authorName}</span>
              <span
                className="text-xs text-muted-foreground"
                suppressHydrationWarning
              >
                {formatRelativeTime(item.createdAt)}
              </span>
            </div>
            <div
              className="prose prose-sm prose-neutral dark:prose-invert mt-1 max-w-none"
              dangerouslySetInnerHTML={{ __html: item.bodyHtml }}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {actions.map((action) => (
            <fetcher.Form key={action.intent} method="post">
              <input type="hidden" name="intent" value={action.intent} />
              <input type="hidden" name="commentId" value={item.id} />
              <Button
                type="submit"
                size="sm"
                variant={action.variant}
                disabled={submitting}
              >
                {pendingIntent === action.intent ? "Saving..." : action.label}
              </Button>
            </fetcher.Form>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <CheckCircle2 className="mx-auto mb-4 size-12 text-green-600" />
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

function CountBadge({ count }: { count: number }) {
  return (
    <span
      className={cn(
        "ml-1.5 rounded-full px-1.5 text-xs font-medium tabular-nums",
        count > 0
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground"
      )}
    >
      {count}
    </span>
  );
}

export default function InstructorQuestions({
  loaderData,
}: Route.ComponentProps) {
  const { questions, flagged, editedAfterHiding, isAdmin } = loaderData;
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseTab(searchParams.get("tab"));

  function selectTab(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value === "questions") next.delete("tab");
    else next.set("tab", value);
    setSearchParams(next, { replace: true, preventScrollReset: true });
  }

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        {/* /instructor is instructor-only, so admins go back to their own list. */}
        <Link
          to={isAdmin ? "/admin/courses" : "/instructor"}
          className="hover:text-foreground"
        >
          {isAdmin ? "Manage Courses" : "My Courses"}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Questions</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-3xl font-bold">Questions &amp; Moderation</h1>
        <p className="mt-1 text-muted-foreground">
          {isAdmin
            ? "Unanswered questions and comments needing review across every course."
            : "Unanswered questions and comments needing review on your courses."}
        </p>
      </div>

      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="questions">
            Unanswered
            <CountBadge count={questions.length} />
          </TabsTrigger>
          <TabsTrigger value="flagged">
            Flagged
            <CountBadge count={flagged.length} />
          </TabsTrigger>
          <TabsTrigger value="edited">
            Edited after hiding
            <CountBadge count={editedAfterHiding.length} />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="questions" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? "Threads that no instructor or admin has replied to yet, at any depth."
              : "Threads on your courses that you haven't replied to yet, at any depth."}{" "}
            Replying here marks them answered.
          </p>
          {questions.length === 0 ? (
            <EmptyState
              title="You're all caught up"
              message="Every question on your courses has an answer."
            />
          ) : (
            questions.map((question) => (
              <QuestionCard key={question.id} question={question} />
            ))
          )}
        </TabsContent>

        <TabsContent value="flagged" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Comments readers flagged for your attention. Hide one to resolve its
            flags, or dismiss the flags to leave it visible.
          </p>
          {flagged.length === 0 ? (
            <EmptyState
              title="No flagged comments"
              message="Nobody has flagged a comment that still needs review."
            />
          ) : (
            flagged.map((item) => (
              <ReviewCard key={item.id} item={item} kind="flagged" />
            ))
          )}
        </TabsContent>

        <TabsContent value="edited" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Hidden comments their author has edited since they were hidden.
            Unhide one if the problem is fixed, or keep it hidden.
          </p>
          {editedAfterHiding.length === 0 ? (
            <EmptyState
              title="Nothing to re-review"
              message="No hidden comment has been edited since it was hidden."
            />
          ) : (
            editedAfterHiding.map((item) => (
              <ReviewCard key={item.id} item={item} kind="edited" />
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <Skeleton className="mb-6 h-4 w-40" />
      <Skeleton className="mb-2 h-9 w-72" />
      <Skeleton className="mb-6 h-4 w-96" />
      <div className="space-y-4">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading your questions.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Not allowed";
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have access to this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/instructor">
          <Button>My Courses</Button>
        </Link>
      </div>
    </div>
  );
}
