import { sql } from "drizzle-orm";
import { getDb, type Db } from "../db";
import { newId, now } from "./ids";
import { ApiError } from "./errors";
import { analysisSqlBatch, writableSql } from "../pipeline/analysis";
import { PREPARATION_CAPS, boundedMediaStream, preparationError, validateArtifact, validateManifest,
  type ArtifactName, type PreparationJob, type PreparationManifest, type PreparationPermit, type PreparationSink, type PreparedArtifact } from "./media-preparation-contract";

const DEADLINE_MS = 240_000, CHECK_INTERVAL_MS = 20_000, MAX_CHECKS = 16;
type Job = { id: string; submission_id: string; consent_id: string; source_key: string; source_etag: string; source_bytes: number; generation: number;
  state: string; lease_until: number; video_key: string | null; audio_key: string | null; selected_generation: number | null };
type Source = { id: string; consent_id: string; original_key: string; original_etag: string | null; size_bytes: number | null; generation: number; claim_until: number | null };
type ObjectRow = { name: ArtifactName; key: string; bytes: number; sha256: string; completed_at: number | null; retired_at: number | null };
type Targets = (permit: PreparationPermit, sink: PreparationSink) => Promise<{ permit: PreparationPermit; sink: PreparationSink }>;
const defaultTargets: Targets = async (permit, sink) => (await import("./media-preparation-rpc")).preparationTargets(permit, sink);
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((n) => n.toString(16).padStart(2, "0")).join("");
const canonical = (job: Job) => sql`s.id=${job.submission_id} AND s.consent_id=${job.consent_id} AND s.original_key=${job.source_key} AND s.original_etag=${job.source_etag}`;
const current = (job: Job) => sql`EXISTS(SELECT 1 FROM media_preparations p JOIN submissions s ON s.id=p.submission_id JOIN submission_analysis a ON a.submission_id=s.id
 WHERE p.id=${job.id} AND p.state='preparing' AND p.lease_until>${now()} AND ${canonical(job)} AND a.generation=${job.generation}
 AND (a.claim_token IS NULL OR a.claim_until<=${now()}) AND ${writableSql(job.submission_id)})`;
const selected = (job: Job) => sql`EXISTS(SELECT 1 FROM media_preparations p JOIN submissions s ON s.id=p.submission_id JOIN submission_analysis a ON a.submission_id=s.id
 WHERE p.id=${job.id} AND p.state='selected' AND ${canonical(job)} AND p.selected_generation=a.generation AND ${writableSql(job.submission_id)})`;

async function cancelPreparation(env: Env, jobId: string) {
  const service = env.MEDIA_PREPARATION;
  if (!service?.cancel) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([service.cancel(jobId).catch(() => {}), new Promise<void>((resolve) => { timer = setTimeout(resolve, 250); })]);
  } catch { /* Cancellation is best effort; the durable retirement is authoritative. */ }
  finally { if (timer) clearTimeout(timer); }
}

export function preparedVideoKey(submissionId: string, jobId: string) { return `prepared/${submissionId}/${jobId}/video.mp4`; }
async function retireUnselected(env: Env, db: Db, job: Job) {
  const retired = await analysisSqlBatch(env.DB, [
    sql`UPDATE media_preparations SET state=CASE WHEN state='preparing' THEN 'failed' ELSE state END,error='preparation_unavailable' WHERE id=${job.id} AND state<>'selected'`,
    sql`INSERT INTO media_purge_objects(id,submission_id,consent_id,key,kind,retired_at)
      SELECT o.id,o.submission_id,o.consent_id,o.key,'object',${now()} FROM prepared_media_objects o WHERE o.job_id=${job.id}
      AND NOT EXISTS(SELECT 1 FROM audio_tracks a WHERE a.submission_id=o.submission_id AND a.key=o.key)
      AND NOT EXISTS(SELECT 1 FROM media_preparations p WHERE p.id=${job.id} AND p.state='selected' AND (p.video_key=o.key OR p.audio_key=o.key)) ON CONFLICT DO NOTHING`,
    sql`UPDATE media_purge_objects AS o SET retired_at=coalesce(retired_at,${now()}) WHERE o.submission_id=${job.submission_id}
      AND o.key IN(SELECT key FROM prepared_media_objects WHERE job_id=${job.id})
      AND NOT EXISTS(SELECT 1 FROM audio_tracks a WHERE a.submission_id=o.submission_id AND a.key=o.key)
      AND NOT EXISTS(SELECT 1 FROM media_preparations p WHERE p.id=${job.id} AND p.state='selected' AND (p.video_key=o.key OR p.audio_key=o.key))`,
    sql`UPDATE prepared_media_objects SET retired_at=coalesce(retired_at,${now()}) WHERE job_id=${job.id}
      AND key IN(SELECT key FROM media_purge_objects WHERE submission_id=${job.submission_id} AND retired_at IS NOT NULL)`,
  ]);
  if (retired[0]!.meta.changes) await cancelPreparation(env, job.id);
  // The existing bounded tombstone maintenance also handles uncertain late PUTs.
  const { cleanupRetiredAudio } = await import("./media-purge");
  await cleanupRetiredAudio(env, db, job.submission_id).catch(() => { console.error("[prepared_cleanup_failed]"); });
}

