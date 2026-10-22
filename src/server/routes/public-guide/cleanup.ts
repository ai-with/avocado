import { and, eq, lt } from "drizzle-orm";
import { getDb } from "../../db";
import { submissions } from "../../db/schema";
import { now } from "../../lib/ids";
import { UPLOAD_LIMITS } from "../../../shared/guides";
import { markAborted } from "./shared";

const STALE_BATCH = 50;

// 24시간 넘게 완료되지 않은 멀티파트 업로드를 정리한다 (F-59 예외). Cron 에서 호출
export async function abortStaleUploads(env: Env) {
  const db = getDb(env.DB);
  const stale = await db
    .select()
    .from(submissions)
    .where(and(eq(submissions.status, "uploading"), lt(submissions.createdAt, now() - UPLOAD_LIMITS.staleMs)))
    .limit(STALE_BATCH);
  for (const s of stale) {
    if (s.originalKey && s.uploadId) await env.FILES.resumeMultipartUpload(s.originalKey, s.uploadId).abort().catch((e: unknown) => console.error("[upload:abort]", s.id, e));
    await markAborted(db, s.id);
  }
}
