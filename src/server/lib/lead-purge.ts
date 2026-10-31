import { getDb } from "../db";
import { logEvent } from "./events";
import { sha256Hex } from "./ids";

export const LEAD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const IP_HASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const CRON_INTERVAL_MS = 15 * 60 * 1000;
const PURGE_BATCH = 500;

type Bound = string | number | null;
export type PurgeStatement = { name: string; statement: D1PreparedStatement };

// 선택은 모든 문장에서 다시 평가한다. 같은 D1 batch 안에서 복구와 파기가 끼어들지 않게 한다.
// selection은 이 파일/리드 복구 코드의 고정 SQL만 받으며, 값은 항상 바인딩한다.
export function leadPurgeStatements(db: D1Database, selection: string, params: Bound[], keepViewId: string | null = null): PurgeStatement[] {
  const cte = `WITH target_leads AS (${selection}),
    target_people AS (
      SELECT p.id, p.site_id, p.anon_ids FROM target_leads l JOIN sites s ON s.workspace_id = l.workspace_id
      JOIN site_people p ON p.site_id = s.id AND (p.lead_id = l.id OR (l.email_hash IS NOT NULL AND p.email_hash = l.email_hash))
    ), target_jobs AS (
      SELECT j.id, j.site_id, j.session_id FROM target_leads l JOIN sites s ON s.workspace_id = l.workspace_id
      JOIN site_identify_jobs j ON j.site_id = s.id AND j.workspace_id = l.workspace_id
        AND (j.resolved_lead_id = l.id OR (l.email_hash IS NOT NULL AND j.email_hash = l.email_hash))
    ), target_sessions AS (
      SELECT ss.site_id, ss.id FROM target_people p JOIN site_sessions ss ON ss.site_id = p.site_id AND ss.person_id = p.id
      UNION
      SELECT ss.site_id, ss.id FROM target_people p JOIN json_each(p.anon_ids) anon
      JOIN site_sessions ss ON ss.site_id = p.site_id AND ss.anon_id = anon.value
        AND (ss.person_id IS NULL OR ss.person_id IN (SELECT id FROM target_people))
      UNION
      SELECT ss.site_id, ss.id FROM target_jobs j JOIN site_sessions ss ON ss.site_id = j.site_id AND ss.id = j.session_id
    )`;
  const query = (name: string, sql: string, extra: Bound[] = []): PurgeStatement => ({ name, statement: db.prepare(`${cte} ${sql}`).bind(...params, ...extra) });
  return [
    query("form_submissions", "DELETE FROM form_submissions WHERE lead_id IN (SELECT id FROM target_leads)"),
    query("doc_verify_tokens", "DELETE FROM doc_verify_tokens WHERE lead_id IN (SELECT id FROM target_leads)"),
    query("document_page_views", "DELETE FROM document_page_views WHERE view_id IN (SELECT id FROM document_views WHERE lead_id IN (SELECT id FROM target_leads) AND (? IS NULL OR id <> ?))", [keepViewId, keepViewId]),
    query("document_views", "DELETE FROM document_views WHERE lead_id IN (SELECT id FROM target_leads) AND (? IS NULL OR id <> ?)", [keepViewId, keepViewId]),
    query("site_conversions", `DELETE FROM site_conversions WHERE id IN (
      SELECT c.id FROM target_people p JOIN site_conversions c ON c.site_id = p.site_id AND c.person_id = p.id
      UNION SELECT c.id FROM target_sessions ss JOIN site_conversions c ON c.site_id = ss.site_id AND c.session_id = ss.id
    )`),
    query("site_sessions", "DELETE FROM site_sessions WHERE (site_id, id) IN (SELECT site_id, id FROM target_sessions)"),
    // Session deletion cascades pending-only jobs AFTER conversion selection used their linkage.
    // Also clear receipts that share a target person/session, even if they carried no email hash.
    query("site_identify_jobs", `DELETE FROM site_identify_jobs WHERE id IN (SELECT id FROM target_jobs)
      OR (site_id, session_id) IN (SELECT site_id, id FROM target_sessions)
      OR resolved_person_id IN (SELECT id FROM target_people)`),
    query("site_people", "DELETE FROM site_people WHERE id IN (SELECT id FROM target_people)"),
    query("automation_runs", "DELETE FROM automation_runs WHERE lead_id IN (SELECT id FROM target_leads)"),
    query("message_logs", "DELETE FROM message_logs WHERE lead_id IN (SELECT id FROM target_leads)"),
    query("lead_tag_links", "DELETE FROM lead_tag_links WHERE lead_id IN (SELECT id FROM target_leads)"),
    query("lead_sources", "DELETE FROM lead_sources WHERE lead_id IN (SELECT id FROM target_leads)"),
    query("leads", "DELETE FROM leads WHERE id IN (SELECT id FROM target_leads)"),
  ];
}

