import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { workspaces } from "./workspaces";
import { guides, influencers } from "./guides";
import type { IgTarget, KeywordDmSendStatus, MissingReason, OffsetH, SnapshotPath, SnapshotStatus } from "../../../shared/performance";

// F-54, F-64 인스타그램 연결. 토큰은 AES-GCM 암호문만 저장한다.
// connected_at 이 null 이면 고객사 연결 요청(connect_token)만 만든 상태
export const igConnections = sqliteTable(
  "ig_connections",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    influencerId: text("influencer_id").references(() => influencers.id, { onDelete: "cascade" }),
    target: text("target").$type<IgTarget>().notNull(),
    connectToken: text("connect_token").unique(),
    label: text("label"),
    igUserId: text("ig_user_id"),
    username: text("username"),
    accountType: text("account_type"),
    scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull(),
    tokenEnc: text("token_enc"),
    expiresAt: integer("expires_at"),
    revokedAt: integer("revoked_at"),
    connectedAt: integer("connected_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("ig_connections_ws_idx").on(t.workspaceId, t.target), index("ig_connections_influencer_idx").on(t.influencerId), index("ig_connections_ig_user_idx").on(t.igUserId)],
);

// F-48. content_id 는 TASK-020 의 contents. FK 는 migrations/0006_performance.sql 에만 둔다
export const metricSnapshots = sqliteTable(
  "metric_snapshots",
  {
    id: text("id").primaryKey(),
    contentId: text("content_id").notNull(),
    offsetH: integer("offset_h").$type<OffsetH>().notNull(),
    scheduledAt: integer("scheduled_at").notNull(),
    collectionToken: text("collection_token"),
    collectionStartedAt: integer("collection_started_at"),
    capturedAt: integer("captured_at"),
    path: text("path").$type<SnapshotPath>(),
    views: integer("views"),
    likes: integer("likes"),
    saved: integer("saved"),
    shares: integer("shares"),
    comments: integer("comments"),
    reach: integer("reach"),
    reposts: integer("reposts"),
    missing: text("missing", { mode: "json" }).$type<Partial<Record<string, MissingReason>>>().notNull(),
    delayed: integer("delayed", { mode: "boolean" }).notNull().default(false),
    attempts: integer("attempts").notNull().default(0),
    status: text("status").$type<SnapshotStatus>().notNull(),
  },
  (t) => [uniqueIndex("metric_snapshots_content_offset_idx").on(t.contentId, t.offsetH), index("metric_snapshots_due_idx").on(t.status, t.scheduledAt)],
);

export type RuleStatus = "on" | "off" | "paused";

// F-64. 브랜드 본인 계정 게시물만 (ig_connection_id = brand_sender)
export const keywordDmRules = sqliteTable(
  "keyword_dm_rules",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    guideId: text("guide_id").references(() => guides.id, { onDelete: "set null" }),
    igConnectionId: text("ig_connection_id").references(() => igConnections.id, { onDelete: "set null" }),
    igMediaId: text("ig_media_id").notNull(),
    mediaThumbUrl: text("media_thumb_url"),
    mediaPermalink: text("media_permalink"),
    influencerId: text("influencer_id").references(() => influencers.id, { onDelete: "set null" }),
    keywords: text("keywords", { mode: "json" }).$type<string[]>().notNull(),
    message: text("message").notNull(),
    publicReplyVariants: text("public_reply_variants", { mode: "json" }).$type<string[]>().notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    status: text("status").$type<RuleStatus>().notNull().default("off"),
    pausedReason: text("paused_reason"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("keyword_dm_rules_ws_idx").on(t.workspaceId), index("keyword_dm_rules_media_idx").on(t.igMediaId)],
);

export const keywordDmSends = sqliteTable(
  "keyword_dm_sends",
  {
    id: text("id").primaryKey(),
    ruleId: text("rule_id").notNull().references(() => keywordDmRules.id, { onDelete: "cascade" }),
    commentId: text("comment_id").notNull(),
    igUserId: text("ig_user_id").notNull(),
    username: text("username"),
    commentText: text("comment_text"),
    commentAt: integer("comment_at").notNull(),
    sentAt: integer("sent_at"),
    status: text("status").$type<KeywordDmSendStatus>().notNull(),
    reason: text("reason"),
    linkId: text("link_id"),
  },
  (t) => [uniqueIndex("keyword_dm_sends_comment_idx").on(t.ruleId, t.commentId), index("keyword_dm_sends_rule_user_idx").on(t.ruleId, t.igUserId), index("keyword_dm_sends_status_idx").on(t.status, t.sentAt)],
);
