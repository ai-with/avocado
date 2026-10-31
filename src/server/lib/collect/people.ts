import type { IdentifyEvent } from "../../../shared/sdk-events";
import { newId, newToken, now, sha256Hex } from "../ids";
import { normalizeEmail } from "./aggregate";

// identify 처리 (docs/14 4-4). 원문 이메일은 사이트 설정이 켜져 있을 때만 리드로 올리고, 해시는 기존 리드에만 잇는다

export type IdentifyJob = {
  site: { id: string; workspaceId: string; collectRawEmail: boolean };
  anonId: string;
  sessionId: string;
  linkId: string | null;
  event: IdentifyEvent;
  // HTTP 수신 시 서버가 붙인 시각. 클라이언트 event.ts는 삭제/새 등록 경계를 판정하는 데 쓰지 않는다.
  receivedAt: number;
};
type Person = { id: string; anonIds: string[]; leadId: string | null; emailHash: string | null };
const MAX_ANON_IDS = 10;
const MAX_IDENTIFY_AGE_MS = 24 * 60 * 60 * 1000;
const ACTIVE_SITE = "EXISTS (SELECT 1 FROM sites WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL)";
const ACTIVE_SOURCE = `${ACTIVE_SITE} AND EXISTS (SELECT 1 FROM site_sessions WHERE site_id = ? AND id = ? AND anon_id = ?)`;
const RAW_SOURCE = `${ACTIVE_SOURCE} AND EXISTS (SELECT 1 FROM sites WHERE id = ? AND collect_raw_email = 1)`;
const sourceParams = (job: IdentifyJob) => [job.site.id, job.site.workspaceId, job.site.id, job.sessionId, job.anonId] as const;

async function findPerson(db: D1Database, job: IdentifyJob, hash: string | null): Promise<Person | null> {
  const row = await db
    .prepare(
      `SELECT id, anon_ids AS anonIds, lead_id AS leadId, email_hash AS emailHash FROM site_people WHERE site_id = ?
       AND ((? IS NOT NULL AND email_hash = ?) OR (? IS NOT NULL AND external_id = ?) OR EXISTS (SELECT 1 FROM json_each(anon_ids) WHERE value = ?))
       AND (lead_id IS NULL OR EXISTS (SELECT 1 FROM leads WHERE id = site_people.lead_id AND workspace_id = ? AND deleted_at IS NULL AND created_at <= ?))
       ORDER BY (email_hash = ?) DESC LIMIT 1`,
    )
    .bind(job.site.id, hash, hash, job.event.externalId ?? null, job.event.externalId ?? null, job.anonId, job.site.workspaceId, job.receivedAt, hash)
    .first<{ id: string; anonIds: string; leadId: string | null; emailHash: string | null }>();
  // 같은 브라우저에서 다른 사람을 identify한 경우 옛 사람의 별칭/리드를 합치지 않는다.
  if (!row || (hash && row.emailHash && hash !== row.emailHash)) return null;
  return { ...row, anonIds: JSON.parse(row.anonIds) as string[] };
}

type LinkInfo = { guideId: string | null; influencerId: string | null; channelKey: string | null };
const linkInfo = (db: D1Database, linkId: string | null) =>
  linkId ? db.prepare("SELECT guide_id AS guideId, influencer_id AS influencerId, channel_key AS channelKey FROM short_links WHERE id = ?").bind(linkId).first<LinkInfo>() : null;

// SDK는 삭제 요청을 되돌리지 않는다. 새 원문 이메일은 만들 수 있지만 삭제된 리드는 폼/게이트 재신청으로만 다시 등록한다.
async function linkLead(env: Env, job: IdentifyJob, email: string | null, hash: string): Promise<string | null> {
  const info = (await linkInfo(env.DB, job.linkId)) ?? { guideId: null, influencerId: null, channelKey: null };
  const source = { type: "site" as const, ...info, linkId: job.linkId };
  const d1 = env.DB;
  if (email) {
    const snapshot = JSON.stringify({ ...source, at: job.receivedAt });
    await d1.batch([
      d1.prepare(`INSERT INTO leads (id, workspace_id, email, name, answers, unsubscribe_token, first_source, last_source, email_hash, created_at)
        SELECT ?, ?, ?, ?, '{}', ?, ?, ?, ?, ? WHERE ${RAW_SOURCE}
        AND NOT EXISTS (SELECT 1 FROM leads WHERE workspace_id = ? AND email = ?)`)
        .bind(newId(), job.site.workspaceId, email, job.event.name?.trim() || null, newToken(), snapshot, snapshot, hash, job.receivedAt,
          ...sourceParams(job), job.site.id, job.site.workspaceId, email),
      d1.prepare(`UPDATE leads SET name = coalesce(?, name), email_hash = ?, last_source = ?
        WHERE workspace_id = ? AND email = ? AND deleted_at IS NULL AND created_at <= ? AND ${RAW_SOURCE}`)
        .bind(job.event.name?.trim() || null, hash, snapshot, job.site.workspaceId, email, job.receivedAt, ...sourceParams(job), job.site.id),
    ]);
  }
  await d1.prepare(`INSERT INTO lead_sources (id, lead_id, type, guide_id, influencer_id, channel_key, link_id, at)
    SELECT ?, id, 'site', ?, ?, ?, ?, ? FROM leads
    WHERE workspace_id = ? AND email_hash = ? AND deleted_at IS NULL AND created_at <= ? AND ${ACTIVE_SOURCE}`)
    .bind(newId(), info.guideId, info.influencerId, info.channelKey, job.linkId, job.receivedAt, job.site.workspaceId, hash, job.receivedAt, ...sourceParams(job)).run();
  const lead = await d1.prepare(`SELECT id FROM leads WHERE workspace_id = ? AND email_hash = ? AND deleted_at IS NULL AND created_at <= ? AND ${ACTIVE_SOURCE}`)
    .bind(job.site.workspaceId, hash, job.receivedAt, ...sourceParams(job)).first<{ id: string }>();
  return lead?.id ?? null;
}