function jobInput(job: Job): PreparationJob { return { jobId: job.id, generation: job.generation, consentId: job.consent_id, sourceEtag: job.source_etag, declaredBytes: job.source_bytes }; }

// Test injection is limited to RPC wrappers and the Workers known-length stream.
// There is no provider URL, bucket capability or permission toggle in the Env.
export function createMediaPreparation(options: { targets?: Targets; fixedLength?: (bytes: number) => { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> } } = {}) {
  const prepare = async (env: Env, submissionId: string): Promise<"original" | "ready" | "yield" | "busy"> => {
    if (!env.MEDIA_PREPARATION) return "original";
    const db = getDb(env.DB), at = now();
    const source = await db.get<Source>(sql`SELECT s.id,s.consent_id,s.original_key,s.original_etag,s.size_bytes,a.generation,a.claim_until
      FROM submissions s JOIN submission_analysis a ON a.submission_id=s.id WHERE s.id=${submissionId} AND s.original_key IS NOT NULL AND ${writableSql(submissionId)}`);
    if (!source) return "original";
    const existing = await db.get<Job>(sql`SELECT * FROM media_preparations WHERE submission_id=${submissionId}
      AND source_key=${source.original_key} AND generation<=${source.generation} ORDER BY created_at DESC,rowid DESC LIMIT 1`);
    if (existing?.state === "selected" && existing.selected_generation === source.generation && existing.source_etag === source.original_etag) {
      const latest = await env.FILES.head(existing.source_key);
      if (!latest || latest.etag !== existing.source_etag || latest.size !== existing.source_bytes) throw preparationError();
      return "ready";
    }
    if (existing?.state === "failed" && existing.generation === source.generation && existing.source_etag === source.original_etag) return "original";
    if ((source.claim_until ?? 0) > at) return "busy";
    const active = await db.get<Job>(sql`SELECT * FROM media_preparations WHERE submission_id=${submissionId} AND state='preparing'`);
    if (active) {
      if (active.lease_until > at) return "busy";
      await retireUnselected(env, db, active); return "original"; // A dead service cannot starve the browser fallback.
    }
    const head = await env.FILES.head(source.original_key);
    if (!head || !head.etag || !Number.isSafeInteger(head.size) || head.size <= 0 || head.size > PREPARATION_CAPS.inputBytes || (source.size_bytes !== null && source.size_bytes !== head.size)) return "original";
    if (source.original_etag && source.original_etag !== head.etag) throw preparationError();
    const id = newId(), job: Job = { id, submission_id: submissionId, consent_id: source.consent_id, source_key: source.original_key, source_etag: head.etag,
      source_bytes: head.size, generation: source.generation, state: "preparing", lease_until: at + DEADLINE_MS, video_key: null, audio_key: null, selected_generation: null };
    const noAnalysis = sql`NOT EXISTS(SELECT 1 FROM submission_analysis WHERE submission_id=${submissionId} AND claim_token IS NOT NULL AND claim_until>${now()})`;
    try {
      await analysisSqlBatch(env.DB, [
        sql`UPDATE submissions SET original_etag=${head.etag} WHERE id=${submissionId} AND original_key=${source.original_key} AND original_etag IS NULL AND ${writableSql(submissionId)} AND ${noAnalysis}`,
        sql`INSERT INTO media_preparations(id,submission_id,consent_id,source_key,source_etag,source_bytes,generation,created_at,lease_until,state)
          SELECT ${id},s.id,s.consent_id,s.original_key,s.original_etag,${head.size},a.generation,${at},${job.lease_until},'preparing'
          FROM submissions s JOIN submission_analysis a ON a.submission_id=s.id WHERE ${canonical(job)} AND a.generation=${job.generation} AND ${noAnalysis} AND ${writableSql(submissionId)}
          AND NOT EXISTS(SELECT 1 FROM media_preparations WHERE submission_id=${submissionId} AND state='preparing')`,
      ]);
      if (!await db.get(sql`SELECT 1 WHERE ${current(job)}`)) return "busy";
    } catch { return "busy"; }

    const input = jobInput(job); let lastCheck: number | null = null, checks = 0, stopped = false, inputComplete = false;
    const check = async (force = false) => {
      if (stopped || now() >= job.lease_until) throw preparationError();
      if (!force && lastCheck !== null && now() - lastCheck < CHECK_INTERVAL_MS) return;
      if (++checks > MAX_CHECKS || !await db.get(sql`SELECT 1 WHERE ${current(job)}`)) throw preparationError();
      lastCheck = now();
    };
    const cheapCheck = async () => { if (stopped || now() >= job.lease_until) throw preparationError(); };
    let retirement: Promise<void> | undefined;
    const retire = () => retirement ??= retireUnselected(env, db, job);
    const permit: PreparationPermit = { assertCurrent: async (received) => {
      if (!received || Object.keys(received).length !== 5 || received.jobId !== input.jobId || received.generation !== input.generation || received.consentId !== input.consentId || received.sourceEtag !== input.sourceEtag || received.declaredBytes !== input.declaredBytes) throw preparationError(); await check();
    } };
    const sink: PreparationSink = {
      stage: async (name, stream, metadata) => {
        validateArtifact(metadata); if (name !== metadata.name) throw preparationError(); await check(true);
        const key = name === "audio.wav" ? `audio/${submissionId}/${metadata.sha256}/${newId()}.wav` : preparedVideoKey(submissionId, id), objectId = `prepared:${newId()}`;
        await analysisSqlBatch(env.DB, [sql`SELECT CASE WHEN ${current(job)} THEN 1 ELSE json('preparation_stale') END`,
          sql`INSERT INTO prepared_media_objects(id,job_id,submission_id,consent_id,name,key,bytes,sha256,created_at,write_until)
            VALUES(${objectId},${id},${submissionId},${job.consent_id},${name},${key},${metadata.bytes},${metadata.sha256},${now()},${job.lease_until})`,
          sql`INSERT INTO media_purge_objects(id,submission_id,consent_id,key,kind,audio_write_until) VALUES(${objectId},${submissionId},${job.consent_id},${key},'object',${job.lease_until})`]);
        let complete = false;
        const counted = boundedMediaStream(stream, metadata.bytes, name === "audio.wav" ? PREPARATION_CAPS.audioBytes : PREPARATION_CAPS.videoBytes, cheapCheck, () => { complete = true; });
        const fixed = options.fixedLength ? options.fixedLength(metadata.bytes) : new FixedLengthStream(metadata.bytes);
        const abort = new AbortController();
        const [stored] = await Promise.all([env.FILES.put(key, fixed.readable, { sha256: metadata.sha256, onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: name === "audio.wav" ? "audio/wav" : "video/mp4" } }), counted.pipeTo(fixed.writable, { signal: abort.signal })]).catch(() => { abort.abort(); throw preparationError(); });
        if (!complete || !stored || stored.size !== metadata.bytes || !stored.checksums.sha256 || hex(stored.checksums.sha256) !== metadata.sha256) throw preparationError();
        await check(true);
        await analysisSqlBatch(env.DB, [sql`SELECT CASE WHEN ${current(job)} AND EXISTS(SELECT 1 FROM media_purge_objects WHERE id=${objectId} AND retired_at IS NULL) THEN 1 ELSE json('preparation_stale') END`,
          sql`UPDATE prepared_media_objects SET completed_at=${now()},stored_etag=${stored.etag} WHERE id=${objectId}`]);
      },
      commit: async (manifest) => {
        validateManifest(manifest, input);
        // A duplicate/lost ACK never mutates an already-selected generation.
        if (await db.get(sql`SELECT 1 WHERE ${selected(job)}`)) return;
        if (!inputComplete) throw preparationError();
        await check(true);
        const latest = await env.FILES.head(job.source_key);
        if (!latest || latest.etag !== job.source_etag || latest.size !== job.source_bytes) throw preparationError();
        const objects = await db.all<ObjectRow>(sql`SELECT name,key,bytes,sha256,completed_at,retired_at FROM prepared_media_objects WHERE job_id=${id}`);
        if (objects.length !== manifest.artifacts.length) throw preparationError();
        for (const item of manifest.artifacts) { const object = objects.find((o) => o.name === item.name); if (!object || !object.completed_at || object.retired_at || object.bytes !== item.bytes || object.sha256 !== item.sha256) throw preparationError(); }
        const video = objects.find((o) => o.name === "video.mp4")!, audio = objects.find((o) => o.name === "audio.wav");
        const expected = JSON.stringify(objects.map(({ name, key, bytes, sha256 }) => ({ name, key, bytes, sha256 })));
        await analysisSqlBatch(env.DB, [sql`SELECT CASE WHEN ${current(job)} AND (SELECT count(*) FROM prepared_media_objects WHERE job_id=${id})=${manifest.artifacts.length}
          AND NOT EXISTS(SELECT 1 FROM json_each(${expected}) e WHERE NOT EXISTS(SELECT 1 FROM prepared_media_objects o WHERE o.job_id=${id}
            AND o.name=json_extract(e.value,'$.name') AND o.key=json_extract(e.value,'$.key') AND o.bytes=json_extract(e.value,'$.bytes') AND o.sha256=json_extract(e.value,'$.sha256')))
          AND NOT EXISTS(SELECT 1 FROM prepared_media_objects o WHERE o.job_id=${id} AND (o.completed_at IS NULL OR o.retired_at IS NOT NULL
            OR NOT EXISTS(SELECT 1 FROM media_purge_objects p WHERE p.id=o.id AND p.key=o.key AND p.submission_id=o.submission_id AND p.kind='object'
              AND p.consent_id=${job.consent_id} AND p.retired_at IS NULL AND p.audio_write_until>${now()}))) THEN 1 ELSE json('preparation_stale') END`,
          sql`UPDATE media_preparations SET state='retired' WHERE submission_id=${submissionId} AND state='selected'`,
          ...(audio && manifest.audio.state === "present" ? [sql`INSERT INTO audio_tracks(id,submission_id,key,sample_rate,duration_s,content_hash)
            VALUES(${newId()},${submissionId},${audio.key},16000,${manifest.audio.durationS},${audio.sha256}) ON CONFLICT(submission_id) DO UPDATE SET key=excluded.key,sample_rate=excluded.sample_rate,duration_s=excluded.duration_s,content_hash=excluded.content_hash`]
            : [sql`DELETE FROM audio_tracks WHERE submission_id=${submissionId}`, sql`UPDATE submission_analysis SET audio_state='none',audio_reason='server_prepared_no_audio',generation=generation+1,claim_token=NULL,claim_until=NULL WHERE submission_id=${submissionId}`]),
          sql`UPDATE media_preparations SET state='selected',selected_generation=(SELECT generation FROM submission_analysis WHERE submission_id=${submissionId}),video_key=${video.key},audio_key=${audio?.key ?? null},audio_state=${manifest.audio.state},duration_s=${manifest.durationS},input_sha256=${manifest.inputSha256},error=NULL WHERE id=${id}`,
          sql`UPDATE media_purge_objects SET audio_committed_at=${now()},audio_write_until=NULL WHERE key IN(SELECT key FROM prepared_media_objects WHERE job_id=${id}) AND submission_id=${submissionId}`,
          sql`UPDATE media_purge_objects AS o SET retired_at=coalesce(retired_at,${now()}) WHERE o.submission_id=${submissionId}
            AND (o.key IN(SELECT key FROM prepared_media_objects) OR (o.audio_committed_at IS NOT NULL AND o.key LIKE ${`audio/${submissionId}/%`}))
            AND NOT EXISTS(SELECT 1 FROM audio_tracks a WHERE a.key=o.key AND a.submission_id=o.submission_id)
            AND NOT EXISTS(SELECT 1 FROM media_preparations p WHERE p.submission_id=o.submission_id AND p.state='selected' AND p.video_key=o.key)`,
        ]);
      },
      retireUnselected: retire,
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sourceStream: ReadableStream<Uint8Array> | undefined;
    try {
      const original = await env.FILES.get(job.source_key, { onlyIf: { etagMatches: job.source_etag } });
      if (!original || !("body" in original) || !original.body || original.etag !== job.source_etag || original.size !== job.source_bytes) throw preparationError();
      sourceStream = boundedMediaStream(original.body, job.source_bytes, PREPARATION_CAPS.inputBytes, cheapCheck, () => { inputComplete = true; });
      const targets = await (options.targets ?? defaultTargets)(permit, sink);
      await Promise.race([env.MEDIA_PREPARATION.prepare(input, sourceStream, targets.permit, targets.sink), new Promise<never>((_, reject) => { timer = setTimeout(() => { stopped = true; reject(preparationError()); }, Math.max(1, job.lease_until - now())); })]);
      if (!await db.get(sql`SELECT 1 WHERE ${selected(job)}`)) throw preparationError();
    } catch {
      // The service may report failure after a successful app commit.
      if (!await db.get(sql`SELECT 1 WHERE ${selected(job)}`)) await retire();
    } finally { if (timer) clearTimeout(timer); stopped = true; await sourceStream?.cancel().catch(() => {}); }
    return "yield"; // Fresh Queue invocation/analysis claim; never reuse the old generation.
  };
  return async (env: Env, submissionId: string) => { try { return await prepare(env, submissionId); } catch { throw preparationError(); } };
}
export const prepareSubmissionMedia = createMediaPreparation();

