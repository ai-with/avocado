import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { Audience, AutomationTarget, Channel, DelayMinutes, MessageKind, MessageTemplate, Trigger } from "../../../shared/messaging";
import { workspaces } from "./workspaces";
import { leads } from "./leads";

// 발송 전 점검 결과 요약(켤 때 저장). 화면은 shared/messaging validateTemplate 으로 다시 계산한다
export type LastCheck = { ok: boolean; at: number; failed: string[] };
export type BroadcastStats = { eligible: number; sent: number; skipped: number; reasons: Record<string, number> };

export const automations = sqliteTable(
  "automations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    trigger: text("trigger").$type<Trigger>().notNull(),
    target: text("target", { mode: "json" }).$type<AutomationTarget>().notNull(),
    delayMinutes: integer("delay_minutes").$type<DelayMinutes>().notNull(),
    channel: text("channel").$type<Channel>().notNull(),
    kind: text("kind").$type<MessageKind>().notNull(),
    template: text("template", { mode: "json" }).$type<MessageTemplate>().notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    lastCheck: text("last_check", { mode: "json" }).$type<LastCheck | null>(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("automations_ws_trigger_idx").on(t.workspaceId, t.trigger)],
);

// 같은 규칙·리드·대상(ref_id)은 한 번만 보낸다(재열람·재제출로 중복 발송 방지)
export const automationRuns = sqliteTable(
  "automation_runs",
  {
    id: text("id").primaryKey(),
    automationId: text("automation_id").notNull().references(() => automations.id, { onDelete: "cascade" }),
    leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    refId: text("ref_id").notNull(),
    dueAt: integer("due_at").notNull(),
    status: text("status").$type<"pending" | "sent" | "skipped" | "failed">().notNull(),
    reason: text("reason"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("automation_runs_once_idx").on(t.automationId, t.leadId, t.refId), index("automation_runs_due_idx").on(t.status, t.dueAt)],
);

export const broadcasts = sqliteTable(
  "broadcasts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    channel: text("channel").$type<Channel>().notNull(),
    kind: text("kind").$type<MessageKind>().notNull(),
    audience: text("audience", { mode: "json" }).$type<Audience>().notNull(),
    template: text("template", { mode: "json" }).$type<MessageTemplate>().notNull(),
    status: text("status").$type<"draft" | "scheduled" | "sending" | "sent">().notNull().default("draft"),
    scheduledAt: integer("scheduled_at"),
    sentAt: integer("sent_at"),
    stats: text("stats", { mode: "json" }).$type<BroadcastStats | null>(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("broadcasts_ws_idx").on(t.workspaceId, t.createdAt), index("broadcasts_due_idx").on(t.status, t.scheduledAt)],
);

// 테스트 발송은 lead_id 없이 source test 로 남긴다(리드 기록에 붙지 않음)
export const messageLogs = sqliteTable(
  "message_logs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    source: text("source").$type<"automation" | "broadcast" | "test">().notNull(),
    sourceId: text("source_id").notNull(),
    channel: text("channel").$type<Channel>().notNull(),
    status: text("status").$type<"sent" | "skipped" | "failed" | "bounced">().notNull(),
    reason: text("reason"),
    // AIWITH-307: Resend 응답 ID와 발송 당시 주소·리드 생성 시각. 삭제 후 복구된 리드에 옛 반송을 적용하지 않는다.
    providerId: text("provider_id"),
    recipientEmail: text("recipient_email"),
    leadCreatedAt: integer("lead_created_at"),
    at: integer("at").notNull(),
  },
  (t) => [index("message_logs_lead_idx").on(t.leadId, t.at), index("message_logs_source_idx").on(t.sourceId, t.at), index("message_logs_provider_idx").on(t.providerId)],
);

// 1단계는 항상 not_connected. 필드는 대행사 연동 방식에 따라 바뀔 수 있다 [검증 필요]
export const alimtalkChannels = sqliteTable("alimtalk_channels", {
  workspaceId: text("workspace_id").primaryKey().references(() => workspaces.id, { onDelete: "cascade" }),
  status: text("status").$type<"not_connected" | "pending" | "connected">().notNull().default("not_connected"),
  senderProfileKeyEnc: text("sender_profile_key_enc"),
  templates: text("templates", { mode: "json" }).$type<{ code: string; name: string; status: string }[]>().notNull(),
  updatedAt: integer("updated_at").notNull(),
});
