import { z } from "zod";
import { purgeDeletedLeads } from "./lead-purge";
import { purgeDeletedSites } from "./site-purge";
import { runMediaPurges } from "./media-purge";
import { maintainSdkStorage } from "./collect/raw";

const KINDS = ["leads", "sites", "media"] as const;
const payloadSchema = z.object({ kind: z.enum(KINDS), scheduledTime: z.number().int().nonnegative(), cron: z.string().max(100) });

// 기존 PIPELINE은 max_batch_size=1이다. 각 개인정보 작업을 별도 호출로 실행해 Cron 예산과 분리한다.
export async function enqueuePrivacyPurges(env: Env, controller: ScheduledController): Promise<void> {
  await env.PIPELINE.sendBatch(KINDS.map((kind) => ({ body: { type: "privacy_purge", payload: { kind, scheduledTime: controller.scheduledTime, cron: controller.cron } } })));
}

export async function processPrivacyPurge(raw: unknown, env: Env): Promise<void> {
  const job = payloadSchema.parse(raw);
  const controller: ScheduledController = { scheduledTime: job.scheduledTime, cron: job.cron, noRetry() {} };
  // 실패는 기존 Queue consumer까지 전파해 재시도하고, 다음 Cron에서도 영속 작업을 다시 처리한다.
  if (job.kind === "leads") await purgeDeletedLeads(env, controller);
  else if (job.kind === "sites") {
    // Intake dispatch or another site's failed retired PUT must not prevent
    // an overdue site's independent deletion attempt in this invocation.
    let failed = false;
    try { await maintainSdkStorage(env); } catch { failed = true; }
    try { await purgeDeletedSites(env, controller); } catch { failed = true; }
    if (failed) throw new Error("sdk_privacy_cleanup_failed");
  }
  else await runMediaPurges(env);
}
