import type { IdentifyEvent } from "../../../shared/sdk-events";
import { newToken } from "../ids";

export type IdentifyJob = {
  site: { id: string; workspaceId: string; collectRawEmail: boolean };
  anonId: string;
  sessionId: string;
  linkId: string | null;
  event: IdentifyEvent;
  // This is the original server receipt time, never the client's event clock or retry time.
  receivedAt: number;
};

export const MAX_IDENTIFY_AGE_MS = 24 * 60 * 60 * 1000;
export type IdentifyPayload = { email: string | null; name: string | null; externalId: string | null; linkId: string | null };
export type StoredIdentifyJob = {
  id: string; site_id: string; workspace_id: string; session_id: string; anon_id: string; event_id: string;
  received_at: number; expires_at: number; email_hash: string | null; payload_enc: string | null; status: string;
};

// Every effect evaluates these boundaries inside the same native D1 transaction as its claim.
export const identifySourceIsCurrent = (alias: string) => `EXISTS (SELECT 1 FROM sites s WHERE s.id = ${alias}.site_id AND s.workspace_id = ${alias}.workspace_id AND s.deleted_at IS NULL)
  AND EXISTS (SELECT 1 FROM site_sessions ss WHERE ss.site_id = ${alias}.site_id AND ss.id = ${alias}.session_id AND ss.anon_id = ${alias}.anon_id)`;

