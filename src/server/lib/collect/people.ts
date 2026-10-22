import type { IdentifyEvent } from "../../../shared/sdk-events";
import { getDb } from "../../db";
import { leadSources } from "../../db/schema";
import { newId, now, sha256Hex } from "../ids";
import { upsertLead } from "../leads";
import { normalizeEmail } from "./aggregate";

// identify 처리 (docs/14 4-4). 원문 이메일은 사이트 설정이 켜져 있을 때만 리드로 올리고, 해시는 기존 리드에만 잇는다

export type IdentifyJob = {
  site: { id: string; workspaceId: string; collectRawEmail: boolean };
  anonId: string;
  sessionId: string;
  linkId: string | null;
  event: IdentifyEvent;
};
type Person = { id: string; anonIds: string[]; leadId: string | null };
const MAX_ANON_IDS = 10;

async function findPerson(db: D1Database, siteId: string, hash: string | null, externalId: string | null, anonId: string): Promise<Person | null> {
  const row = await db
    .prepare(
      `SELECT id, anon_ids AS anonIds, lead_id AS leadId FROM site_people WHERE site_id = ?
       AND ((? IS NOT NULL AND email_hash = ?) OR (? IS NOT NULL AND external_id = ?) OR EXISTS (SELECT 1 FROM json_each(anon_ids) WHERE value = ?))
       ORDER BY (email_hash = ?) DESC LIMIT 1`,
    )
    .bind(siteId, hash, hash, externalId, externalId, anonId, hash)
    .first<{ id: string; anonIds: string; leadId: string | null }>();
  return row ? { ...row, anonIds: JSON.parse(row.anonIds) as string[] } : null;
}

type LinkInfo = { guideId: string | null; influencerId: string | null; channelKey: string | null };
const linkInfo = (db: D1Database, linkId: string | null) =>
  linkId ? db.prepare("SELECT guide_id AS guideId, influencer_id AS influencerId, channel_key AS channelKey FROM short_links WHERE id = ?").bind(linkId).first<LinkInfo>() : null;

// 원문 이메일이면 upsertLead(새 리드 가능), 해시뿐이면 같은 해시의 살아 있는 리드만 찾아 출처를 붙인다
async function linkLead(env: Env, job: IdentifyJob, email: string | null, hash: string): Promise<string | null> {
  const info = (await linkInfo(env.DB, job.linkId)) ?? { guideId: null, influencerId: null, channelKey: null };
  const source = { type: "site" as const, ...info, linkId: job.linkId };
  const db = getDb(env.DB);
  if (email) return (await upsertLead(db, { workspaceId: job.site.workspaceId, email, name: job.event.name, source })).leadId;
  const lead = await env.DB.prepare("SELECT id FROM leads WHERE workspace_id = ? AND email_hash = ? AND deleted_at IS NULL").bind(job.site.workspaceId, hash).first<{ id: string }>();
  if (lead) await db.insert(leadSources).values({ id: newId(), leadId: lead.id, ...source, at: now() });
  return lead?.id ?? null;
}

async function savePerson(db: D1Database, job: IdentifyJob, prev: Person | null, hash: string | null, leadId: string | null): Promise<string> {
  const externalId = job.event.externalId ?? null;
  if (!prev) {
    const id = newId();
    await db
      .prepare("INSERT INTO site_people (id, site_id, anon_ids, external_id, email_hash, lead_id, first_link_id, last_link_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, job.site.id, JSON.stringify([job.anonId]), externalId, hash, leadId, job.linkId, job.linkId, now())
      .run();
    return id;
  }
  const anonIds = [...prev.anonIds.filter((a) => a !== job.anonId), job.anonId].slice(-MAX_ANON_IDS);
  await db
    .prepare(
      "UPDATE site_people SET anon_ids = ?, external_id = coalesce(?, external_id), email_hash = coalesce(?, email_hash), lead_id = coalesce(?, lead_id), first_link_id = coalesce(first_link_id, ?), last_link_id = coalesce(?, last_link_id) WHERE id = ?",
    )
    .bind(JSON.stringify(anonIds), externalId, hash, leadId, job.linkId, job.linkId, prev.id)
    .run();
  return prev.id;
}

// 같은 익명 ID 의 이전 세션·전환을 이 사람에 붙인다
function backfill(db: D1Database, siteId: string, anonId: string, personId: string) {
  return db.batch([
    db.prepare("UPDATE site_sessions SET person_id = ? WHERE site_id = ? AND anon_id = ? AND person_id IS NULL").bind(personId, siteId, anonId),
    db
      .prepare("UPDATE site_conversions SET person_id = ? WHERE site_id = ? AND person_id IS NULL AND session_id IN (SELECT id FROM site_sessions WHERE site_id = ? AND anon_id = ?)")
      .bind(personId, siteId, siteId, anonId),
  ]);
}

export async function applyIdentify(env: Env, job: IdentifyJob) {
  const raw = job.event.email ? normalizeEmail(job.event.email) : null;
  const hash = raw ? await sha256Hex(raw) : (job.event.emailHash ?? null);
  // 원문 수집을 끈 사이트에 원문이 오면 해시만 남기고 버린다
  const email = job.site.collectRawEmail ? raw : null;
  const prev = await findPerson(env.DB, job.site.id, hash, job.event.externalId ?? null, job.anonId);
  const leadId = hash ? await linkLead(env, job, email, hash) : null;
  const personId = await savePerson(env.DB, job, prev, hash, leadId);
  await backfill(env.DB, job.site.id, job.anonId, personId);
}
