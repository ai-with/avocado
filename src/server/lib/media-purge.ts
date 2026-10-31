import { sql, type SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { getDb, type Db } from "../db";
import { ApiError } from "./errors";
import { newId, now } from "./ids";

type Resource = { key: string; kind: "object" | "multipart"; uploadId?: string | null };
type Purge = { submissionId: string; consentId: string; completedAt: number | null };
const PENDING_BATCH = 4;
const COMPLETED_BATCH = 1;
const RETRY_MS = 60_000;
const TOKEN = /^[\w-]+$/;
type PurgeResult = { ok: boolean; objectsProcessed: number; multipartProcessed: number; transcriptsDeleted: number; errorCode?: string };
const dialect = new SQLiteSyncDialect();
const mediaBatch = (db: Db, statements: SQL[]) => db.$client.batch(statements.map((statement) => {
  const query = dialect.sqlToQuery(statement);
  return db.$client.prepare(query.sql).bind(...query.params);
}));

export class MediaWithdrawn extends ApiError {
  constructor() { super(410, "media_withdrawn", "이 제출물은 더 처리할 수 없어요. 동의를 확인한 뒤 새로 제출해 주세요."); }
}

export async function mediaWritable(db: Db, submissionId: string): Promise<boolean> {
  const rows = await db.all<{ id: string }>(sql`SELECT s.id FROM submissions s JOIN consents c ON c.id = s.consent_id AND c.guide_influencer_id = s.guide_influencer_id
    WHERE s.id = ${submissionId} AND c.withdrawn_at IS NULL AND s.media_purged_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM media_purges p WHERE p.submission_id = s.id)`);
  return rows.length > 0;
}
export async function assertMediaWritable(db: Db, submissionId: string) {
  if (!(await mediaWritable(db, submissionId))) throw new MediaWithdrawn();
}

// R2보다 먼저 남긴다. multipart/null은 create 결과를 아직 모르는 영속 미확인 상태다.
export async function rememberMedia(db: Db, submissionId: string, resource: Resource) {
  if (!validMediaKey(submissionId, resource.key)) throw new Error("invalid_media_key");
  const consentId = await mediaConsent(db, submissionId);
  await mediaBatch(db, [
    rememberQuery(submissionId, consentId, resource),
    sql`INSERT INTO media_purge_objects (id,submission_id,consent_id,key,kind,upload_id)
      SELECT 'original:'||s.id,s.id,${consentId},s.original_key,'object',NULL FROM submissions s WHERE s.id=${submissionId} AND s.original_key IS NOT NULL ON CONFLICT DO NOTHING`,
    sql`INSERT INTO media_purge_objects (id,submission_id,consent_id,key,kind,upload_id)
      SELECT 'multipart:'||s.id,s.id,${consentId},s.original_key,'multipart',s.upload_id FROM submissions s WHERE s.id=${submissionId} AND s.original_key IS NOT NULL AND s.upload_id IS NOT NULL ON CONFLICT DO NOTHING`,
  ]);
}

async function mediaConsent(db: Db, submissionId: string): Promise<string> {
  const rows = await db.all<{ id: string }>(sql`SELECT consent_id AS id FROM submissions WHERE id=${submissionId} AND consent_id IS NOT NULL
    UNION ALL SELECT consent_id FROM media_purge_objects WHERE submission_id=${submissionId} AND consent_id IS NOT NULL
    UNION ALL SELECT consent_id FROM media_purges WHERE submission_id=${submissionId} LIMIT 1`);
  if (!rows[0]) throw new Error("media_consent_unknown");
  return rows[0].id;
}
const rememberQuery = (submissionId: string, consentId: string, resource: Resource) => sql`INSERT INTO media_purge_objects (id,submission_id,consent_id,key,kind,upload_id)
  VALUES (${newId()},${submissionId},${consentId},${resource.key},${resource.kind},${resource.uploadId ?? null})
  ON CONFLICT(submission_id,key,kind) DO UPDATE SET consent_id=coalesce(media_purge_objects.consent_id,excluded.consent_id),upload_id=coalesce(excluded.upload_id,media_purge_objects.upload_id),deleted_at=NULL`;

export async function enqueueMediaPurge(db: Db, submissionId: string) {
  const at = now();
  await db.run(sql`INSERT INTO media_purges (submission_id,consent_id,requested_at,due_at,next_attempt_at)
    SELECT ${submissionId},source.consent_id,${at},${at},0 FROM (
      SELECT consent_id FROM submissions WHERE id=${submissionId} AND consent_id IS NOT NULL
      UNION ALL SELECT consent_id FROM media_purge_objects WHERE submission_id=${submissionId} AND consent_id IS NOT NULL LIMIT 1
    ) source WHERE 1
    ON CONFLICT(submission_id) DO UPDATE SET completed_at = NULL,next_attempt_at = 0,checked_at = 0`);
}

// 동의 철회·제출물 snapshot·정확한 기존 키 원장을 한 트랜잭션으로 예약한다. 새 동의 세대는 포함하지 않는다.
export async function withdrawMedia(db: Db, giId: string, consentId: string, at: number) {
  const scope = sql`s.guide_influencer_id = ${giId} AND s.consent_id = ${consentId}`;
  const result = await mediaBatch(db, [
    sql`UPDATE consents SET withdrawn_at = ${at} WHERE id = ${consentId} AND guide_influencer_id = ${giId} AND withdrawn_at IS NULL`,
    sql`UPDATE guide_influencers SET stage = 'withdrawn' WHERE id = ${giId} AND NOT EXISTS (SELECT 1 FROM consents c WHERE c.guide_influencer_id=${giId} AND c.withdrawn_at IS NULL)`,
    sql`INSERT INTO media_purges (submission_id,consent_id,requested_at,due_at,next_attempt_at)
      SELECT s.id,${consentId},${at},${at},0 FROM submissions s WHERE ${scope} ON CONFLICT(submission_id) DO NOTHING`,
    sql`INSERT INTO media_purge_objects (id,submission_id,consent_id,key,kind,upload_id)
      SELECT 'original:'||s.id,s.id,${consentId},s.original_key,'object',NULL FROM submissions s WHERE ${scope} AND s.original_key IS NOT NULL ON CONFLICT DO NOTHING`,
    sql`INSERT INTO media_purge_objects (id,submission_id,consent_id,key,kind,upload_id)
      SELECT 'multipart:'||s.id,s.id,${consentId},s.original_key,'multipart',s.upload_id FROM submissions s WHERE ${scope} AND s.original_key IS NOT NULL AND s.upload_id IS NOT NULL ON CONFLICT DO NOTHING`,
    sql`INSERT INTO media_purge_objects (id,submission_id,consent_id,key,kind,upload_id)
      SELECT 'frame:'||f.id,s.id,${consentId},f.image_key,'object',NULL FROM frames f JOIN submissions s ON s.id=f.submission_id WHERE ${scope} ON CONFLICT DO NOTHING`,
    sql`INSERT INTO media_purge_objects (id,submission_id,consent_id,key,kind,upload_id)
      SELECT 'audio:'||a.id,s.id,${consentId},a.key,'object',NULL FROM audio_tracks a JOIN submissions s ON s.id=a.submission_id WHERE ${scope} ON CONFLICT DO NOTHING`,
  ]);
  return Number(result[0]?.meta.changes ?? 0) > 0;
}

export function validMediaKey(submissionId: string, key: string): boolean {
  if (!TOKEN.test(submissionId) || /[\\\u0000-\u0020\u007f]/.test(key)) return false;
  if (key === `audio/${submissionId}.wav`) return true;
  const frame = key.match(/^frames\/([\w-]+)\/(\d+)\.jpg$/);
  if (frame) return frame[1] === submissionId;
  const original = key.match(/^originals\/([\w-]+)\/([\w-]+)\/([\w-]+)\.(mp4|mov|webm)$/);
  return original?.[3] === submissionId;
}

async function snapshotResources(env: Env, db: Db, submissionId: string) {
  const resources = new Map<string, Resource>();
  const add = (resource: Resource) => {
    if (!validMediaKey(submissionId, resource.key)) throw new Error("invalid_media_key");
    resources.set(`${resource.kind}:${resource.key}`, resource);
  };
  const rows = await db.all<{ key: string; uploadId: string | null }>(sql`
    SELECT original_key AS key,upload_id AS uploadId FROM submissions WHERE id=${submissionId} AND original_key IS NOT NULL
    UNION ALL SELECT image_key,NULL FROM frames WHERE submission_id=${submissionId}
    UNION ALL SELECT key,NULL FROM audio_tracks WHERE submission_id=${submissionId}`);
  for (const row of rows) {
    add({ key: row.key, kind: "object" });
    if (row.uploadId) add({ key: row.key, kind: "multipart", uploadId: row.uploadId });
  }
  // 원장을 쓴 뒤 중단된 put이나 DB 참조 없이 남은 프레임도 정확한 제출물 prefix 안에서만 찾는다.
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ prefix: `frames/${submissionId}/`, cursor });
    for (const object of page.objects) add({ key: object.key, kind: "object" });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  add({ key: `audio/${submissionId}.wav`, kind: "object" });
  const consentId = await mediaConsent(db, submissionId);
  await mediaBatch(db, [...resources.values()].map((resource) => rememberQuery(submissionId, consentId, resource)));
}
// R2 공식 NoSuchUpload(10024)는 이미 완료·중단된 MPU다: https://developers.cloudflare.com/r2/api/error-codes/
const noSuchUpload = (error: unknown) => error instanceof Error && (/NoSuchUpload|No such upload|\b10024\b/i.test(error.message) || (error as Error & { code?: unknown }).code === 10024);