export function identifyEffectStatements(db: D1Database, job: StoredIdentifyJob, payload: IdentifyPayload, token: string, at: number): D1PreparedStatement[] {
  const current = `WITH current_job AS (SELECT j.* FROM site_identify_jobs j WHERE j.id = ? AND j.claim_token = ? AND j.status = 'pending'
    AND j.payload_enc IS NOT NULL AND j.received_at >= ? AND j.received_at <= ? AND j.expires_at > ? AND ${identifySourceIsCurrent("j")})`;
  const statement = (sql: string, params: (string | number | null)[] = []) => db.prepare(`${current} ${sql}`).bind(job.id, token, at - MAX_IDENTIFY_AGE_MS, at, at, ...params);
  const rawAllowed = "EXISTS (SELECT 1 FROM sites WHERE id = j.site_id AND collect_raw_email = 1)";
  const liveLead = "l.workspace_id = j.workspace_id AND l.deleted_at IS NULL AND l.created_at <= j.received_at";
  const link = "LEFT JOIN short_links sl ON sl.id = ? AND sl.workspace_id = j.workspace_id";
  const snapshot = "json_object('type', 'site', 'guideId', sl.guide_id, 'influencerId', sl.influencer_id, 'channelKey', sl.channel_key, 'linkId', sl.id, 'at', j.received_at)";
  return [
    statement(`INSERT INTO leads (id, workspace_id, email, name, answers, unsubscribe_token, first_source, last_source, email_hash, created_at)
      SELECT 'identify_lead:' || j.id, j.workspace_id, ?, ?, '{}', ?, ${snapshot}, ${snapshot}, j.email_hash, j.received_at
      FROM current_job j ${link} WHERE ? IS NOT NULL AND j.email_hash IS NOT NULL AND ${rawAllowed}
      AND NOT EXISTS (SELECT 1 FROM leads WHERE workspace_id = j.workspace_id AND email = ?)`,
    [payload.email, payload.name, newToken(), payload.linkId, payload.email, payload.email]),
    statement(`UPDATE leads AS l SET name = coalesce(?, l.name), email_hash = j.email_hash, last_source = ${snapshot}
      FROM current_job j ${link} WHERE l.email = ? AND ${liveLead} AND ${rawAllowed}
      AND j.received_at >= coalesce(json_extract(l.last_source, '$.at'), 0)`,
    [payload.name, payload.linkId, payload.email]),
    // Canonical IDs are chosen from current rows under the SQL claim, never from a stale JS SELECT.
    statement(`UPDATE site_identify_jobs AS target SET resolved_lead_id = (
      SELECT l.id FROM current_job j JOIN leads l ON l.email_hash = j.email_hash
      WHERE ${liveLead} ORDER BY l.created_at, l.id LIMIT 1)
      WHERE target.id IN (SELECT id FROM current_job)`),
    statement(`UPDATE site_identify_jobs AS target SET resolved_person_id = coalesce((
      SELECT p.id FROM current_job j JOIN site_people p ON p.site_id = j.site_id
      WHERE ((j.email_hash IS NOT NULL AND p.email_hash = j.email_hash) OR (? IS NOT NULL AND p.external_id = ?)
        OR EXISTS (SELECT 1 FROM json_each(p.anon_ids) WHERE value = j.anon_id))
      AND (j.email_hash IS NULL OR p.email_hash IS NULL OR p.email_hash = j.email_hash)
      AND (p.lead_id IS NULL OR EXISTS (SELECT 1 FROM leads l WHERE l.id = p.lead_id AND l.workspace_id = j.workspace_id
        AND (j.email_hash IS NULL OR l.email_hash = j.email_hash)))
      ORDER BY CASE WHEN p.email_hash = j.email_hash THEN 0 WHEN p.external_id = ? THEN 1 ELSE 2 END, p.created_at, p.id LIMIT 1), 'identify_person:' || target.id)
      WHERE target.id IN (SELECT id FROM current_job)`, [payload.externalId, payload.externalId, payload.externalId]),
    statement(`INSERT INTO lead_sources (id, lead_id, type, guide_id, influencer_id, channel_key, link_id, at)
      SELECT 'identify_source:' || j.id, l.id, 'site', sl.guide_id, sl.influencer_id, sl.channel_key, sl.id, j.received_at
      FROM current_job j JOIN leads l ON l.id = j.resolved_lead_id ${link} WHERE ${liveLead}
      ON CONFLICT(id) DO NOTHING`, [payload.linkId]),
    statement(`INSERT INTO site_people (id, site_id, anon_ids, external_id, email_hash, lead_id, first_link_id, last_link_id, created_at)
      SELECT j.resolved_person_id, j.site_id, json_array(j.anon_id), ?, j.email_hash, j.resolved_lead_id, sl.id, sl.id, j.received_at
      FROM current_job j ${link}
      WHERE j.resolved_person_id IS NOT NULL AND (j.resolved_lead_id IS NULL OR EXISTS (SELECT 1 FROM leads l WHERE l.id = j.resolved_lead_id AND ${liveLead}))
      ON CONFLICT(id) DO NOTHING`, [payload.externalId, payload.linkId]),
    statement(`UPDATE site_people AS p SET
      anon_ids = json_insert((SELECT json_group_array(value) FROM (
        SELECT value FROM (SELECT value, CAST(key AS INTEGER) AS position FROM json_each(p.anon_ids)
          WHERE value <> j.anon_id ORDER BY position DESC LIMIT 9) ORDER BY position)), '$[#]', j.anon_id),
      external_id = coalesce(?, p.external_id), email_hash = coalesce(j.email_hash, p.email_hash),
      lead_id = coalesce(j.resolved_lead_id, p.lead_id), first_link_id = coalesce(p.first_link_id, sl.id), last_link_id = coalesce(sl.id, p.last_link_id)
      FROM current_job j ${link} WHERE p.id = j.resolved_person_id AND p.site_id = j.site_id AND p.created_at <= j.received_at
      AND (j.email_hash IS NULL OR p.email_hash IS NULL OR p.email_hash = j.email_hash)
      AND (p.lead_id IS NULL OR EXISTS (SELECT 1 FROM leads l WHERE l.id = p.lead_id AND ${liveLead}))
      AND (j.resolved_lead_id IS NULL OR EXISTS (SELECT 1 FROM leads l WHERE l.id = j.resolved_lead_id AND ${liveLead}))`, [payload.externalId, payload.linkId]),
    statement(`UPDATE site_sessions AS ss SET person_id = j.resolved_person_id FROM current_job j
      WHERE ss.site_id = j.site_id AND ss.anon_id = j.anon_id AND ss.person_id IS NULL AND ss.first_at <= j.received_at
      AND EXISTS (SELECT 1 FROM site_people p WHERE p.id = j.resolved_person_id AND p.site_id = j.site_id AND p.created_at <= j.received_at
        AND (p.lead_id IS NULL OR EXISTS (SELECT 1 FROM leads l WHERE l.id = p.lead_id AND ${liveLead})))`),
    statement(`UPDATE site_conversions AS c SET person_id = j.resolved_person_id FROM current_job j
      WHERE c.site_id = j.site_id AND c.person_id IS NULL AND coalesce(c.received_at,c.at) <= j.received_at
      AND c.session_id IN (SELECT id FROM site_sessions WHERE site_id = j.site_id AND anon_id = j.anon_id AND first_at <= j.received_at)
      AND EXISTS (SELECT 1 FROM site_people p WHERE p.id = j.resolved_person_id AND p.site_id = j.site_id AND p.created_at <= j.received_at
        AND (p.lead_id IS NULL OR EXISTS (SELECT 1 FROM leads l WHERE l.id = p.lead_id AND ${liveLead})))`),
    statement(`UPDATE site_identify_jobs SET status = 'done', payload_enc = NULL, claim_token = NULL, last_error = NULL, updated_at = ?
      WHERE id IN (SELECT id FROM current_job)`, [at]),
  ];
}

// Compatibility for callers/tests outside collect. Production stages in the aggregate transaction.
export async function applyIdentify(env: Env, job: IdentifyJob): Promise<void> {
  const { prepareIdentifyJobs, processIdentifyJob } = await import("./identify-outbox");
  const prepared = await prepareIdentifyJobs(env, [job]);
  if (!prepared.statement) return;
  await env.DB.batch([prepared.statement]);
  for (const id of prepared.ids) await processIdentifyJob({ id }, env);
}
