import { eq, sql } from "drizzle-orm";
import type { Db } from "../db";
import { audioTracks } from "../db/schema";
import { ApiError } from "./errors";
import { newId, now } from "./ids";
import { assertMediaWritable, cleanupRetiredAudio, managedAudioKey, retireAudioWrite, withMediaWrite } from "./media-purge";
import { analysisSqlBatch, audioHash, writableSql } from "../pipeline/analysis";

const WRITE_MS = 15 * 60 * 1000;
const stale = () => new ApiError(409, "audio_write_changed", "음성 전송 상태가 바뀌었어요. 다시 시도해 주세요.");
async function cleanup(env: Env, db: Db, submissionId: string) {
  await cleanupRetiredAudio(env, db, submissionId).catch(() => { console.error("[audio_cleanup_failed]"); });
}

export async function storeAudio(env: Env, db: Db, submissionId: string, bytes: ArrayBuffer, sampleRate: number, durationS: number) {
  const contentHash = await audioHash(bytes), key = `audio/${submissionId}/${contentHash}/${newId()}.wav`;
  try {
    await withMediaWrite(env, db, submissionId, { key, kind: "object" }, async () => {
      const lease = await db.all(sql`UPDATE media_purge_objects SET audio_write_until=${now() + WRITE_MS}
        WHERE submission_id=${submissionId} AND key=${key} AND kind='object' AND retired_at IS NULL AND ${writableSql(submissionId)} RETURNING id`);
      if (!lease.length) { await assertMediaWritable(db, submissionId); throw stale(); }
      return env.FILES.put(key, bytes, { httpMetadata: { contentType: "audio/wav" }, onlyIf: { etagDoesNotMatch: "*" } });
    }, async () => {
      await analysisSqlBatch(env.DB, [sql`SELECT CASE WHEN (${writableSql(submissionId)} AND EXISTS(SELECT 1 FROM media_purge_objects
        WHERE submission_id=${submissionId} AND key=${key} AND kind='object' AND retired_at IS NULL AND audio_write_until>${now()}))
        THEN 1 ELSE json('audio_write_stale') END`,
        db.insert(audioTracks).values({ id: newId(), submissionId, key, sampleRate, durationS, contentHash }).onConflictDoUpdate({ target: audioTracks.submissionId,
          set: { key: sql`CASE WHEN ${audioTracks.contentHash}=${contentHash} AND ${audioTracks.sampleRate}=${sampleRate} AND ${audioTracks.durationS}=${durationS}
            AND substr(${audioTracks.key},1,${`audio/${submissionId}/${contentHash}/`.length})=${`audio/${submissionId}/${contentHash}/`} THEN ${audioTracks.key} ELSE ${key} END`, sampleRate, durationS, contentHash } }),
        sql`UPDATE media_purge_objects SET audio_committed_at=${now()},audio_write_until=NULL WHERE submission_id=${submissionId} AND key=${key}`,
        sql`UPDATE media_purge_objects AS p SET retired_at=coalesce(retired_at,${now()}) WHERE submission_id=${submissionId} AND audio_committed_at IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM audio_tracks a WHERE a.submission_id=p.submission_id AND a.key=p.key)`]);
    });
  } catch (error) {
    // A retirement written before an uncertain DB commit prevents that late
    // commit from selecting an object that compensation is about to delete.
    await retireAudioWrite(db, submissionId, key).catch(() => { console.error("[audio_retirement_failed]"); });
    await cleanup(env, db, submissionId);
    await assertMediaWritable(db, submissionId);
    const selected = await db.select().from(audioTracks).where(eq(audioTracks.submissionId, submissionId)).get();
    // An uncertain duplicate is already fulfilled when the current immutable
    // selection contains the same bytes and metadata; never trust a legacy key.
    if (selected?.contentHash === contentHash && selected.sampleRate === sampleRate && selected.durationS === durationS && managedAudioKey(submissionId, selected.key)) return;
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "audio_write_unavailable", "음성 전송을 확인하지 못했어요. 다시 시도해 주세요.");
  }
  await cleanup(env, db, submissionId);
}
