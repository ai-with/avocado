import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core";
import type { NotificationKind } from "../../../shared/notifications";
import { users } from "./users";
import { workspaces } from "./workspaces";

// 앱 안 알림 (0015). 워크스페이스 멤버 모두에게 보이고, 읽음은 사용자별로 남긴다
export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    kind: text("kind").$type<NotificationKind>().notNull(),
    title: text("title").notNull(),
    linkPath: text("link_path").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("notifications_ws_created_idx").on(t.workspaceId, t.createdAt)],
);

export const notificationReads = sqliteTable(
  "notification_reads",
  {
    notificationId: text("notification_id").notNull().references(() => notifications.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    readAt: integer("read_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.notificationId, t.userId] })],
);
