import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db";
import { leads, leadSources, leadTagLinks, leadTags, type SourceSnapshot } from "../db/schema";
import type { LeadSourceType } from "../../shared/leads";
import type { LeadFacts } from "./lead-groups";
import { newId, newToken, now, sha256Hex } from "./ids";

export type LeadInput = {
  workspaceId: string;
  email: string;
  name?: string | null;
  company?: string | null;
  phone?: string | null;
  answers?: Record<string, string | string[]>;
  marketingOptIn?: boolean;
  alimtalkOptIn?: boolean;
  source: { type: LeadSourceType; guideId?: string | null; influencerId?: string | null; channelKey?: string | null; linkId?: string | null };
};
type Lead = typeof leads.$inferSelect;

const blankToNull = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

const sourceSnapshot = (s: LeadInput["source"], at: number): SourceSnapshot => ({
  type: s.type,
  guideId: s.guideId ?? null,
  influencerId: s.influencerId ?? null,
  channelKey: s.channelKey ?? null,
  linkId: s.linkId ?? null,
  at,
});

const freshValues = (input: LeadInput) => ({
  name: blankToNull(input.name),
  company: blankToNull(input.company),
  phone: blankToNull(input.phone),
  answers: input.answers ?? {},
  marketingOptIn: input.marketingOptIn ?? false,
  alimtalkOptIn: input.alimtalkOptIn ?? false,
});
type Fresh = ReturnType<typeof freshValues> & { emailHash: string };

// 빈 값은 기존 값을 지우지 않는다. 동의는 한 번 true 면 유지한다(철회는 수신 거부로만)
const mergedValues = (prev: Lead, fresh: Fresh, snap: SourceSnapshot) => ({
  name: fresh.name ?? prev.name,
  company: fresh.company ?? prev.company,
  phone: fresh.phone ?? prev.phone,
  answers: { ...prev.answers, ...fresh.answers },
  marketingOptIn: prev.marketingOptIn || fresh.marketingOptIn,
  alimtalkOptIn: prev.alimtalkOptIn || fresh.alimtalkOptIn,
  lastSource: snap,
  emailHash: fresh.emailHash,
});

// 삭제된 리드에 다시 들어오면 새 리드처럼 값을 갈아 끼운다
async function revive(db: Db, leadId: string, fresh: Fresh, snap: SourceSnapshot) {
  await db.delete(leadSources).where(eq(leadSources.leadId, leadId));
  await db
    .update(leads)
    .set({ ...fresh, unsubscribedAt: null, bouncedAt: null, firstSource: snap, lastSource: snap, createdAt: snap.at, deletedAt: null })
    .where(eq(leads.id, leadId));
}

// 같은 이메일은 리드 1건으로 병합하고 출처는 lead_sources 에 쌓는다.
// 폼(F-65), 리드 게이트(F-52), 키워드 DM(F-64), CSV 가져오기가 모두 이 함수를 쓴다
export async function upsertLead(db: Db, input: LeadInput): Promise<{ leadId: string; created: boolean }> {
  const email = input.email.trim().toLowerCase();
  const snap = sourceSnapshot(input.source, now());
  const fresh = { ...freshValues(input), emailHash: await sha256Hex(email) };
  const prev = await db.select().from(leads).where(and(eq(leads.workspaceId, input.workspaceId), eq(leads.email, email))).get();
  let leadId: string;
  if (!prev) {
    leadId = newId();
    await db.insert(leads).values({ id: leadId, workspaceId: input.workspaceId, email, ...fresh, unsubscribeToken: newToken(), firstSource: snap, lastSource: snap, createdAt: snap.at });
  } else if (prev.deletedAt) {
    leadId = prev.id;
    await revive(db, leadId, fresh, snap);
  } else {
    leadId = prev.id;
    await db.update(leads).set(mergedValues(prev, fresh, snap)).where(eq(leads.id, leadId));
  }
  await db.insert(leadSources).values({ id: newId(), leadId, ...snap });
  return { leadId, created: !prev || !!prev.deletedAt };
}

// ponytail: 워크스페이스 리드 전체를 읽어 메모리에서 필터·그룹 평가. 수만 건이 되면 SQL 조건으로 옮긴다
export async function loadLeads(db: Db, workspaceId: string) {
  const [rows, sources, tagLinks] = await Promise.all([
    db.select().from(leads).where(and(eq(leads.workspaceId, workspaceId), isNull(leads.deletedAt))).orderBy(desc(leads.createdAt)),
    db
      .select({ leadId: leadSources.leadId, type: leadSources.type, guideId: leadSources.guideId, influencerId: leadSources.influencerId, channelKey: leadSources.channelKey, linkId: leadSources.linkId })
      .from(leadSources)
      .innerJoin(leads, eq(leads.id, leadSources.leadId))
      .where(and(eq(leads.workspaceId, workspaceId), isNull(leads.deletedAt))),
    db.select({ leadId: leadTagLinks.leadId, tagId: leadTagLinks.tagId }).from(leadTagLinks).innerJoin(leadTags, eq(leadTags.id, leadTagLinks.tagId)).where(eq(leadTags.workspaceId, workspaceId)),
  ]);
  return rows.map((l) => {
    const facts: LeadFacts = {
      marketingOptIn: l.marketingOptIn,
      alimtalkOptIn: l.alimtalkOptIn,
      createdAt: l.createdAt,
      tagIds: tagLinks.filter((t) => t.leadId === l.id).map((t) => t.tagId),
      sources: sources.filter((s) => s.leadId === l.id),
    };
    return { lead: l, facts };
  });
}

// TASK-029 이전에 만든 리드의 email_hash 를 cron 마다 조금씩 채운다 (사이트 identify 해시 매칭용)
const HASH_BACKFILL_LIMIT = 200;
export async function backfillEmailHashes(env: Env) {
  const { results } = await env.DB.prepare("SELECT id, email FROM leads WHERE email_hash IS NULL LIMIT ?").bind(HASH_BACKFILL_LIMIT).all<{ id: string; email: string }>();
  if (results.length === 0) return;
  const updates = await Promise.all(results.map(async (r) => env.DB.prepare("UPDATE leads SET email_hash = ? WHERE id = ?").bind(await sha256Hex(r.email.trim().toLowerCase()), r.id)));
  await env.DB.batch(updates);
}