export async function currentPreparedVideo(env: Env, db: Db, submissionId: string): Promise<string | null> {
  if (!env.MEDIA_PREPARATION) return null;
  const job = await db.get<Job>(sql`SELECT p.* FROM media_preparations p JOIN submissions s ON s.id=p.submission_id JOIN submission_analysis a ON a.submission_id=s.id
    WHERE s.id=${submissionId} AND p.state='selected' AND p.consent_id=s.consent_id AND p.source_key=s.original_key AND p.source_etag=s.original_etag AND p.selected_generation=a.generation AND ${writableSql(submissionId)}`);
  if (!job?.video_key || job.video_key !== preparedVideoKey(submissionId, job.id)) return null;
  const source = await env.FILES.head(job.source_key);
  return source?.etag === job.source_etag && source.size === job.source_bytes ? job.video_key : null;
}

export async function completePreparedFrames(env: Env, db: Db, submissionId: string, count: number | null, legacyAudio = false) {
  if (!env.MEDIA_PREPARATION) return null;
  if (count !== null && (!Number.isInteger(count) || count < 1 || count > 180)) throw preparationError();
  const job = await db.get<Job>(sql`SELECT p.* FROM media_preparations p JOIN submissions s ON s.id=p.submission_id JOIN submission_analysis a ON a.submission_id=s.id
    WHERE s.id=${submissionId} AND p.state='selected' AND p.consent_id=s.consent_id AND p.source_key=s.original_key AND p.source_etag=s.original_etag AND p.selected_generation=a.generation AND ${writableSql(submissionId)}`);
  if (!job) return null;
  if (count === null) {
    // Older clients completed their frame-upload phase before their audio POST.
    // This compatibility fence is deliberately not evidence of full extraction.
    const observed = legacyAudio ? await db.get<{ n: number }>(sql`SELECT count(*) AS n FROM frames WHERE submission_id=${submissionId}`) : null;
    if (!observed?.n) return { generation: job.selected_generation!, retryDetect: false };
    count = observed.n;
  }
  try {
    await analysisSqlBatch(env.DB, [sql`SELECT CASE WHEN ${selected(job)} AND (SELECT count(*) FROM frames WHERE submission_id=${submissionId})=${count} THEN 1 ELSE json('frames_not_ready') END`,
      sql`UPDATE submission_analysis SET frames_complete=1 WHERE submission_id=${submissionId} AND frames_complete=0 RETURNING generation,completed_generation`]);
  } catch { throw new ApiError(409, "analysis_not_ready", "프레임 전송을 먼저 완료해 주세요."); }
  // Stable explicit retry survives "receipt before the old claim's skip commit"
  // and an uncertain Queue ACK. Existing analysis retry receipts dedupe it.
  return { generation: job.selected_generation!, retryDetect: true };
}
