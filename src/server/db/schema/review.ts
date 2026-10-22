import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { frames, guideInfluencers, guides, influencers, submissions } from "./guides";
import { users } from "./users";
import type {
  CandidateConfidence,
  CandidateDecision,
  CandidateResult,
  ContentFormat,
  DecisionReason,
  FeedbackShape,
  FeedbackSource,
  JobStage,
  JobStatus,
} from "../../../shared/review";

// F-60 처리 단계마다 1행. 재실행하면 같은 행을 갱신한다
export const processingJobs = sqliteTable(
  "processing_jobs",
  {
    id: text("id").primaryKey(),
    submissionId: text("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
    stage: text("stage").$type<JobStage>().notNull(),
    status: text("status").$type<JobStatus>().notNull(),
    attempts: integer("attempts").notNull().default(0),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
    error: text("error"),
  },
  (t) => [uniqueIndex("processing_jobs_stage_idx").on(t.submissionId, t.stage)],
);

export const transcriptSegments = sqliteTable(
  "transcript_segments",
  {
    id: text("id").primaryKey(),
    submissionId: text("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    lang: text("lang").notNull(),
    text: text("text").notNull(),
    translatedText: text("translated_text"),
    translatedLang: text("translated_lang"),
  },
  (t) => [index("transcript_segments_sub_idx").on(t.submissionId, t.startMs)],
);

// F-61. 결과는 후보일 뿐이고 판정(decision)은 사람이 한다
export const violationCandidates = sqliteTable(
  "violation_candidates",
  {
    id: text("id").primaryKey(),
    submissionId: text("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
    ruleId: text("rule_id").notNull(),
    ruleType: text("rule_type").notNull(),
    ruleContent: text("rule_content").notNull(),
    ruleVersion: integer("rule_version"),
    result: text("result").$type<CandidateResult>().notNull(),
    confidence: text("confidence").$type<CandidateConfidence>().notNull(),
    frameIds: text("frame_ids", { mode: "json" }).$type<string[]>().notNull(),
    segmentIds: text("segment_ids", { mode: "json" }).$type<string[]>().notNull(),
    reason: text("reason").notNull(),
    modelVersion: text("model_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    decision: text("decision").$type<CandidateDecision>(),
    decisionReason: text("decision_reason").$type<DecisionReason>(),
    decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: integer("decided_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("violation_candidates_sub_idx").on(t.submissionId)],
);

// 라운드 1회 = '피드백 보내기' 1회. n 은 가이드 인플루언서 단위로 1부터
export const reviewRounds = sqliteTable(
  "review_rounds",
  {
    id: text("id").primaryKey(),
    submissionId: text("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
    guideInfluencerId: text("guide_influencer_id").notNull().references(() => guideInfluencers.id, { onDelete: "cascade" }),
    n: integer("n").notNull(),
    submittedAt: integer("submitted_at").notNull(),
    submittedBy: text("submitted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("review_rounds_gi_idx").on(t.guideInfluencerId, t.n), index("review_rounds_sub_idx").on(t.submissionId)],
);

// round_id 가 비어 있으면 아직 보내지 않은 초안
export const feedbackItems = sqliteTable(
  "feedback_items",
  {
    id: text("id").primaryKey(),
    submissionId: text("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
    roundId: text("round_id").references(() => reviewRounds.id, { onDelete: "cascade" }),
    n: integer("n"),
    frameId: text("frame_id").references(() => frames.id, { onDelete: "set null" }),
    tMs: integer("t_ms").notNull(),
    shape: text("shape", { mode: "json" }).$type<FeedbackShape | null>(),
    text: text("text").notNull(),
    textTranslated: text("text_translated"),
    source: text("source").$type<FeedbackSource>().notNull(),
    candidateId: text("candidate_id").references(() => violationCandidates.id, { onDelete: "set null" }),
    ruleId: text("rule_id"),
    authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
    influencerDone: integer("influencer_done", { mode: "boolean" }).notNull().default(false),
    reply: text("reply"),
    replyTranslated: text("reply_translated"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("feedback_items_sub_idx").on(t.submissionId), index("feedback_items_round_idx").on(t.roundId)],
);

export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  guideInfluencerId: text("guide_influencer_id").notNull().unique().references(() => guideInfluencers.id, { onDelete: "cascade" }),
  submissionId: text("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
  approvedBy: text("approved_by").references(() => users.id, { onDelete: "set null" }),
  approvedAt: integer("approved_at").notNull(),
});

// F-48 게시물 URL 받기. 가이드 인플루언서당 1건, 먼저 들어온 값을 쓰고 다르면 conflict_url 에 남긴다
export const contents = sqliteTable(
  "contents",
  {
    id: text("id").primaryKey(),
    guideId: text("guide_id").notNull().references(() => guides.id, { onDelete: "cascade" }),
    influencerId: text("influencer_id").notNull().references(() => influencers.id, { onDelete: "cascade" }),
    guideInfluencerId: text("guide_influencer_id").notNull().unique().references(() => guideInfluencers.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    igMediaId: text("ig_media_id"),
    format: text("format").$type<ContentFormat>().notNull(),
    postedAt: integer("posted_at"),
    postedAtSource: text("posted_at_source").$type<"api" | "manual">(),
    urlSubmittedBy: text("url_submitted_by").$type<"influencer" | "brand">().notNull(),
    registeredAt: integer("registered_at").notNull(),
    conflictUrl: text("conflict_url"),
    deletedAt: integer("deleted_at"),
  },
  (t) => [index("contents_guide_idx").on(t.guideId)],
);

export type ProcessingJob = typeof processingJobs.$inferSelect;
export type Content = typeof contents.$inferSelect;
