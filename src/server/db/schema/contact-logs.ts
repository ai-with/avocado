import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import type { ContactChannel, ContactLogKind } from "../../../shared/participation";
import { guideInfluencers } from "./guides";
import { users } from "./users";
import { workspaces } from "./workspaces";

// 소통 이력 (0018, TASK-072). 캠페인 참여 한 줄(guide_influencers)마다 시간순으로 쌓는다
export const contactLogs = sqliteTable(
  "contact_logs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    guideInfluencerId: text("guide_influencer_id").notNull().references(() => guideInfluencers.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ContactLogKind>().notNull(),
    channel: text("channel").$type<ContactChannel>(),
    lang: text("lang"),
    body: text("body").notNull(),
    meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("contact_logs_gi_idx").on(t.guideInfluencerId, t.createdAt)],
);
