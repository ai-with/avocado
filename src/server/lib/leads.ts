import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db";
import { leads, leadSources, leadTagLinks, leadTags, type SourceSnapshot } from "../db/schema";
import type { LeadSourceType } from "../../shared/leads";
import type { LeadFacts } from "./lead-groups";
import { newId, newToken, now, sha256Hex } from "./ids";
import { leadPurgeStatements } from "./lead-purge";
import { leadSearchValues } from "./lead-search";

export type LeadInput = {
  workspaceId: string;
  email: string;
  name?: string | null;
  company?: string | null;
  phone?: string | null;
  answers?: Record<string, string | string[]>;
  marketingOptIn?: boolean;
  alimtalkOptIn?: boolean;
  // 삭제 후 재신청한 현재 게이트 세션만 새 리드에 잇고, 과거 열람 기록은 파기한다.
  currentViewId?: string;
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

// 새 등록은 새 ID로 만든다. 옛 반송·수신 거부 토큰·자동 발송·SDK 식별이 새 등록에 적용되지 않는다.
async function revive(db: Db, prev: Lead, email: string, fresh: Fresh, snap: SourceSnapshot, currentViewId?: string): Promise<string | null> {
  const id = newId();
  const d1 = db.$client;
  const cleanup = leadPurgeStatements(d1,
    "SELECT id, workspace_id, ? AS email_hash FROM leads WHERE id = ? AND workspace_id = ? AND created_at = ? AND deleted_at = ?",
    [fresh.emailHash, prev.id, prev.workspaceId, prev.createdAt, prev.deletedAt], currentViewId ?? null);
  const search = leadSearchValues({ email, ...fresh });
  const insert = d1.prepare(`INSERT INTO leads (id, workspace_id, email, name, company, phone, answers, marketing_opt_in, alimtalk_opt_in, unsubscribe_token, first_source, last_source, email_hash, created_at,search_email_v1,search_name_v1,search_company_v1,search_phone_v1)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?,?,?,?
    WHERE NOT EXISTS (SELECT 1 FROM leads WHERE workspace_id = ? AND email = ?)`)
    .bind(id, prev.workspaceId, email, fresh.name, fresh.company, fresh.phone, JSON.stringify(fresh.answers), fresh.marketingOptIn ? 1 : 0, fresh.alimtalkOptIn ? 1 : 0, newToken(), JSON.stringify(snap), JSON.stringify(snap), fresh.emailHash, snap.at, search.searchEmailV1, search.searchNameV1, search.searchCompanyV1, search.searchPhoneV1, prev.workspaceId, email);
  const statements = [...cleanup.map((entry) => entry.statement), insert];
  if (currentViewId) statements.push(d1.prepare(`UPDATE document_views SET lead_id = ? WHERE id = ?
    AND document_id IN (SELECT id FROM documents WHERE workspace_id = ?)
    AND EXISTS (SELECT 1 FROM leads WHERE id = ?)`)
    .bind(id, currentViewId, prev.workspaceId, id));
  const results = await d1.batch(statements);
  return results[cleanup.length]!.meta.changes ? id : null;
}

// 같은 이메일은 리드 1건으로 병합하고 출처는 lead_sources 에 쌓는다.
// 폼(F-65), 리드 게이트(F-52), 키워드 DM(F-64), CSV 가져오기가 모두 이 함수를 쓴다
export async function upsertLead(db: Db, input: LeadInput): Promise<{ leadId: string; created: boolean }> {
  const email = input.email.trim().toLowerCase();
  const fresh = { ...freshValues(input), emailHash: await sha256Hex(email) };
  // 동시에 재신청·파기가 들어오면 같은 이메일의 현재 세대를 다시 읽는다.
  for (let attempt = 0; attempt < 3; attempt++) {
    const snap = sourceSnapshot(input.source, now());
    const prev = await db.select().from(leads).where(and(eq(leads.workspaceId, input.workspaceId), eq(leads.email, email))).get();
    let leadId: string | null;
    if (!prev) {
      leadId = newId();
      const inserted = await db.insert(leads).values({ id: leadId, workspaceId: input.workspaceId, email, ...fresh, ...leadSearchValues({ email, ...fresh }), unsubscribeToken: newToken(), firstSource: snap, lastSource: snap, createdAt: snap.at }).onConflictDoNothing().returning({ id: leads.id });
      if (!inserted.length) continue;
    } else if (prev.deletedAt !== null) {
      leadId = await revive(db, prev, email, fresh, snap, input.currentViewId);
      if (!leadId) continue;
    } else {
      leadId = prev.id;
      const merged = mergedValues(prev, fresh, snap), search = leadSearchValues({ email, ...merged });
      const update = db.update(leads).set(merged)
        .where(and(eq(leads.id, leadId), eq(leads.createdAt, prev.createdAt), isNull(leads.deletedAt))).returning({ id: leads.id }).toSQL();
      const updated = await db.$client.batch([
        db.$client.prepare(update.sql).bind(...update.params),
        db.$client.prepare(`UPDATE leads SET search_email_v1=?,search_name_v1=?,search_company_v1=?,search_phone_v1=? WHERE id=? AND workspace_id=? AND created_at=? AND deleted_at IS NULL AND email IS ? AND name IS ? AND company IS ? AND phone IS ?`)
          .bind(search.searchEmailV1, search.searchNameV1, search.searchCompanyV1, search.searchPhoneV1, leadId, input.workspaceId, prev.createdAt, email, merged.name, merged.company, merged.phone),
      ]);
      if (!updated[0]!.results.length) continue;
    }
    await db.insert(leadSources).values({ id: newId(), leadId, ...snap });
    return { leadId, created: !prev || prev.deletedAt !== null };
  }
  throw new Error("리드 등록 상태가 바뀌었어요. 다시 시도해 주세요.");
}

// Legacy delivery-only selection. HTTP list/count use lead-query; 398 splits delivery.
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
