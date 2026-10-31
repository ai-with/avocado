import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sessions, users } from "./users";
import { workspaces } from "./workspaces";

export const googleSheetsConnections = sqliteTable("google_sheets_connections", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  generation: text("generation").notNull(),
  accessEnc: text("access_enc"),
  refreshEnc: text("refresh_enc"),
  scope: text("scope").notNull().default(""),
  expiresAt: integer("expires_at"),
  connectedAt: integer("connected_at"),
  revokedAt: integer("revoked_at"),
  accountEmail: text("account_email"),
});

export const googleSheetsStates = sqliteTable("google_sheets_states", {
  stateHash: text("state_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  connectionGeneration: text("connection_generation").notNull(),
  verifierEnc: text("verifier_enc").notNull(),
  returnTo: text("return_to").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  createdAt: integer("created_at").notNull(),
}, (t) => [index("google_sheets_states_expiry_idx").on(t.expiresAt)]);

export type GoogleSheetsExportStatus = "prepared" | "creating" | "writing" | "done" | "failed" | "unknown" | "cancelled";
export const googleSheetsExports = sqliteTable("google_sheets_exports", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  requestId: text("request_id").notNull(),
  kind: text("kind").$type<"leads" | "performance">().notNull(),
  filtersHash: text("filters_hash").notNull(),
  connectionGeneration: text("connection_generation").notNull(),
  status: text("status").$type<GoogleSheetsExportStatus>().notNull(),
  payloadEnc: text("payload_enc"),
  rowCount: integer("row_count").notNull(),
  title: text("title").notNull(),
  spreadsheetId: text("spreadsheet_id"),
  errorCode: text("error_code"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [uniqueIndex("google_sheets_exports_request_idx").on(t.userId, t.requestId), index("google_sheets_exports_expiry_idx").on(t.createdAt, t.status)]);
