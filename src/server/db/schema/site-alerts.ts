import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";
import { sites } from "./sites";
import { users } from "./users";
import { workspaces } from "./workspaces";

export const siteAlertSettings = sqliteTable("site_alert_settings", {
  siteId: text("site_id").primaryKey().references(() => sites.id, { onDelete: "cascade" }), generation: text("generation").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false), metric: text("metric").$type<"pageviews" | "conversions">().notNull(),
  ratioPercent: integer("ratio_percent").notNull(), minimumAverage: integer("minimum_average").notNull(), confirmationDays: integer("confirmation_days").notNull(),
  nextCheckAt: integer("next_check_at").notNull(), lastCheckedDay: text("last_checked_day"), leaseToken: text("lease_token"), leaseUntil: integer("lease_until"),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (t) => [index("site_alert_settings_due_idx").on(t.enabled, t.nextCheckAt, t.siteId)]);
export const siteAlertRecipients = sqliteTable("site_alert_recipients", {
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  generation: text("generation").notNull(), active: integer("active", { mode: "boolean" }).notNull().default(false), emailHmac: text("email_hmac"),
  lastAttemptAt: integer("last_attempt_at"), lastDeliveryId: text("last_delivery_id"), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (t) => [primaryKey({ columns: [t.siteId, t.userId] }), index("site_alert_recipients_active_idx").on(t.active, t.updatedAt, t.siteId, t.userId)]);
export const siteAlertRuns = sqliteTable("site_alert_runs", {
  id: text("id").primaryKey(), siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  generation: text("generation").notNull(), targetDay: text("target_day").notNull(), policyJson: text("policy_json").notNull(), evaluationJson: text("evaluation_json").notNull(), checkedAt: integer("checked_at").notNull(),
}, (t) => [uniqueIndex("site_alert_runs_site_generation_target_day_unique").on(t.siteId, t.generation, t.targetDay), index("site_alert_runs_time_idx").on(t.checkedAt, t.id)]);
export const siteAlertMailOutbox = sqliteTable("site_alert_mail_outbox", {
  id: text("id").primaryKey(), runId: text("run_id").notNull(), siteId: text("site_id").notNull(), workspaceId: text("workspace_id").notNull(), userId: text("user_id").notNull(),
  configGeneration: text("config_generation").notNull(), subscriptionGeneration: text("subscription_generation").notNull(), status: text("status").notNull(), payloadEnc: text("payload_enc"),
  firstAttemptAt: integer("first_attempt_at"), lastAttemptAt: integer("last_attempt_at"), leaseToken: text("lease_token"), nextAttemptAt: integer("next_attempt_at").notNull(), lastEnqueuedAt: integer("last_enqueued_at"),
  attempts: integer("attempts").notNull().default(0), providerId: text("provider_id"), errorCode: text("error_code"), expiresAt: integer("expires_at").notNull(), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (t) => [uniqueIndex("site_alert_mail_outbox_run_user_subscription_unique").on(t.runId, t.userId, t.subscriptionGeneration), index("site_alert_mail_due_idx").on(t.status, t.nextAttemptAt, t.updatedAt, t.id), index("site_alert_mail_retention_idx").on(t.createdAt, t.id)]);
