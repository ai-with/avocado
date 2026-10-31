import { getDb } from "../db";
import { logEvent } from "./events";

const DAY_MS = 24 * 60 * 60 * 1000;

// 15분 cron 중 03:00 KST(18:00 UTC)에만 실행한다.
export async function cleanupAuthRecords(env: Env, controller: ScheduledController): Promise<void> {
  const at = new Date(controller.scheduledTime);
  if (at.getUTCHours() !== 18 || at.getUTCMinutes() >= 15) return;

  // 휴대폰 발송·로그인 제한의 하루 창을 보존한다. 재설정 토큰은 만료 후 하루까지 보존한다.
  const cutoff = controller.scheduledTime - DAY_MS;
  const tables = ["auth_attempts", "phone_verifications", "oauth_states", "password_resets"] as const;
  const results = await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_attempts WHERE created_at < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM phone_verifications WHERE created_at < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM oauth_states WHERE created_at < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM password_resets WHERE expires_at < ?").bind(cutoff),
  ]);

  // 개인 정보나 토큰 없이 실제 삭제 건수를 남긴다. 로그 보존 기간 뒤에도 DB에서 확인할 수 있다.
  const props = {
    scheduled_at: controller.scheduledTime,
    cutoff,
    deleted: Object.fromEntries(tables.map((table, i) => [table, results[i]!.meta.changes])),
  };
  console.log("[auth_cleanup_completed]", JSON.stringify(props));
  await logEvent(getDb(env.DB), null, "auth_cleanup_completed", props);
}
