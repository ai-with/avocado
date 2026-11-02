import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
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
    generation: text("generation").notNull().default(""),
    connectExpiresAt: integer("connect_expires_at"),
    grantsVerifiedAt: integer("grants_verified_at"),
    disconnectedAt: integer("disconnected_at"),
    disconnectedReason: text("disconnected_reason"),
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
  (t) => [index("ig_connections_ws_idx").on(t.workspaceId, t.target), index("ig_connections_influencer_idx").on(t.influencerId), index("ig_connections_ig_user_idx").on(t.igUserId), index("ig_connections_expiry_idx").on(t.expiresAt, t.id).where(sql`${t.disconnectedAt} IS NULL AND ${t.revokedAt} IS NULL`)],
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
    dmRevision: integer("dm_revision").notNull().default(0),
  },
  (t) => [index("keyword_dm_rules_ws_idx").on(t.workspaceId), index("keyword_dm_rules_media_idx").on(t.igMediaId)],
);

export const dmChannelConsents = sqliteTable("dm_channel_consents", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  connectionId: text("connection_id").notNull().references(() => igConnections.id, { onDelete: "cascade" }),
  connectionGeneration: text("connection_generation").notNull(), appHmac: text("app_hmac").notNull(), recipientHmac: text("recipient_hmac").notNull(),
  recipientNamespace: text("recipient_namespace").$type<"instagram_messaging_igsid">().notNull(),
  revision: integer("revision").notNull(), status: text("status").$type<"granted" | "revoked">().notNull(),
  noticeDigest: text("notice_digest").notNull(), proofHmac: text("proof_hmac").notNull(),
  grantedAt: integer("granted_at"), revokedAt: integer("revoked_at"), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (t) => [uniqueIndex("dm_channel_consents_scope_idx").on(t.workspaceId, t.connectionId, t.connectionGeneration, t.appHmac, t.recipientHmac)]);
export const dmConsentReceipts = sqliteTable("dm_consent_receipts", {
  proofHmac: text("proof_hmac").primaryKey(), consentId: text("consent_id").notNull().references(() => dmChannelConsents.id, { onDelete: "cascade" }),
  fingerprint: text("fingerprint").notNull(), revision: integer("revision").notNull(), action: text("action").$type<"grant" | "revoke">().notNull(), createdAt: integer("created_at").notNull(),
});

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
    dmConsentId: text("dm_consent_id").references(() => dmChannelConsents.id, { onDelete: "set null" }),
    dmConsentRevision: integer("dm_consent_revision"), dmAppHmac: text("dm_app_hmac"), dmRecipientHmac: text("dm_recipient_hmac"),
    dmSenderGeneration: text("dm_sender_generation"), dmRuleHmac: text("dm_rule_hmac"), dmAttemptToken: text("dm_attempt_token"), dmAttemptAt: integer("dm_attempt_at"),
  },
  (t) => [uniqueIndex("keyword_dm_sends_comment_idx").on(t.ruleId, t.commentId), index("keyword_dm_sends_rule_user_idx").on(t.ruleId, t.igUserId), index("keyword_dm_sends_status_idx").on(t.status, t.sentAt),
    index("keyword_dm_sends_consent_idx").on(t.dmConsentId, t.status), index("keyword_dm_sends_attempt_idx").on(t.status, t.dmAttemptAt)],
);
