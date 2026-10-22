import { and, eq, inArray, lte } from "drizzle-orm";
import { getDb, type Db } from "../db";
import { alimtalkChannels, automationRuns, automations, broadcasts, guides, influencers, leadGroups, leads, messageLogs, workspaces, type BroadcastStats } from "../db/schema";
import { newId, now } from "./ids";
import { logEvent } from "./events";
import { sendEmail } from "./email";
import { send as sendAlimtalk } from "./alimtalk";
import { evaluateGroup } from "./lead-groups";
import { loadLeads } from "./leads";
import { canSend, isEmailTemplate, nightRetryAt, renderEmail, type Audience, type Channel, type MessageKind, type MessageTemplate, type SkipReason, type Trigger, type Vars } from "../../shared/messaging";

type Lead = typeof leads.$inferSelect;
type LogStatus = "sent" | "skipped" | "failed";

// 트리거 훅. 폼 제출, 게이트 통과, 완독 지점(public-lead.ts)에서 한 줄로 부른다.
// 켜진 규칙마다 automation_runs 에 pending 을 만든다. 실제 발송은 cron(processMessaging)
export async function enqueueAutomations(db: Db, e: { workspaceId: string; trigger: Trigger; leadId: string; ref: { id: string; guideId: string | null } }) {
  const rules = await db.select().from(automations).where(and(eq(automations.workspaceId, e.workspaceId), eq(automations.trigger, e.trigger), eq(automations.enabled, true)));
  const hit = rules.filter((r) => r.target.formId === e.ref.id || r.target.documentId === e.ref.id || (!!r.target.guideId && r.target.guideId === e.ref.guideId));
  for (const r of hit) {
    await db
      .insert(automationRuns)
      .values({ id: newId(), automationId: r.id, leadId: e.leadId, refId: e.ref.id, dueAt: now() + r.delayMinutes * 60_000, status: "pending", createdAt: now() })
      .onConflictDoNothing();
  }
}

export async function senderInfo(db: Db, workspaceId: string) {
  const w = await db.select({ name: workspaces.name, senderName: workspaces.senderName, senderContact: workspaces.senderContact }).from(workspaces).where(eq(workspaces.id, workspaceId)).get();
  return { senderName: w?.senderName || w?.name || "", senderContact: w?.senderContact || "" };
}

export async function alimtalkConnected(db: Db, workspaceId: string) {
  const ch = await db.select({ status: alimtalkChannels.status }).from(alimtalkChannels).where(eq(alimtalkChannels.workspaceId, workspaceId)).get();
  return ch?.status === "connected";
}

// 변수: 이름, 가이드명, 인플루언서명. 가이드·인플루언서는 리드의 마지막 출처 기준
async function leadVars(db: Db, lead: Lead): Promise<Vars> {
  const s = lead.lastSource;
  const g = s.guideId ? await db.select({ name: guides.name }).from(guides).where(eq(guides.id, s.guideId)).get() : undefined;
  const i = s.influencerId ? await db.select({ name: influencers.displayName }).from(influencers).where(eq(influencers.id, s.influencerId)).get() : undefined;
  return { 이름: lead.name, 가이드명: g?.name, 인플루언서명: i?.name };
}

type Delivery = { env: Env; db: Db; workspaceId: string; channel: Channel; kind: MessageKind; template: MessageTemplate };

// 실제 전송 1건. 판정은 호출자가 끝낸 뒤 부른다. 결과를 message_logs 에 남긴다
async function deliver(d: Delivery, lead: Lead, source: { type: "automation" | "broadcast"; id: string }): Promise<{ status: LogStatus; reason: SkipReason | null }> {
  let result: { status: LogStatus; reason: SkipReason | null };
  if (d.channel === "alimtalk" || !isEmailTemplate(d.template)) {
    const t = d.template;
    const r = await sendAlimtalk(d.env, { to: lead.phone ?? "", templateCode: isEmailTemplate(t) ? "" : t.templateCode, variables: isEmailTemplate(t) ? {} : t.variables });
    result = r.delivered ? { status: "sent", reason: null } : { status: "skipped", reason: "alimtalk_not_connected" };
  } else {
    const msg = renderEmail(d.template, await leadVars(d.db, lead), { kind: d.kind, ...(await senderInfo(d.db, d.workspaceId)), unsubscribeUrl: `${d.env.APP_URL}/unsubscribe/${lead.unsubscribeToken}` });
    const r = await sendEmail(d.env, { to: lead.email, ...msg });
    result = r.delivered ? { status: "sent", reason: null } : r.reason === "no_provider" ? { status: "skipped", reason: "no_provider" } : { status: "failed", reason: "provider_error" };
  }
  await logMessage(d.db, { workspaceId: d.workspaceId, leadId: lead.id, source: source.type, sourceId: source.id, channel: d.channel, ...result });
  return result;
}

export async function logMessage(db: Db, l: { workspaceId: string; leadId: string | null; source: "automation" | "broadcast" | "test"; sourceId: string; channel: Channel; status: LogStatus; reason: SkipReason | null }) {
  await db.insert(messageLogs).values({ id: newId(), ...l, at: now() });
}