export async function purgeSubmissionMedia(env: Env, submissionId: string): Promise<PurgeResult> {
  const db = getDb(env.DB);
  const jobs = await db.all<Purge>(sql`SELECT submission_id AS submissionId,consent_id AS consentId,completed_at AS completedAt FROM media_purges WHERE submission_id=${submissionId}`);
  const counts = { objectsProcessed: 0, multipartProcessed: 0, transcriptsDeleted: 0 };
  if (!jobs.length) return { ok: false, ...counts, errorCode: "purge_job_missing" };
  const at = now();
  try {
    if (!TOKEN.test(submissionId)) throw new Error("invalid_submission_id");
    await snapshotResources(env, db, submissionId);
    const objects = await db.all<{ id: string; key: string; kind: string; uploadId: string | null; deletedAt: number | null }>(sql`SELECT id,key,kind,upload_id AS uploadId,deleted_at AS deletedAt FROM media_purge_objects WHERE submission_id=${submissionId}`);
    if (objects.some((object) => !validMediaKey(submissionId, object.key))) throw new Error("invalid_media_key");
    let unknown = false;
    const processed: string[] = [];
    for (const object of objects) {
      if (object.kind === "multipart") {
        if (!object.uploadId && object.deletedAt === null) { unknown = true; continue; }
        if (object.uploadId) await env.FILES.resumeMultipartUpload(object.key, object.uploadId).abort().catch((error: unknown) => { if (!noSuchUpload(error)) throw error; });
        counts.multipartProcessed++;
        processed.push(object.id);
      }
    }
    const blobs = objects.filter((object) => object.kind === "object");
    for (let n = 0; n < blobs.length; n += 1000) {
      const batch = blobs.slice(n, n + 1000);
      await env.FILES.delete(batch.map((object) => object.key));
      counts.objectsProcessed += batch.length; processed.push(...batch.map((object) => object.id));
    }
    await db.run(sql`UPDATE media_purge_objects SET deleted_at=${at} WHERE id IN (SELECT value FROM json_each(${JSON.stringify(processed)}))`);
    if (unknown) throw new Error("multipart_upload_id_unknown");
    // 부분 실패라면 여기까지 오지 않는다. R2 삭제가 확인된 다음에만 참조와 전사·번역을 없앤다.
    const results = await mediaBatch(db, [
      sql`DELETE FROM transcript_segments WHERE submission_id=${submissionId} RETURNING id`,
      sql`DELETE FROM frames WHERE submission_id=${submissionId}`,
      sql`DELETE FROM audio_tracks WHERE submission_id=${submissionId}`,
      sql`DELETE FROM upload_parts WHERE submission_id=${submissionId}`,
      sql`UPDATE submissions SET original_key=NULL,upload_id=NULL,drive_url=NULL,drive_access=NULL,media_purged_at=${at} WHERE id=${submissionId}`,
      sql`UPDATE media_purges SET completed_at=coalesce(completed_at,${at}),checked_at=${at},attempts=attempts+1,last_error=NULL,next_attempt_at=0 WHERE submission_id=${submissionId}`,
    ]);
    counts.transcriptsDeleted = results[0]?.results.length ?? 0;
    return { ok: true, ...counts };
  } catch (error) {
    const reason = error instanceof Error && ["invalid_media_key", "invalid_submission_id", "multipart_upload_id_unknown"].includes(error.message) ? error.message : "media_delete_failed";
    await db.run(sql`UPDATE media_purges SET completed_at=NULL,checked_at=${at},attempts=attempts+1,last_error=${reason},next_attempt_at=${at + RETRY_MS} WHERE submission_id=${submissionId}`);
    return { ok: false, ...counts, errorCode: reason };
  }
}

