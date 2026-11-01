import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sites } from "./sites";

export const siteCollectIntakes = sqliteTable("site_collect_intakes", {
  id: text("id").primaryKey(), siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull(), receivedAt: integer("received_at").notNull(), expiresAt: integer("expires_at").notNull(),
  payloadEnc: text("payload_enc").notNull(), nextAttemptAt: integer("next_attempt_at").notNull().default(0),
}, (t) => [index("site_collect_intakes_due_idx").on(t.nextAttemptAt, t.id), index("site_collect_intakes_expiry_idx").on(t.expiresAt, t.id), index("site_collect_intakes_site_idx").on(t.siteId, t.id)]);

export const siteRawBatches = sqliteTable("site_raw_batches", {
  id: text("id").primaryKey(), siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull(), receivedAt: integer("received_at").notNull(), expiresAt: integer("expires_at").notNull(), payloadEnc: text("payload_enc"),
  status: text("status").$type<"pending" | "ready">().notNull().default("pending"), writeToken: text("write_token"), leaseUntil: integer("lease_until").notNull().default(0),
  objectKey: text("object_key"), nextAttemptAt: integer("next_attempt_at").notNull().default(0),
}, (t) => [index("site_raw_batches_due_idx").on(t.status, t.nextAttemptAt, t.id), index("site_raw_batches_expiry_idx").on(t.expiresAt, t.id), index("site_raw_batches_site_idx").on(t.siteId, t.id)]);

// No FK: uncertain R2 writes remain discoverable after their parent disappears.
export const siteRawObjects = sqliteTable("site_raw_objects", {
  id: text("id").primaryKey(), batchId: text("batch_id").notNull(), siteId: text("site_id").notNull(), key: text("key").notNull().unique(),
  state: text("state").$type<"writing" | "ready" | "retired">().notNull(), createdAt: integer("created_at").notNull(), leaseUntil: integer("lease_until").notNull(),
  checkedAt: integer("checked_at").notNull().default(0), deletedAt: integer("deleted_at"),
}, (t) => [index("site_raw_objects_batch_idx").on(t.batchId, t.id), index("site_raw_objects_site_idx").on(t.siteId, t.deletedAt, t.id), index("site_raw_objects_cleanup_idx").on(t.state, t.checkedAt, t.id)]);