async function savePerson(db: D1Database, job: IdentifyJob, prev: Person | null, hash: string | null, leadId: string | null): Promise<string | null> {
  const externalId = job.event.externalId ?? null;
  const liveLead = "(? IS NULL OR EXISTS (SELECT 1 FROM leads WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL AND created_at <= ?))";
  if (!prev) {
    const id = newId();
    const inserted = await db
      .prepare(`INSERT INTO site_people (id, site_id, anon_ids, external_id, email_hash, lead_id, first_link_id, last_link_id, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${ACTIVE_SOURCE} AND ${liveLead}`)
      .bind(id, job.site.id, JSON.stringify([job.anonId]), externalId, hash, leadId, job.linkId, job.linkId, job.receivedAt,
        ...sourceParams(job), leadId, leadId, job.site.workspaceId, job.receivedAt)
      .run();
    return inserted.meta.changes ? id : null;
  }
  const anonIds = [...prev.anonIds.filter((a) => a !== job.anonId), job.anonId].slice(-MAX_ANON_IDS);
  const updated = await db
    .prepare(
      `UPDATE site_people SET anon_ids = ?, external_id = coalesce(?, external_id), email_hash = coalesce(?, email_hash), lead_id = coalesce(?, lead_id), first_link_id = coalesce(first_link_id, ?), last_link_id = coalesce(?, last_link_id)
       WHERE id = ? AND site_id = ? AND ${ACTIVE_SOURCE} AND ${liveLead}
       AND (lead_id IS NULL OR EXISTS (SELECT 1 FROM leads WHERE id = site_people.lead_id AND workspace_id = ? AND deleted_at IS NULL AND created_at <= ?))`,
    )
    .bind(JSON.stringify(anonIds), externalId, hash, leadId, job.linkId, job.linkId, prev.id, job.site.id,
      ...sourceParams(job), leadId, leadId, job.site.workspaceId, job.receivedAt, job.site.workspaceId, job.receivedAt)
    .run();
  return updated.meta.changes ? prev.id : null;
}

// 같은 익명 ID 의 이전 세션·전환을 이 사람에 붙인다
function backfill(db: D1Database, job: IdentifyJob, personId: string) {
  return db.batch([
    db.prepare(`UPDATE site_sessions SET person_id = ? WHERE site_id = ? AND anon_id = ? AND person_id IS NULL
      AND ${ACTIVE_SOURCE} AND EXISTS (SELECT 1 FROM site_people WHERE id = ? AND site_id = ?)`)
      .bind(personId, job.site.id, job.anonId, ...sourceParams(job), personId, job.site.id),
    db
      .prepare(`UPDATE site_conversions SET person_id = ? WHERE site_id = ? AND person_id IS NULL AND session_id IN (SELECT id FROM site_sessions WHERE site_id = ? AND anon_id = ?)
        AND ${ACTIVE_SOURCE} AND EXISTS (SELECT 1 FROM site_people WHERE id = ? AND site_id = ?)`)
      .bind(personId, job.site.id, job.site.id, job.anonId, ...sourceParams(job), personId, job.site.id),
  ]);
}

export async function applyIdentify(env: Env, job: IdentifyJob) {
  // 영구 삭제 뒤 오래 묵은 Queue가 원문 연락처를 다시 만들지 않도록, 중복 제거 창보다 오래된 식별은 버린다.
  if (!Number.isFinite(job.receivedAt) || job.receivedAt < now() - MAX_IDENTIFY_AGE_MS || job.receivedAt > now()) return;
  const site = await env.DB.prepare(`SELECT collect_raw_email AS collectRawEmail FROM sites WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM site_sessions WHERE site_id = sites.id AND id = ? AND anon_id = ?)`)
    .bind(job.site.id, job.site.workspaceId, job.sessionId, job.anonId).first<{ collectRawEmail: number }>();
  if (!site) return;
  const raw = job.event.email ? normalizeEmail(job.event.email) : null;
  const hash = raw ? await sha256Hex(raw) : (job.event.emailHash ?? null);
  // 원문 수집을 끈 사이트에 원문이 오면 해시만 남기고 버린다
  const email = site.collectRawEmail ? raw : null;
  const prev = await findPerson(env.DB, job, hash);
  const leadId = hash ? await linkLead(env, job, email, hash) : null;
  const personId = await savePerson(env.DB, job, prev, hash, leadId);
  if (personId) await backfill(env.DB, job, personId);
}
