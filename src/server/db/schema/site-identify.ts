import { sqliteTable, text, integer, index, uniqueIndex, foreignKey } from "drizzle-orm/sqlite-core";
import { sites, siteSessions } from "./sites";
import { workspaces } from "./workspaces";

export const siteCollectLeases = sqliteTable("site_collect_leases", {
  siteId: text("site_id").primaryKey().references(() => sites.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [index("site_collect_leases_expiry_idx").on(table.expiresAt, table.siteId)]);

export const siteIdentifyJobs = sqliteTable("site_identify_jobs", {
  id: text("id").primaryKey(),
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull(),
  anonId: text("anon_id").notNull(),
  eventId: text("event_id").notNull(),
  receivedAt: integer("received_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  emailHash: text("email_hash"),
  payloadEnc: text("payload_enc"),
  status: text("status").$type<"pending" | "done" | "cancelled" | "expired">().notNull().default("pending"),
  claimToken: text("claim_token"),
  resolvedPersonId: text("resolved_person_id"),
  resolvedLeadId: text("resolved_lead_id"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: integer("next_attempt_at").notNull().default(0),
  lastError: text("last_error"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("site_identify_jobs_event_idx").on(table.siteId, table.eventId),
  index("site_identify_jobs_due_idx").on(table.status, table.nextAttemptAt, table.receivedAt, table.id),
  index("site_identify_jobs_expiry_idx").on(table.expiresAt, table.id),
  index("site_identify_jobs_source_idx").on(table.siteId, table.sessionId),
  index("site_identify_jobs_hash_idx").on(table.siteId, table.emailHash),
  foreignKey({ columns: [table.siteId, table.sessionId], foreignColumns: [siteSessions.siteId, siteSessions.id] }).onDelete("cascade"),
]);
