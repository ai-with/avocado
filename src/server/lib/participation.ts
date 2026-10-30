import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db";
import { campaigns, contactLogs, guideInfluencers, guides } from "../db/schema";
import { newId, now } from "./ids";
import {
  logTextForEvent,
  nextAutoStatus,
  participationRounds,
  statusChangeText,
  statusForEvent,
  type ContactChannel,
  type ContactLogKind,
  type ParticipationStatus,
} from "../../shared/participation";

// 인플루언서별 진행 상태·소통 이력 (TASK-072). 자동 전이와 이력 기록은 logEvent 한곳에서 부른다

type LogEntry = { kind: ContactLogKind; body: string; channel?: ContactChannel | null; lang?: string | null; meta?: Record<string, unknown> | null; createdBy?: string | null };

export async function addContactLog(db: Db, workspaceId: string, giId: string, e: LogEntry) {
  const row = { id: newId(), workspaceId, guideInfluencerId: giId, kind: e.kind, body: e.body, channel: e.channel ?? null, lang: e.lang ?? null, meta: e.meta ?? null, createdBy: e.createdBy ?? null, createdAt: now() };
  await db.insert(contactLogs).values(row);
  return row;
}

// 상태를 바꾸고 이력 한 줄. 바뀌지 않으면 아무것도 하지 않는다
export async function changeStatus(db: Db, workspaceId: string, giId: string, from: ParticipationStatus, to: ParticipationStatus, by: string | null) {
  if (from === to) return;
  await db.update(guideInfluencers).set({ status: to }).where(eq(guideInfluencers.id, giId));
  await addContactLog(db, workspaceId, giId, { kind: "status", body: statusChangeText(from, to, by === null), meta: { from, to }, createdBy: by });
}

const EMAIL_EVENTS = new Set(["guide_email_sent"]);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

// 사건 하나 → 소통 이력(system) + 앞으로만 자동 전이. gi 가 이 워크스페이스 것일 때만
async function applyEvent(db: Db, workspaceId: string, name: string, giId: string) {
  const gi = await db
    .select({ status: guideInfluencers.status })
    .from(guideInfluencers)
    .innerJoin(guides, eq(guides.id, guideInfluencers.guideId))
    .where(and(eq(guideInfluencers.id, giId), eq(guides.workspaceId, workspaceId)))
    .get();
  if (!gi) return;
  const text = logTextForEvent(name);
  if (text) await addContactLog(db, workspaceId, giId, { kind: "system", body: text, channel: EMAIL_EVENTS.has(name) ? "email" : null, meta: { event: name } });
  const target = statusForEvent(name);
  const next = target && nextAutoStatus(gi.status, target);
  if (next) await changeStatus(db, workspaceId, giId, gi.status, next, null);
}

// 이력·상태 실패가 원래 동작(동의, 업로드, 승인)을 막으면 안 되므로 오류는 기록만 한다
export async function participationFromEvent(db: Db, workspaceId: string, name: string, props: Record<string, unknown>) {
  const giId = str(props.gi_id);
  if (!giId || (!logTextForEvent(name) && !statusForEvent(name))) return;
  try {
    await applyEvent(db, workspaceId, name, giId);
  } catch (e) {
    console.error("[participation:event]", e);
  }
}

export const contactLogsOf = (db: Db, giId: string) =>
  db.select().from(contactLogs).where(eq(contactLogs.guideInfluencerId, giId)).orderBy(asc(contactLogs.createdAt), sql`rowid`);

// 인플루언서들의 브랜드별 참여 회차. 키는 guide_influencers.id
export async function roundsFor(db: Db, workspaceId: string, influencerIds: string[]): Promise<Map<string, number>> {
  if (influencerIds.length === 0) return new Map();
  const rows = await db
    .select({ id: guideInfluencers.id, influencerId: guideInfluencers.influencerId, brandId: campaigns.brandId, createdAt: guideInfluencers.createdAt })
    .from(guideInfluencers)
    .innerJoin(guides, eq(guides.id, guideInfluencers.guideId))
    .innerJoin(campaigns, eq(campaigns.id, guides.campaignId))
    .where(and(eq(guides.workspaceId, workspaceId), inArray(guideInfluencers.influencerId, influencerIds)));
  return participationRounds(rows);
}

// 계약 기간 컬럼은 TASK-074(0020)가 만든다. 컬럼이 아직 없으면 null
export function contractOf(gi: object): { contractStartAt: number | null; contractEndAt: number | null } {
  const pick = (k: string) => {
    const v: unknown = k in gi ? (gi as Record<string, unknown>)[k] : null;
    return typeof v === "number" ? v : null;
  };
  return { contractStartAt: pick("contractStartAt"), contractEndAt: pick("contractEndAt") };
}