// 7일 기한 뒤 다음 실행까지 남지 않도록, 다음 15분 안에 기한이 오는 행도 이번에 처리한다.
export async function purgeDeletedLeads(env: Env, controller: ScheduledController): Promise<void> {
  const scheduledAt = controller.scheduledTime;
  const cutoff = scheduledAt + CRON_INTERVAL_MS - LEAD_RETENTION_MS;
  try {
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE deleted_at IS NOT NULL AND deleted_at <= ?").bind(scheduledAt - LEAD_RETENTION_MS).first<{ n: number }>();
    const due = await env.DB.prepare("SELECT id, email, email_hash, deleted_at, created_at FROM leads WHERE deleted_at IS NOT NULL AND deleted_at <= ? ORDER BY deleted_at, id LIMIT ?")
      .bind(cutoff, PURGE_BATCH).all<{ id: string; email: string; email_hash: string | null; deleted_at: number; created_at: number }>();
    // 해시가 없던 과거 리드도 해시만 가진 SDK 식별자를 함께 파기한다. 원문 주소는 로그/이력에 남기지 않는다.
    const selected = await Promise.all(due.results.map(async (lead) => ({ id: lead.id, email_hash: lead.email_hash ?? await sha256Hex(lead.email.trim().toLowerCase()), deleted_at: lead.deleted_at, created_at: lead.created_at })));
    const selection = `SELECT l.id, l.workspace_id, json_extract(candidate.value, '$.email_hash') AS email_hash FROM leads l, json_each(?) candidate
      WHERE l.id = json_extract(candidate.value, '$.id') AND l.deleted_at = json_extract(candidate.value, '$.deleted_at') AND l.created_at = json_extract(candidate.value, '$.created_at')`;
    const statements = leadPurgeStatements(env.DB, selection, [JSON.stringify(selected)]);
    statements.push({ name: "ip_hashes", statement: env.DB.prepare("UPDATE link_clicks SET ip_hash = NULL WHERE ip_hash IS NOT NULL AND at <= ?").bind(scheduledAt - IP_HASH_RETENTION_MS) });
    const results = await env.DB.batch(statements.map((entry) => entry.statement));
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE deleted_at IS NOT NULL AND deleted_at <= ?").bind(scheduledAt - LEAD_RETENTION_MS).first<{ n: number }>();
    const props = { scheduled_at: scheduledAt, cutoff, deleted: Object.fromEntries(statements.map((entry, i) => [entry.name, results[i]!.meta.changes])), overdue_before: before?.n ?? 0, overdue_remaining: after?.n ?? 0, failures: 0 };
    console.log("[lead_privacy_cleanup_completed]", JSON.stringify(props));
    await logEvent(getDb(env.DB), null, "lead_privacy_cleanup_completed", props);
  } catch (error) {
    console.error("[lead_privacy_cleanup_failed]", JSON.stringify({ scheduled_at: scheduledAt, cutoff, failures: 1 }));
    throw error;
  }
}
