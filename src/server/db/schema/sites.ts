import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";
import { workspaces } from "./workspaces";
import { leads, shortLinks } from "./leads";

// 웹 SDK 수집 (docs/14 6-5). FK 와 CHECK 는 migrations/0009_sites.sql 기준

export type ConsentMode = "auto" | "require";
export type SessionMatch = "click" | "utm" | "none";
export type ConversionKind = "purchase" | "signup" | "apply" | "custom";

export const sites = sqliteTable(
  "sites",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    siteKey: text("site_key").notNull().unique(),
    name: text("name").notNull(),
    allowedDomains: text("allowed_domains", { mode: "json" }).$type<string[]>().notNull(),
    currency: text("currency").notNull().default("KRW"),
    attributionDays: integer("attribution_days").notNull().default(30),
    consentMode: text("consent_mode").$type<ConsentMode>().notNull().default("auto"),
    collectRawEmail: integer("collect_raw_email", { mode: "boolean" }).notNull().default(false),
    firstEventAt: integer("first_event_at"),
    createdAt: integer("created_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (t) => [index("sites_ws_idx").on(t.workspaceId)],
);

export const siteSessions = sqliteTable(
  "site_sessions",
  {
    siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    anonId: text("anon_id").notNull(),
    personId: text("person_id"),
    linkId: text("link_id").references(() => shortLinks.id, { onDelete: "set null" }),
    clickToken: text("click_token"),
    match: text("match").$type<SessionMatch>().notNull().default("none"),
    firstAt: integer("first_at").notNull(),
    lastAt: integer("last_at").notNull(),
    pageviews: integer("pageviews").notNull().default(0),
    maxScroll: integer("max_scroll").notNull().default(0),
    visibleMs: integer("visible_ms").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    isMember: integer("is_member", { mode: "boolean" }).notNull().default(false),
    country: text("country"),
    device: text("device"),
  },
  (t) => [
    primaryKey({ columns: [t.siteId, t.id] }),
    index("site_sessions_first_idx").on(t.siteId, t.firstAt),
    index("site_sessions_link_idx").on(t.linkId),
    index("site_sessions_anon_idx").on(t.siteId, t.anonId),
  ],
);

export const siteConversions = sqliteTable(
  "site_conversions",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    personId: text("person_id"),
    linkId: text("link_id").references(() => shortLinks.id, { onDelete: "set null" }),
    kind: text("kind").$type<ConversionKind>().notNull(),
    name: text("name"),
    value: real("value"),
    currency: text("currency").notNull(),
    orderId: text("order_id"),
    at: integer("at").notNull(),
  },
  (t) => [
    uniqueIndex("site_conversions_order_idx").on(t.siteId, t.orderId),
    index("site_conversions_session_idx").on(t.siteId, t.sessionId),
    index("site_conversions_link_idx").on(t.linkId),
  ],
);

export const sitePeople = sqliteTable(
  "site_people",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
    anonIds: text("anon_ids", { mode: "json" }).$type<string[]>().notNull(),
    externalId: text("external_id"),
    emailHash: text("email_hash"),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    firstLinkId: text("first_link_id").references(() => shortLinks.id, { onDelete: "set null" }),
    lastLinkId: text("last_link_id").references(() => shortLinks.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("site_people_hash_idx").on(t.siteId, t.emailHash), index("site_people_ext_idx").on(t.siteId, t.externalId)],
);

export const siteDailyStats = sqliteTable(
  "site_daily_stats",
  {
    siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    linkId: text("link_id").notNull().default(""),
    sessions: integer("sessions").notNull().default(0),
    pageviews: integer("pageviews").notNull().default(0),
    scroll25: integer("scroll_25").notNull().default(0),
    scroll50: integer("scroll_50").notNull().default(0),
    scroll75: integer("scroll_75").notNull().default(0),
    scroll100: integer("scroll_100").notNull().default(0),
    conversions: integer("conversions").notNull().default(0),
    conversionValue: real("conversion_value").notNull().default(0),
    membersExcluded: integer("members_excluded").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.day, t.linkId] })],
);

export const siteEventIds = sqliteTable(
  "site_event_ids",
  {
    siteId: text("site_id").notNull(),
    id: text("id").notNull(),
    at: integer("at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.id] }), index("site_event_ids_at_idx").on(t.at)],
);
