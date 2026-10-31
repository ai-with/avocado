import { getDb } from "../db";
import { logEvent } from "./events";

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
    const result = await env.DB.batch([
      // 이 테이블만 site FK가 없다. 나머지 SDK 테이블은 sites 삭제에 cascade된다.
      env.DB.prepare(`DELETE FROM site_event_ids WHERE site_id IN (${DUE_SITES})`).bind(cutoff, SITE_BATCH_SIZE),
      env.DB.prepare(`DELETE FROM sites WHERE id IN (${DUE_SITES})`).bind(cutoff, SITE_BATCH_SIZE),
    ]);
    const props = { scheduled_at: controller.scheduledTime, cutoff, sites_deleted: result[1]!.meta.changes, event_ids_deleted: result[0]!.meta.changes, overdue_before: before, overdue_remaining: await countDue(), failures: 0, analytics_engine: "provider_retention_unresolved" };
    console.log("[site_privacy_cleanup_completed]", JSON.stringify(props));
    await logEvent(getDb(env.DB), null, "site_privacy_cleanup_completed", props);
  } catch (error) {
    // 삭제 성공이나 AE 원본 파기로 표시하지 않는다. DB 실패는 스케줄러에도 전파한다.
    console.error("[site_privacy_cleanup_failed]", JSON.stringify({ scheduled_at: controller.scheduledTime, cutoff, overdue_before: before, failures: 1 }));
    throw error;
  }
}
