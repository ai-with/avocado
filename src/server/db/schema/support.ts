import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import type { SupportStatus, SupportType } from "../../../shared/support";
import { users } from "./users";
import { workspaces } from "./workspaces";

// 도움 받기 문의. 운영 전달은 SUPPORT_EMAIL 메일, 저장은 항상 한다
export const supportRequests = sqliteTable(
  "support_requests",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<SupportType>().notNull(),
    body: text("body").notNull(),
    replyEmail: text("reply_email").notNull(),
    status: text("status").$type<SupportStatus>().notNull().default("received"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("support_requests_ws_user_idx").on(t.workspaceId, t.userId, t.createdAt)],
);
