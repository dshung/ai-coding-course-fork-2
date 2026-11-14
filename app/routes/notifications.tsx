import { Form, data, redirect, useNavigation } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/notifications";
import { requireUserId } from "~/lib/access.server";
import {
  getNotificationsForUser,
  markAllNotificationsRead,
  openNotification,
} from "~/lib/notifications.server";
import { excerpt, notificationHref } from "~/lib/notifications";
import { parseFormData } from "~/lib/validation";
import { cn, formatRelativeTime } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { UserAvatar } from "~/components/user-avatar";
import { Bell, CheckCheck } from "lucide-react";

const notificationActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("open"),
    notificationId: z.coerce.number().int(),
  }),
  z.object({
    intent: z.literal("mark-all-read"),
  }),
]);

export function meta() {
  return [{ title: "Notifications — Cadence" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const notifications = await getNotificationsForUser(request, userId);

  return {
    notifications: notifications.map((n) => ({
      id: n.id,
      createdAt: n.createdAt,
      unread: n.readAt === null,
      authorName: n.authorName,
      authorAvatarUrl: n.authorAvatarUrl,
      lessonTitle: n.lessonTitle,
      courseTitle: n.courseTitle,
      excerpt: excerpt(n.replyBody),
      href: notificationHref(n),
    })),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const formData = await request.formData();
  const parsed = parseFormData(formData, notificationActionSchema);

  if (!parsed.success) {
    throw data("Invalid request", { status: 400 });
  }

  if (parsed.data.intent === "open") {
    // The link target comes from the database, never from the form.
    const target = openNotification(userId, parsed.data.notificationId);
    if (!target) {
      throw data("Notification not found", { status: 404 });
    }
    return redirect(notificationHref(target));
  }

  await markAllNotificationsRead(request, userId);
  return { ok: true };
}

export default function Notifications({ loaderData }: Route.ComponentProps) {
  const { notifications } = loaderData;
  const navigation = useNavigation();
  const unreadCount = notifications.filter((n) => n.unread).length;
  const markingAll =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "mark-all-read";

  return (
    <div className="mx-auto max-w-3xl p-6 lg:p-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Notifications</h1>
          <p className="mt-1 text-muted-foreground">
            {unreadCount === 0
              ? "You're all caught up."
              : `${unreadCount} unread repl${unreadCount === 1 ? "y" : "ies"} in your discussions.`}
          </p>
        </div>
        {unreadCount > 0 && (
          <Form method="post">
            <input type="hidden" name="intent" value="mark-all-read" />
            <Button type="submit" variant="outline" size="sm" disabled={markingAll}>
              <CheckCheck className="size-4" />
              {markingAll ? "Marking..." : "Mark all read"}
            </Button>
          </Form>
        )}
      </div>

      {notifications.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Bell className="mx-auto mb-4 size-12 text-muted-foreground" />
            <p className="font-medium">No notifications yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              When someone replies in a discussion you've joined, it shows up
              here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => (
            <li key={n.id}>
              <Form method="post">
                <input type="hidden" name="intent" value="open" />
                <input type="hidden" name="notificationId" value={n.id} />
                <button
                  type="submit"
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-accent",
                    n.unread
                      ? "border-primary/30 bg-primary/5"
                      : "border-border bg-card text-muted-foreground"
                  )}
                >
                  <UserAvatar
                    name={n.authorName}
                    avatarUrl={n.authorAvatarUrl}
                    className="size-8 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm", n.unread && "text-foreground")}>
                      <span className={cn(n.unread && "font-semibold")}>
                        {n.authorName}
                      </span>{" "}
                      replied in &lsquo;{n.lessonTitle}&rsquo;{" "}
                      <span className="text-muted-foreground">
                        ({n.courseTitle})
                      </span>
                    </p>
                    {n.excerpt && (
                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        {n.excerpt}
                      </p>
                    )}
                    <p
                      className="mt-1 text-xs text-muted-foreground"
                      suppressHydrationWarning
                    >
                      {formatRelativeTime(n.createdAt)}
                    </p>
                  </div>
                  {n.unread && (
                    <span
                      className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                      aria-label="Unread"
                    />
                  )}
                </button>
              </Form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-3xl p-6 lg:p-8">
      <Skeleton className="mb-2 h-9 w-56" />
      <Skeleton className="mb-6 h-4 w-72" />
      <div className="space-y-2">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  );
}
