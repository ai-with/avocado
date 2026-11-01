import { getDb } from "../db";
import { logEvent } from "./events";
import { RAW_CLEANUP_LIMIT } from "./collect/raw";

const DAY_MS = 24 * 60 * 60 * 1000;
const SITE_RETENTION_MS = 30 * DAY_MS;
const SITE_BATCH_SIZE = 100;

// 동일 트랜잭션의 모든 문장이 현재도 삭제 상태인 같은 집합을 사용한다.
const DUE_SITES = "SELECT id FROM sites WHERE deleted_at IS NOT NULL AND deleted_at <= ? ORDER BY deleted_at, id LIMIT ?";

export async function purgeDeletedSites(env: Env, controller: ScheduledController): Promise<void> {
  const cutoff = controller.scheduledTime - SITE_RETENTION_MS;
  const countDue = async () => (await env.DB.prepare("SELECT count(*) AS n FROM sites WHERE deleted_at IS NOT NULL AND deleted_at <= ?").bind(cutoff).first<{ n: number }>())?.n ?? 0;
  let before: number | null = null;
  try {
    before = await countDue();
    // Preserve every exact-key tombstone beyond the parent deletion. Old or
    // uncertain PUTs cannot become selected again and remain recheckable.
    await env.DB.prepare(`UPDATE site_raw_objects SET state='retired' WHERE id IN(
      SELECT o.id FROM site_raw_objects o JOIN sites s ON s.id=o.site_id WHERE o.state<>'retired'
      AND (o.deleted_at IS NULL OR o.deleted_at<s.deleted_at+${SITE_RETENTION_MS}) AND o.site_id IN (${DUE_SITES}) ORDER BY o.site_id,o.id LIMIT ?)`)
      .bind(cutoff, SITE_BATCH_SIZE, RAW_CLEANUP_LIMIT).run();
    const objects = await env.DB.prepare(`SELECT o.id,o.key FROM site_raw_objects o JOIN sites s ON s.id=o.site_id
      WHERE (o.deleted_at IS NULL OR o.deleted_at<s.deleted_at+${SITE_RETENTION_MS}) AND o.site_id IN (${DUE_SITES}) ORDER BY o.site_id,o.id LIMIT ?`)
      .bind(cutoff, SITE_BATCH_SIZE, RAW_CLEANUP_LIMIT).all<{ id: string; key: string }>();
    if (objects.results.length) {
      await env.FILES.delete(objects.results.map((row) => row.key));
      await env.DB.prepare("UPDATE site_raw_objects SET deleted_at=?,checked_at=? WHERE id IN(SELECT value FROM json_each(?)) AND state='retired'")
        .bind(Date.now(), Date.now(), JSON.stringify(objects.results.map((row) => row.id))).run();
    }
    const erasedSites = DUE_SITES.replace(" ORDER BY", ` AND NOT EXISTS(SELECT 1 FROM site_raw_objects o WHERE o.site_id=sites.id
      AND (o.deleted_at IS NULL OR o.deleted_at<sites.deleted_at+${SITE_RETENTION_MS} OR o.lease_until>?)) ORDER BY`);
    const readySites = erasedSites.replace(" ORDER BY", ` AND NOT EXISTS(SELECT 1 FROM site_raw_batches b WHERE b.site_id=sites.id)
      AND NOT EXISTS(SELECT 1 FROM site_collect_intakes i WHERE i.site_id=sites.id) ORDER BY`);
    const result = await env.DB.batch([
      // New storage children drain in bounded chunks before the parent cascade.
      env.DB.prepare(`DELETE FROM site_raw_batches WHERE id IN(SELECT id FROM site_raw_batches WHERE site_id IN (${erasedSites}) ORDER BY id LIMIT ?)`)
        .bind(cutoff, Date.now(), SITE_BATCH_SIZE, RAW_CLEANUP_LIMIT),
      env.DB.prepare(`DELETE FROM site_collect_intakes WHERE id IN(SELECT id FROM site_collect_intakes WHERE site_id IN (${erasedSites}) ORDER BY id LIMIT ?)`)
        .bind(cutoff, Date.now(), SITE_BATCH_SIZE, RAW_CLEANUP_LIMIT),
      // 이 테이블만 site FK가 없다. 나머지 SDK 테이블은 sites 삭제에 cascade된다.
      env.DB.prepare(`DELETE FROM site_event_ids WHERE site_id IN (${readySites})`).bind(cutoff, Date.now(), SITE_BATCH_SIZE),
      env.DB.prepare(`DELETE FROM sites WHERE id IN (${readySites})`).bind(cutoff, Date.now(), SITE_BATCH_SIZE),
    ]);
    const remaining = await countDue();
    const props = { scheduled_at: controller.scheduledTime, cutoff, sites_deleted: result[3]!.meta.changes, event_ids_deleted: result[2]!.meta.changes,
      raw_batches_deleted: result[0]!.meta.changes, intakes_deleted: result[1]!.meta.changes, r2_keys_deleted: objects.results.length,
      overdue_before: before, overdue_remaining: remaining, failures: 0, analytics_engine: "provider_retention_unresolved" };
    const name = remaining === 0 ? "site_privacy_cleanup_completed" : "site_privacy_cleanup_progress";
    console.log(`[${name}]`, JSON.stringify(props));
    await logEvent(getDb(env.DB), null, name, props);
    // Drain additional pages in separate invocations. Cron remains the durable
    // fallback if enqueue fails or max retries have already been exhausted.
    if (remaining && (objects.results.length === RAW_CLEANUP_LIMIT || result[3]!.meta.changes === SITE_BATCH_SIZE
      || result[0]!.meta.changes === RAW_CLEANUP_LIMIT || result[1]!.meta.changes === RAW_CLEANUP_LIMIT)) {
      await env.PIPELINE.sendBatch([{ body: { type: "privacy_purge", payload: { kind: "sites", scheduledTime: controller.scheduledTime, cron: controller.cron ?? "" } } }]);
    }
  } catch {
    // 삭제 성공이나 AE 원본 파기로 표시하지 않는다. DB 실패는 스케줄러에도 전파한다.
    console.error("[site_privacy_cleanup_failed]", JSON.stringify({ scheduled_at: controller.scheduledTime, cutoff, overdue_before: before, failures: 1 }));
    throw new Error("site_privacy_cleanup_failed");
  }
}
