import { desc, sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";
import type { AfterSubmit, DestinationType, DocJson, DocumentSourceType, FormFields, GroupRules, LeadSourceType, OgCard, Utm } from "../../../shared/leads";
import { workspaces } from "./workspaces";
import type { StoredGate } from "../../../shared/doc-gate";

// guide_id, influencer_id 는 TASK-018 의 guides, influencers 를 가리킨다. FK 는 migrations/0003_leads.sql 에만 둔다
export type SourceSnapshot = { type: LeadSourceType; guideId: string | null; influencerId: string | null; channelKey: string | null; linkId: string | null; at: number };

export const linkChannels = sqliteTable(
  "link_channels",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    sort: integer("sort").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("link_channels_ws_key_idx").on(t.workspaceId, t.key)],
);

export const shortLinks = sqliteTable(
  "short_links",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    guideId: text("guide_id"),
    influencerId: text("influencer_id"),
    channelKey: text("channel_key").notNull(),
    slug: text("slug").notNull().unique(),
    destinationType: text("destination_type").$type<DestinationType>().notNull(),
    destinationId: text("destination_id"),
    destinationUrl: text("destination_url"),
    utm: text("utm", { mode: "json" }).$type<Utm>().notNull(),
    og: text("og", { mode: "json" }).$type<OgCard>().notNull(),
    // NULL 이면 칸의 기본 링크. 콘텐츠 링크는 c2, c3 ... 와 브랜드가 붙인 이름 (migrations/0012)
    contentKey: text("content_key"),
    contentLabel: text("content_label"),
    createdAt: integer("created_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    index("short_links_guide_idx").on(t.guideId),
    index("short_links_ws_idx").on(t.workspaceId),
    uniqueIndex("short_links_base_cell_idx").on(t.guideId, t.influencerId, t.channelKey).where(sql`${t.contentKey} IS NULL AND ${t.deletedAt} IS NULL`),
    uniqueIndex("short_links_content_cell_idx").on(t.guideId, t.influencerId, t.channelKey, t.contentKey).where(sql`${t.contentKey} IS NOT NULL AND ${t.deletedAt} IS NULL`),
  ],
);

export const linkClicks = sqliteTable(
  "link_clicks",
  {
    id: text("id").primaryKey(),
    linkId: text("link_id").notNull().references(() => shortLinks.id, { onDelete: "cascade" }),
    at: integer("at").notNull(),
    referrer: text("referrer"),
    device: text("device").$type<"mobile" | "desktop" | "other">().notNull(),
    country: text("country"),
    ipHash: text("ip_hash"),
    isBot: integer("is_bot", { mode: "boolean" }).notNull(),
    isMember: integer("is_member", { mode: "boolean" }).notNull(),
    sessionId: text("session_id"),
    // 사이트 SDK 로 넘기는 클릭 ID(avc). 봇 클릭은 null
    clickToken: text("click_token").unique("link_clicks_click_token_idx"),
    // 클릭 당시 목적지. 자료 연결 폼은 연결 자료를 기록한다. null은 추정하지 않은 과거 클릭.
    destinationType: text("destination_type").$type<DestinationType>(),
    destinationId: text("destination_id"),
  },
  (t) => [index("link_clicks_link_idx").on(t.linkId, t.at), index("link_clicks_destination_idx").on(t.destinationType, t.destinationId, t.at), index("link_clicks_ip_purge_idx").on(t.at, t.id).where(sql`${t.ipHash} IS NOT NULL`)],
);

export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    guideId: text("guide_id"),
    title: text("title").notNull(),
    fileKey: text("file_key").notNull(),
    pages: integer("pages").notNull(),
    sizeMb: real("size_mb").notNull(),
    allowDownload: integer("allow_download", { mode: "boolean" }).notNull().default(false),
    // 예전 형식(before, after_page)이 남아 있을 수 있어 읽을 때 normalizeGate()를 거친다
    gate: text("gate", { mode: "json" }).$type<StoredGate>().notNull(),
    // editor·url 자료는 file_key 가 빈 문자열, pages 가 1 이다
    sourceType: text("source_type").$type<DocumentSourceType>().notNull().default("pdf"),
    contentJson: text("content_json", { mode: "json" }).$type<DocJson>(),
    contentHtml: text("content_html"),
    sourceUrl: text("source_url"),
    // null 이면 주소를 불러오지 못한 상태(새 창 열기만 제공)
    fetchedHtmlKey: text("fetched_html_key"),
    fetchedAt: integer("fetched_at"),
    createdAt: integer("created_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (t) => [index("documents_ws_idx").on(t.workspaceId)],
);

// id 는 추측 불가능한 열람 토큰을 겸한다. session_id 는 방문자 쿠키(재열람 계산용)
export const documentViews = sqliteTable(
  "document_views",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    linkId: text("link_id").references(() => shortLinks.id, { onDelete: "set null" }),
    // 같은 링크·워크스페이스의 유효한 자료 클릭만 연결한다. 직접 방문·과거 행은 null.
    clickToken: text("click_token"),
    sessionId: text("session_id"),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    startedAt: integer("started_at").notNull(),
    // 폼 제출 직후 예약한 행은 null. 실제 자료 메타 GET에서 처음 설정한다.
    // -1: 과거 정의/구 Worker 기록, NULL: 신규 폼 대기, 양수: 실제 첫 열림
    openedAt: integer("opened_at").default(-1),
    lastSeenAt: integer("last_seen_at").notNull(),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    maxPage: integer("max_page").notNull().default(0),
    maxScrollPct: integer("max_scroll_pct").notNull().default(0),
    isMember: integer("is_member", { mode: "boolean" }).notNull(),
  },
  (t) => [index("document_views_doc_idx").on(t.documentId), index("document_views_link_idx").on(t.linkId), index("document_views_lead_idx").on(t.leadId), index("document_views_click_idx").on(t.clickToken), index("document_views_opened_idx").on(t.documentId, t.openedAt)],
);