// 완료 tombstone도 재검사해 완료 직후 끝난 put/complete와 그 직후 Worker 종료까지 복구한다.
export async function runMediaPurges(env: Env) {
  const db = getDb(env.DB);
  const at = now();
  const pending = await db.all<{ submissionId: string }>(sql`SELECT submission_id AS submissionId FROM media_purges WHERE completed_at IS NULL AND due_at<=${at} AND next_attempt_at<=${at} ORDER BY checked_at,submission_id LIMIT ${PENDING_BATCH}`);
  const completed = await db.all<{ submissionId: string }>(sql`SELECT submission_id AS submissionId FROM media_purges WHERE completed_at IS NOT NULL AND due_at<=${at} AND next_attempt_at<=${at} ORDER BY checked_at,submission_id LIMIT ${COMPLETED_BATCH}`);
  const jobs = [...pending, ...completed];
  const summary = { attempted: jobs.length, succeeded: 0, failed: 0, objectsProcessed: 0, multipartProcessed: 0, transcriptsDeleted: 0, pending: 0, overdue: 0, unknownMultipart: 0 };
  for (const job of jobs) {
    try {
      const result = await purgeSubmissionMedia(env, job.submissionId);
      result.ok ? summary.succeeded++ : summary.failed++;
      summary.objectsProcessed += result.objectsProcessed; summary.multipartProcessed += result.multipartProcessed; summary.transcriptsDeleted += result.transcriptsDeleted;
    } catch { summary.failed++; }
  }
  const remaining = await db.all<{ pending: number; overdue: number; unknownMultipart: number }>(sql`SELECT count(*) AS pending,
    coalesce(sum(CASE WHEN due_at<=${at} THEN 1 ELSE 0 END),0) AS overdue,
    coalesce(sum(CASE WHEN last_error='multipart_upload_id_unknown' THEN 1 ELSE 0 END),0) AS unknownMultipart FROM media_purges WHERE completed_at IS NULL`);
  Object.assign(summary, remaining[0]);
  console.log("[media_purge_run]", JSON.stringify(summary));
  await db.run(sql`INSERT INTO events (id,workspace_id,name,props,at) VALUES (${newId()},NULL,'media_purge_run',${JSON.stringify(summary)},${at})`);
  if (summary.failed) throw new Error(`media_purge_failed:${summary.failed}`);
}

// R2 쓰기 intent는 먼저 영속화하고, 철회와 겹친 완료는 즉시 파기를 재예약·보상한다.
export async function withMediaWrite<T>(env: Env, db: Db, submissionId: string, resource: Resource, write: () => Promise<T>, commit: (value: T) => Promise<void>): Promise<T> {
  await assertMediaWritable(db, submissionId);
  await rememberMedia(db, submissionId, resource);
  await assertMediaWritable(db, submissionId);
  try {
    const value = await write();
    await assertMediaWritable(db, submissionId);
    await commit(value);
    await assertMediaWritable(db, submissionId);
    return value;
  } catch (error) {
    if (!(await mediaWritable(db, submissionId))) {
      await enqueueMediaPurge(db, submissionId);
      await purgeSubmissionMedia(env, submissionId);
      throw new MediaWithdrawn();
    }
    throw error;
  }
}
