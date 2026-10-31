import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";
import { workspaces } from "./workspaces";
import { users, sessions } from "./users";
import { leads } from "./leads";

export const leadImportClocks = sqliteTable("lead_import_clocks", { workspaceId: text("workspace_id").primaryKey().references(() => workspaces.id, { onDelete: "cascade" }), revision: integer("revision").notNull().default(0), privacyEpoch: integer("privacy_epoch").notNull().default(0) });
export const leadImportBirths = sqliteTable("lead_import_births", { leadId: text("lead_id").primaryKey().references(() => leads.id, { onDelete: "cascade" }), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), revision: integer("revision").notNull() }, (t) => [index("lead_import_births_ws_idx").on(t.workspaceId, t.leadId)]);
export const leadImportJobs = sqliteTable("lead_import_jobs", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  fingerprint: text("fingerprint").notNull(), generation: text("generation").notNull(), status: text("status").notNull(), totalRows: integer("total_rows").notNull(), nextChunk: integer("next_chunk").notNull().default(0),
  processedRows: integer("processed_rows").notNull().default(0), importedRows: integer("imported_rows").notNull().default(0), invalidRows: integer("invalid_rows").notNull().default(0), skippedRows: integer("skipped_rows").notNull().default(0),
  birthRevision: integer("birth_revision").notNull(), privacyEpoch: integer("privacy_epoch").notNull(), requestedAt: integer("requested_at").notNull(), createdAt: integer("created_at").notNull(), expiresAt: integer("expires_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (t) => [index("lead_import_jobs_expiry_idx").on(t.expiresAt, t.id), index("lead_import_jobs_ws_idx").on(t.workspaceId, t.id), index("lead_import_jobs_user_idx").on(t.userId, t.id), index("lead_import_jobs_session_idx").on(t.sessionId, t.id)]);
export const leadImportChunks = sqliteTable("lead_import_chunks", { jobId: text("job_id").notNull().references(() => leadImportJobs.id, { onDelete: "cascade" }), chunkNo: integer("chunk_no").notNull(), digest: text("digest").notNull(), claimToken: text("claim_token"), status: text("status").notNull(), invalidJson: text("invalid_json").notNull(), skippedJson: text("skipped_json").notNull(), resultJson: text("result_json") }, (t) => [primaryKey({ columns: [t.jobId, t.chunkNo] })]);
export const leadImportOwned = sqliteTable("lead_import_owned", { jobId: text("job_id").notNull().references(() => leadImportJobs.id, { onDelete: "cascade" }), leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }) }, (t) => [primaryKey({ columns: [t.jobId, t.leadId] }), index("lead_import_owned_lead_idx").on(t.leadId, t.jobId)]);
