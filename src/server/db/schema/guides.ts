import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";
import { workspaces } from "./workspaces";
import type { DriveAccess, GuideProduct, RuleSeverity, RuleTarget, RuleType, SecondaryUseScope, VideoGuide, GuideRule } from "../../../shared/guides";
import type { ParticipationStatus, ParticipationTerms } from "../../../shared/participation";

// F-55 규정 세트. 규칙이 바뀌면 version 이 오르고 규칙 행에 그 시점 version 을 남긴다
export const guidelineSets = sqliteTable(
  "guideline_sets",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("guideline_sets_workspace_idx").on(t.workspaceId)],
);

export const guidelineRules = sqliteTable(
  "guideline_rules",
  {
    id: text("id").primaryKey(),
    setId: text("set_id").notNull().references(() => guidelineSets.id, { onDelete: "cascade" }),
    type: text("type").$type<RuleType>().notNull(),
    content: text("content").notNull(),
    severity: text("severity").$type<RuleSeverity>().notNull(),
    targets: text("targets", { mode: "json" }).$type<RuleTarget[]>().notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    version: integer("version").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("guideline_rules_set_idx").on(t.setId)],
);

export type GuideStatus = "draft" | "published";

export const guides = sqliteTable(
  "guides",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    guidelineSetId: text("guideline_set_id").references(() => guidelineSets.id, { onDelete: "set null" }),
    // 가이드 전용 규칙. id 는 rule_ 로 시작하는 newId
    extraRules: text("extra_rules", { mode: "json" }).$type<GuideRule[]>().notNull(),
    status: text("status").$type<GuideStatus>().notNull().default("draft"),
    // TASK-070 (0017): 캠페인 1:1. 컬럼은 null 허용(FK 없음), 앱에서는 필수로 다룬다
    campaignId: text("campaign_id"),
    // TASK-079 (0021): 이번 캠페인에서 끈 사전 규칙 id (bt:<termId>, legal:<id>)
    brandTermExclusions: text("brand_term_exclusions", { mode: "json" }).$type<string[]>().notNull().default([]),
    product: text("product", { mode: "json" }).$type<GuideProduct>().notNull(),
    purpose: text("purpose").notNull().default(""),
    lengthS: integer("length_s"),
    lang: text("lang").$type<"ko" | "en">().notNull().default("ko"),
    deadlineAt: integer("deadline_at"),
    deliverables: text("deliverables", { mode: "json" }).$type<{ final: boolean; clean: boolean; note: string }>().notNull(),
    secondaryUseScope: text("secondary_use_scope", { mode: "json" }).$type<SecondaryUseScope>().notNull(),
    videoGuide: text("video_guide", { mode: "json" }).$type<VideoGuide | null>(),
    generatedByModel: text("generated_by_model"),
    publishedAt: integer("published_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("guides_workspace_idx").on(t.workspaceId, t.createdAt), uniqueIndex("guides_campaign_unique").on(t.campaignId)],
);

export const influencers = sqliteTable(
  "influencers",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    igHandle: text("ig_handle"),
    threadsHandle: text("threads_handle"),
    email: text("email"),
    lang: text("lang").$type<"ko" | "en">().notNull().default("ko"),
    country: text("country"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("influencers_workspace_idx").on(t.workspaceId)],
);

// 단계: invited → viewed → consented → uploaded (이후 단계는 TASK-020/022 가 갱신)
export const guideInfluencers = sqliteTable(
  "guide_influencers",
  {
    id: text("id").primaryKey(),
    guideId: text("guide_id").notNull().references(() => guides.id, { onDelete: "cascade" }),
    influencerId: text("influencer_id").notNull().references(() => influencers.id, { onDelete: "cascade" }),
    guideToken: text("guide_token").notNull().unique(),
    uploadToken: text("upload_token").notNull().unique(),
    feedbackToken: text("feedback_token").notNull().unique(),
    connectToken: text("connect_token").notNull().unique(),
    stage: text("stage").notNull().default("invited"),
    // TASK-072 (0018): 브랜드가 보는 진행 상태와 조건
    status: text("status").$type<ParticipationStatus>().notNull().default("contact"),
    terms: text("terms", { mode: "json" }).$type<ParticipationTerms | null>(),
    // TASK-074 (0020): 계약 기간(ms). 종료일까지 최종 영상이 올라와야 한다
    contractStartAt: integer("contract_start_at"),
    contractEndAt: integer("contract_end_at"),
    tokenExpiresAt: integer("token_expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("guide_influencers_pair_idx").on(t.guideId, t.influencerId), index("guide_influencers_influencer_idx").on(t.influencerId)],
);

export const consents = sqliteTable(
  "consents",
  {
    id: text("id").primaryKey(),
    guideInfluencerId: text("guide_influencer_id").notNull().references(() => guideInfluencers.id, { onDelete: "cascade" }),
    docVersion: text("doc_version").notNull(),
    items: text("items", { mode: "json" }).$type<Record<string, boolean>>().notNull(),
    secondaryUseScope: text("secondary_use_scope", { mode: "json" }).$type<SecondaryUseScope>().notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    country: text("country").notNull(),
    ageConfirmed: integer("age_confirmed", { mode: "boolean" }).notNull(),
    ip: text("ip"),
    agreedAt: integer("agreed_at").notNull(),
    withdrawnAt: integer("withdrawn_at"),
  },
  (t) => [index("consents_gi_idx").on(t.guideInfluencerId)],
);

export const guideViews = sqliteTable(
  "guide_views",
  {
    id: text("id").primaryKey(),
    guideInfluencerId: text("guide_influencer_id").notNull().references(() => guideInfluencers.id, { onDelete: "cascade" }),
    openedAt: integer("opened_at").notNull(),
    lang: text("lang").notNull(),
    firstOpen: integer("first_open", { mode: "boolean" }).notNull(),
  },
  (t) => [index("guide_views_gi_idx").on(t.guideInfluencerId, t.openedAt)],
);

export type SubmissionStatus = "uploading" | "uploaded" | "uploaded_external" | "processing" | "ready" | "failed" | "aborted";

export const submissions = sqliteTable(
  "submissions",
  {
    id: text("id").primaryKey(),
    guideInfluencerId: text("guide_influencer_id").notNull().references(() => guideInfluencers.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    kind: text("kind").$type<"final" | "clean">().notNull(),
    fileName: text("file_name"),
    sizeBytes: integer("size_bytes"),
    originalKey: text("original_key"),
    durationS: real("duration_s"),
    sizeMb: real("size_mb"),
    width: integer("width"),
    height: integer("height"),
    status: text("status").$type<SubmissionStatus>().notNull(),
    driveUrl: text("drive_url"),
    driveAccess: text("drive_access").$type<DriveAccess>(),
    note: text("note"),
    uploadId: text("upload_id"),
    createdAt: integer("created_at").notNull(),
    uploadedAt: integer("uploaded_at"),
  },
  (t) => [index("submissions_gi_idx").on(t.guideInfluencerId, t.version), index("submissions_status_idx").on(t.status, t.createdAt)],
);

// 이어 올리기용. 완료된 part 의 etag 를 서버가 기록한다
export const uploadParts = sqliteTable(
  "upload_parts",
  {
    submissionId: text("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
    partNumber: integer("part_number").notNull(),
    etag: text("etag").notNull(),
    size: integer("size").notNull(),
  },
  (t) => [primaryKey({ columns: [t.submissionId, t.partNumber] })],
);

export const frames = sqliteTable(
  "frames",
  {
    id: text("id").primaryKey(),
    submissionId: text("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
    tMs: integer("t_ms").notNull(),
    imageKey: text("image_key").notNull(),
    source: text("source").$type<"fps" | "scene">().notNull(),
  },
  (t) => [uniqueIndex("frames_submission_t_idx").on(t.submissionId, t.tMs)],
);

export const audioTracks = sqliteTable("audio_tracks", {
  id: text("id").primaryKey(),
  submissionId: text("submission_id").notNull().unique().references(() => submissions.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  sampleRate: integer("sample_rate").notNull(),
  durationS: real("duration_s").notNull(),
});
