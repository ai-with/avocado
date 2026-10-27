import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import type { AppEnv } from "../types";
import type { Db } from "../db";
import { notificationReads, notifications } from "../db/schema";
import { ApiError } from "../lib/errors";
import { now } from "../lib/ids";
import { workspaceCtx } from "../middleware/auth";
import { NOTIFICATION_LIST_LIMIT, countUnread, type NotificationItem } from "../../shared/notifications";

// /api/notifications: 앱 안 알림 목록, 읽음 처리 (AIWITH-290)
// ponytail: 안 읽은 수는 최근 30개 안에서만 센다. 더 오래된 안 읽은 알림을 세야 하면 COUNT 쿼리로 바꾼다

async function recent(db: Db, workspaceId: string, userId: string): Promise<NotificationItem[]> {
  const rows = await db
    .select({ n: notifications, readAt: notificationReads.readAt })
    .from(notifications)
    .leftJoin(notificationReads, and(eq(notificationReads.notificationId, notifications.id), eq(notificationReads.userId, userId)))
    .where(eq(notifications.workspaceId, workspaceId))
    .orderBy(desc(notifications.createdAt))
    .limit(NOTIFICATION_LIST_LIMIT);
  return rows.map(({ n, readAt }) => ({ id: n.id, kind: n.kind, title: n.title, linkPath: n.linkPath, createdAt: n.createdAt, read: readAt !== null }));
}

const markRead = (db: Db, ids: string[], userId: string) =>
  ids.length ? db.insert(notificationReads).values(ids.map((notificationId) => ({ notificationId, userId, readAt: now() }))).onConflictDoNothing() : null;

export const notificationRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { workspace, user } = workspaceCtx(c);
    const items = await recent(c.var.db, workspace.id, user.id);
    return c.json({ items, unread: countUnread(items) });
  })
  .post("/read-all", async (c) => {
    const { workspace, user } = workspaceCtx(c);
    const db = c.var.db;
    const unread = (await recent(db, workspace.id, user.id)).filter((i) => !i.read).map((i) => i.id);
    await markRead(db, unread, user.id);
    return c.json({ ok: true, unread: 0 });
  })
  // 다른 워크스페이스 알림은 있어도 없는 것처럼 404
  .post("/:id/read", async (c) => {
    const { workspace, user } = workspaceCtx(c);
    const db = c.var.db;
    const row = await db.select({ workspaceId: notifications.workspaceId }).from(notifications).where(eq(notifications.id, c.req.param("id"))).get();
    if (!row || row.workspaceId !== workspace.id) throw new ApiError(404, "notification_not_found", "알림을 찾을 수 없어요.");
    await markRead(db, [c.req.param("id")], user.id);
    return c.json({ ok: true });
  });