export const documentPageViews = sqliteTable(
  "document_page_views",
  {
    viewId: text("view_id").notNull().references(() => documentViews.id, { onDelete: "cascade" }),
    page: integer("page").notNull(),
    dwellMs: integer("dwell_ms").notNull(),
  },
  (t) => [primaryKey({ columns: [t.viewId, t.page] })],
);

// 게이트 이메일 인증(requireVerify) 1회용 토큰. 원문은 메일 링크에만 있고 여기에는 해시만 둔다
export const docVerifyTokens = sqliteTable(
  "doc_verify_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    viewId: text("view_id").notNull().references(() => documentViews.id, { onDelete: "cascade" }),
    leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("doc_verify_tokens_view_idx").on(t.viewId, t.createdAt)],
);

export const leads = sqliteTable(
  "leads",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    company: text("company"),
    phone: text("phone"),
    answers: text("answers", { mode: "json" }).$type<Record<string, string | string[]>>().notNull(),
    marketingOptIn: integer("marketing_opt_in", { mode: "boolean" }).notNull().default(false),
    alimtalkOptIn: integer("alimtalk_opt_in", { mode: "boolean" }).notNull().default(false),
    unsubscribedAt: integer("unsubscribed_at"),
    bouncedAt: integer("bounced_at"),
    unsubscribeToken: text("unsubscribe_token").notNull().unique(),
    firstSource: text("first_source", { mode: "json" }).$type<SourceSnapshot>().notNull(),
    lastSource: text("last_source", { mode: "json" }).$type<SourceSnapshot>().notNull(),
    createdAt: integer("created_at").notNull(),
    deletedAt: integer("deleted_at"),
    // 소문자·공백 제거 이메일의 SHA-256 hex. 사이트 identify 해시 매칭용
    emailHash: text("email_hash"),
    searchEmailV1: text("search_email_v1"),
    searchNameV1: text("search_name_v1"),
    searchCompanyV1: text("search_company_v1"),
    searchPhoneV1: text("search_phone_v1"),
  },
  (t) => [uniqueIndex("leads_ws_email_idx").on(t.workspaceId, t.email), index("leads_ws_email_hash_idx").on(t.workspaceId, t.emailHash), index("leads_purge_idx").on(t.deletedAt, t.id).where(sql`${t.deletedAt} IS NOT NULL`),
    index("leads_live_seek_idx").on(t.workspaceId, desc(t.createdAt), desc(t.id)).where(sql`${t.deletedAt} IS NULL`),
    index("leads_search_pending_idx").on(t.id).where(sql`${t.deletedAt} IS NULL AND (${t.searchEmailV1} IS NULL OR ${t.searchNameV1} IS NULL OR ${t.searchCompanyV1} IS NULL OR ${t.searchPhoneV1} IS NULL)`)],
);

export const leadSources = sqliteTable(
  "lead_sources",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    type: text("type").$type<LeadSourceType>().notNull(),
    guideId: text("guide_id"),
    influencerId: text("influencer_id"),
    channelKey: text("channel_key"),
    linkId: text("link_id").references(() => shortLinks.id, { onDelete: "set null" }),
    at: integer("at").notNull(),
  },
  (t) => [index("lead_sources_lead_idx").on(t.leadId), index("lead_sources_link_idx").on(t.linkId), index("lead_sources_guide_idx").on(t.guideId),
    index("lead_sources_type_match_idx").on(t.leadId, t.type), index("lead_sources_guide_match_idx").on(t.leadId, t.guideId),
    index("lead_sources_influencer_match_idx").on(t.leadId, t.influencerId), index("lead_sources_channel_match_idx").on(t.leadId, t.channelKey), index("lead_sources_link_match_idx").on(t.leadId, t.linkId)],
);

export const leadTags = sqliteTable(
  "lead_tags",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("lead_tags_ws_name_idx").on(t.workspaceId, t.name)],
);

export const leadTagLinks = sqliteTable(
  "lead_tag_links",
  {
    leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    tagId: text("tag_id").notNull().references(() => leadTags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.leadId, t.tagId] }), index("lead_tag_links_tag_match_idx").on(t.tagId, t.leadId)],
);

export const leadGroups = sqliteTable("lead_groups", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  rules: text("rules", { mode: "json" }).$type<GroupRules>().notNull(),
  createdAt: integer("created_at").notNull(),
});

export const forms = sqliteTable(
  "forms",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    guideId: text("guide_id"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    headerImageKey: text("header_image_key"),
    fields: text("fields", { mode: "json" }).$type<FormFields>().notNull(),
    closesAt: integer("closes_at"),
    maxSubmissions: integer("max_submissions"),
    closedMessage: text("closed_message").notNull().default(""),
    afterSubmit: text("after_submit", { mode: "json" }).$type<AfterSubmit>().notNull(),
    createdAt: integer("created_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (t) => [index("forms_ws_idx").on(t.workspaceId)],
);

export const formSubmissions = sqliteTable(
  "form_submissions",
  {
    id: text("id").primaryKey(),
    formId: text("form_id").notNull().references(() => forms.id, { onDelete: "cascade" }),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    linkId: text("link_id").references(() => shortLinks.id, { onDelete: "set null" }),
    answers: text("answers", { mode: "json" }).$type<Record<string, string | string[]>>().notNull(),
    at: integer("at").notNull(),
  },
  (t) => [index("form_submissions_form_idx").on(t.formId), index("form_submissions_lead_idx").on(t.leadId)],
);