// 받는 사람 집계: 그룹·태그 합집합 → 발송 가능 / 전체 / 불가(사유별). 야간 보류는 불가로 세지 않는다
export async function countAudience(db: Db, workspaceId: string, audience: Audience, channel: Channel, kind: MessageKind) {
  const connected = await alimtalkConnected(db, workspaceId);
  const groups = audience.groupIds.length ? await db.select().from(leadGroups).where(and(eq(leadGroups.workspaceId, workspaceId), inArray(leadGroups.id, audience.groupIds))) : [];
  const all = groups.length || audience.tagIds.length ? await loadLeads(db, workspaceId) : [];
  const members = all.filter(({ facts }) => groups.some((g) => evaluateGroup(g.rules, facts)) || facts.tagIds.some((t) => audience.tagIds.includes(t)));
  const eligible: Lead[] = [];
  const reasons: Partial<Record<SkipReason, number>> = {};
  for (const { lead } of members) {
    const r = canSend(lead, channel, kind, now(), connected);
    if (r.ok || r.reason === "night") eligible.push(lead);
    else reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  }
  return { total: members.length, eligible, reasons };
}

// ponytail: 한 번에 50건. cron 15분 x 50 = 시간당 200건 상한. 넘치면 Queue 로 나눈다
const RUN_BATCH = 50;

async function processRuns(env: Env, db: Db) {
  const due = await db.select().from(automationRuns).where(and(eq(automationRuns.status, "pending"), lte(automationRuns.dueAt, now()))).limit(RUN_BATCH);
  for (const run of due) {
    const rule = await db.select().from(automations).where(eq(automations.id, run.automationId)).get();
    const lead = await db.select().from(leads).where(eq(leads.id, run.leadId)).get();
    const finish = (status: LogStatus, reason: SkipReason | null) => db.update(automationRuns).set({ status, reason }).where(eq(automationRuns.id, run.id));
    if (!rule) continue;
    if (!rule.enabled || !lead || lead.deletedAt) {
      await finish("skipped", !lead || lead.deletedAt ? "lead_deleted" : "rule_off");
      continue;
    }
    const check = canSend(lead, rule.channel, rule.kind, now(), await alimtalkConnected(db, rule.workspaceId));
    if (!check.ok && check.reason === "night") {
      await db.update(automationRuns).set({ dueAt: check.retryAt }).where(eq(automationRuns.id, run.id));
      continue;
    }
    const props = { channel: rule.channel, trigger: rule.trigger };
    if (!check.ok) {
      await logMessage(db, { workspaceId: rule.workspaceId, leadId: lead.id, source: "automation", sourceId: rule.id, channel: rule.channel, status: "skipped", reason: check.reason });
      await finish("skipped", check.reason);
      await logEvent(db, rule.workspaceId, "automation_message_skipped", { ...props, reason: check.reason });
      continue;
    }
    const r = await deliver({ env, db, workspaceId: rule.workspaceId, channel: rule.channel, kind: rule.kind, template: rule.template }, lead, { type: "automation", id: rule.id });
    await finish(r.status, r.reason);
    await logEvent(db, rule.workspaceId, r.status === "sent" ? "automation_message_sent" : "automation_message_skipped", r.reason ? { ...props, reason: r.reason } : props);
  }
}

// 예약 시각이 된 1회성 발송. 보내기 직전에 동의 상태를 다시 판정한다(F-67)
export async function runBroadcast(env: Env, db: Db, id: string) {
  // 동시에 두 번 돌지 않게 scheduled → sending 을 먼저 선점한다
  const claimed = await db.update(broadcasts).set({ status: "sending" }).where(and(eq(broadcasts.id, id), eq(broadcasts.status, "scheduled"))).returning({ id: broadcasts.id });
  if (!claimed.length) return;
  const b = (await db.select().from(broadcasts).where(eq(broadcasts.id, id)).get())!;
  // 광고성인데 야간이면 통째로 다음 08:00 로 미룬다
  const retryAt = b.kind === "ad" ? nightRetryAt(now()) : null;
  if (retryAt) {
    await db.update(broadcasts).set({ status: "scheduled", scheduledAt: retryAt }).where(eq(broadcasts.id, id));
    return;
  }
  const { eligible, reasons } = await countAudience(db, b.workspaceId, b.audience, b.channel, b.kind);
  const stats: BroadcastStats = { eligible: eligible.length, sent: 0, skipped: Object.values(reasons).reduce((a, n) => a + n, 0), reasons: { ...reasons } };
  const d: Delivery = { env, db, workspaceId: b.workspaceId, channel: b.channel, kind: b.kind, template: b.template };
  // ponytail: 한 실행에서 순서대로 보낸다. 수천 명이면 Queue 로 쪼갠다(D1 호출당 쿼리 한도)
  for (const lead of eligible) {
    const r = await deliver(d, lead, { type: "broadcast", id: b.id });
    if (r.status === "sent") stats.sent++;
    else (stats.skipped++, (stats.reasons[r.reason ?? "provider_error"] = (stats.reasons[r.reason ?? "provider_error"] ?? 0) + 1));
  }
  await db.update(broadcasts).set({ status: "sent", sentAt: now(), stats }).where(eq(broadcasts.id, id));
  await logEvent(db, b.workspaceId, "broadcast_sent", { channel: b.channel, kind: b.kind, recipients: stats.sent });
  for (const [reason, count] of Object.entries(stats.reasons)) await logEvent(db, b.workspaceId, "broadcast_skipped", { reason, count });
}

// cron(*/15) 작업. jobs.ts 에 등록
export async function processMessaging(env: Env) {
  const db = getDb(env.DB);
  await processRuns(env, db);
  const due = await db.select({ id: broadcasts.id }).from(broadcasts).where(and(eq(broadcasts.status, "scheduled"), lte(broadcasts.scheduledAt, now())));
  for (const b of due) await runBroadcast(env, db, b.id);
}
