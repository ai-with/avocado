import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { getDb } from "../db";
import { countD1Calls, createSqliteD1, type TestSqlite } from "../test/sqlite-d1";
import { ApiError, errorBody } from "../lib/errors";
import { mediaRoutes } from "../routes/public-guide/media";
import { reviewListRoutes } from "../routes/reviews/list";
import { processSubmission } from "./run";
import { NO_AUDIO_PROOF } from "../../shared/audio-analysis";
import { cleanupRetiredAudio, managedAudioKey, runMediaPurges, validMediaKey, withdrawMedia } from "../lib/media-purge";

const NOW = 1_800_000_000_000, databases: TestSqlite[] = [];
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW); vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No real HTTP/mail/AI"); }));
});
afterEach(() => { databases.splice(0).forEach((db) => db.close()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function setup() {
  const { db, d1: native } = await createSqliteD1(); databases.push(db);
  let beforeBatch: ((sql: string[]) => Promise<void>) | undefined, beforeStatement: (() => Promise<void>) | undefined, maxBindings = 0, loseAudioCommit = false;
  const statements = new WeakMap<object, string>();
  const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const proxy = new Proxy(statement, { get(target, key) {
      if (key === "bind") return (...params: unknown[]) => { maxBindings = Math.max(maxBindings, params.length); if (params.length > 100) throw new Error("D1 binding limit"); return wrap(target.bind(...params), sql); };
      if (["all", "run", "raw"].includes(String(key))) return async (...params: unknown[]) => {
        if (/^UPDATE submission_analysis SET/i.test(sql) && beforeStatement) { const callback = beforeStatement; beforeStatement = undefined; await callback(); }
        return Reflect.get(target, key).apply(target, params);
      };
      return Reflect.get(target, key);
    } });
    statements.set(proxy, sql); return proxy;
  };
  const d1 = { ...native, prepare: (sql: string) => wrap(native.prepare(sql), sql), batch: async (items: D1PreparedStatement[]) => {
    if (beforeStatement && items.some((item) => /^UPDATE submission_analysis SET/i.test(statements.get(item) ?? ""))) { const callback = beforeStatement; beforeStatement = undefined; await callback(); }
    if (beforeBatch) { const callback = beforeBatch; beforeBatch = undefined; await callback(items.map((item) => statements.get(item) ?? "")); }
    const result = await native.batch(items);
    if (loseAudioCommit && items.some((item) => /insert into "audio_tracks"/i.test(statements.get(item) ?? ""))) { loseAudioCommit = false; throw new Error("synthetic commit response lost"); }
    return result;
  } } as D1Database;
  db.exec("INSERT INTO workspaces(id,name,created_at) VALUES('w','Synthetic',1); INSERT INTO guides(id,workspace_id,name,slug,status,extra_rules,product,deliverables,secondary_use_scope,created_at,updated_at) VALUES('g','w','Guide','slug','published','[]','{}','{}','{}',1,1); INSERT INTO influencers(id,workspace_id,display_name,created_at) VALUES('i','w','Synthetic',1)");
  db.prepare("INSERT INTO guide_influencers(id,guide_id,influencer_id,guide_token,upload_token,feedback_token,connect_token,token_expires_at,created_at) VALUES('gi','g','i','guide','upload','feedback','connect',?,1)").run(NOW + 100_000);
  db.exec("INSERT INTO consents(id,guide_influencer_id,doc_version,items,secondary_use_scope,name,email,country,age_confirmed,agreed_at) VALUES('c','gi','v1','{}','{}','Synthetic','synthetic@example.com','KR',1,1)");
  db.prepare("INSERT INTO submissions(id,guide_influencer_id,consent_id,version,kind,status,original_key,size_bytes,created_at,uploaded_at) VALUES('s','gi','c',1,'final','uploaded','originals/g/gi/s.mp4',4,?,?)").run(NOW - 100, NOW - 100);
  const objects = new Map<string, ArrayBuffer>(), calls = countD1Calls(d1);
  const env = { DB: calls.d1, FILES: { put: vi.fn(async (key: string, bytes: ArrayBuffer) => { objects.set(key, bytes); return {}; }),
    get: vi.fn(async (key: string) => objects.has(key) ? { arrayBuffer: async () => objects.get(key)! } : null),
    delete: vi.fn(async (keys: string | string[]) => { for (const key of typeof keys === "string" ? [keys] : keys) objects.delete(key); }),
    list: vi.fn(async ({ prefix }: { prefix: string }) => ({ objects: [...objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })), truncated: false })) },
    PIPELINE: { send: vi.fn(async () => {}) }, APP_URL: "https://app.test", AI: { run: vi.fn() } } as unknown as Env;
  const app = new Hono<AppEnv>(); app.use("*", async (c, next) => { c.set("db", getDb(c.env.DB)); c.set("auth", c.req.path.startsWith("/api/reviews/")
    ? { sessionId: "read-session", user: { id: "reader", email: "reader@example.com", name: "Reader" }, workspace: { id: "w", name: "Synthetic", plan: "starter", onboardedAt: 1, onboardingSkippedAt: null }, role: "owner", phone: null, phoneVerified: true } : null); await next(); });
  app.route("/api/public", mediaRoutes); app.route("/api/reviews", reviewListRoutes);
  app.onError((error, c) => error instanceof ApiError ? c.json(errorBody(error.code, error.message), error.status) : c.text("internal", 500));
  const complete = (outcome: unknown = { kind: "no_audio", proof: NO_AUDIO_PROOF }, frameCount = 1) => app.request("/api/public/upload/upload/analysis-complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ submissionId: "s", frameCount, outcome }) }, env);
  const audio = (bytes = "audio") => { const body = new FormData(); body.set("submissionId", "s"); body.set("sampleRate", "16000"); body.set("durationS", "1"); body.set("audio", new Blob([bytes], { type: "audio/wav" }), "audio.wav"); return app.request("/api/public/upload/upload/audio", { method: "POST", body }, env); };
  const frame = () => db.exec("INSERT INTO frames(id,submission_id,t_ms,image_key,source) VALUES('f','s',0,'frames/s/0.jpg','fps')");
  const state = () => db.prepare("SELECT * FROM submission_analysis WHERE submission_id='s'").all()[0]!;
  const jobs = () => db.prepare("SELECT stage,status,error FROM processing_jobs WHERE submission_id='s' ORDER BY stage").all();
  const full = () => processSubmission({ submissionId: "s" }, env);
  return { db, env, frame, complete, audio, state, jobs, full, calls, objects, loseAudioCommit: () => { loseAudioCommit = true; }, review: () => app.request("/api/reviews/s", {}, env), maxBindings: () => maxBindings, before: (hook: (sql: string[]) => Promise<void>) => { beforeBatch = hook; }, beforeReceipt: (hook: () => Promise<void>) => { beforeStatement = hook; } };
}

describe("hash/write-ID audio 객체 보상과 파기", () => {
  it("unknown PUT의 늦은 객체를 tombstone으로 다시 지우며 같은 WAV는 새 write ID로 재시도한다", async () => {
    const { db, env, audio, objects, state } = await setup(); let late!: { key: string; bytes: ArrayBuffer };
    vi.mocked(env.FILES.put).mockImplementationOnce(async (key, value) => { late = { key: String(key), bytes: value as ArrayBuffer }; throw new Error("unknown PUT outcome"); });
    expect((await audio("same after unknown")).status).toBe(503); expect(state().generation).toBe(0);
    expect(db.prepare("SELECT retired_at FROM media_purge_objects WHERE key=?").all(late.key)[0]!.retired_at).not.toBeNull();
    objects.set(late.key, late.bytes); await runMediaPurges(env); expect(objects.has(late.key)).toBe(false);
    expect((await audio("same after unknown")).status).toBe(201); const current = String(db.prepare("SELECT key FROM audio_tracks").all()[0]!.key);
    expect(current).not.toBe(late.key); expect(objects.has(current)).toBe(true); expect(state().generation).toBe(1);
  });
  it("만료된 in-flight PUT을 먼저 retire하면 늦은 DB commit이 선택할 수 없다", async () => {
    const { db, env, audio, objects, state } = await setup(); let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; }), gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(env.FILES.put).mockImplementationOnce(async (key, value) => { entered(); await gate; objects.set(String(key), value as ArrayBuffer); return {} as never; });
    const pending = audio("late PUT"); await waiting; vi.mocked(Date.now).mockReturnValue(NOW + 15 * 60_000 + 1);
    await cleanupRetiredAudio(env, getDb(env.DB)); release(); expect((await pending).status).toBe(503);
    expect(db.prepare("SELECT * FROM audio_tracks").all()).toEqual([]); expect(objects.size).toBe(0); expect(state().generation).toBe(0);
  });
  it("교체 객체 삭제 실패는 원장에 남기고 기존 정리 Queue가 현재 선택을 보존해 복구한다", async () => {
    const { db, env, audio, objects } = await setup(); await audio("first"); const previous = String(db.prepare("SELECT key FROM audio_tracks").all()[0]!.key);
    vi.mocked(env.FILES.delete).mockRejectedValueOnce(new Error("temporary delete failure"));
    expect((await audio("second")).status).toBe(201); const current = String(db.prepare("SELECT key FROM audio_tracks").all()[0]!.key);
    expect(objects.has(previous)).toBe(true); expect(objects.has(current)).toBe(true);
    vi.mocked(env.FILES.delete).mockRejectedValueOnce(new Error("maintenance delete failure"));
    await expect(runMediaPurges(env)).rejects.toThrow("media_purge_failed:1"); expect(objects.has(current)).toBe(true); await runMediaPurges(env);
    expect(objects.has(previous)).toBe(false); expect(objects.has(current)).toBe(true);
    expect(db.prepare("SELECT retired_at,deleted_at FROM media_purge_objects WHERE key=?").all(previous)[0]).toMatchObject({ retired_at: NOW, deleted_at: NOW });
  });
  it("commit 응답 소실은 현재 선택을 지우지 않고 같은 WAV 재전송도 세대를 늘리지 않는다", async () => {
    const { db, env, audio, objects, state, loseAudioCommit } = await setup(); loseAudioCommit();
    expect((await audio("committed unknown")).status).toBe(201); const selected = String(db.prepare("SELECT key FROM audio_tracks").all()[0]!.key);
    expect(objects.has(selected)).toBe(true); expect(state().generation).toBe(1); loseAudioCommit(); expect((await audio("committed unknown")).status).toBe(201);
    expect(state().generation).toBe(1); expect(db.prepare("SELECT key FROM audio_tracks").all()[0]!.key).toBe(selected); expect(objects.size).toBe(1); expect(env.FILES.delete).not.toHaveBeenCalledWith(expect.arrayContaining([selected]));
  });
  it("DB commit 전 실패는 이전 선택을 보존하고 새 orphan 객체만 보상 삭제한다", async () => {
    const { db, env, audio, objects, state } = await setup(); await audio("previous"); const previous = String(db.prepare("SELECT key FROM audio_tracks").all()[0]!.key);
    db.exec("CREATE TRIGGER fail_audio_commit BEFORE UPDATE OF audio_committed_at ON media_purge_objects WHEN OLD.audio_committed_at IS NULL AND NEW.audio_committed_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'synthetic mid-commit rollback'); END");
    expect((await audio("failed replacement")).status).toBe(503); expect(db.prepare("SELECT key FROM audio_tracks").all()[0]!.key).toBe(previous);
    expect(env.FILES.put).toHaveBeenCalledTimes(2); expect([...objects.keys()]).toEqual([previous]); expect(state().generation).toBe(1);
    expect(new TextDecoder().decode(objects.get(previous))).toBe("previous");
  });
  it("구객체 삭제가 늦어도 같은 hash의 새 write ID를 선택한 객체는 지우지 않는다", async () => {
    const { db, env, audio, objects } = await setup(); await audio("one"); const previous = String(db.prepare("SELECT key FROM audio_tracks").all()[0]!.key);
    let release!: () => void, entered!: () => void, held = false;
    const waiting = new Promise<void>((resolve) => { entered = resolve; }), gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(env.FILES.delete).mockImplementation(async (keys) => { const list = typeof keys === "string" ? [keys] : [...keys]; if (list.includes(previous) && !held) { held = true; entered(); await gate; } list.forEach((key) => objects.delete(key)); });
    const replacing = audio("two"); await waiting; expect((await audio("one")).status).toBe(201);
    const current = String(db.prepare("SELECT key FROM audio_tracks").all()[0]!.key); expect(current).not.toBe(previous);
    release(); expect((await replacing).status).toBe(201); expect(objects.has(current)).toBe(true); expect(new TextDecoder().decode(objects.get(current))).toBe("one");
  });
  it("hashed PUT 도중 철회와 이후 orphan 재등장도 정확한 제출물 prefix에서 파기한다", async () => {
    const { db, env, audio, objects } = await setup(); let key = "";
    vi.mocked(env.FILES.put).mockImplementationOnce(async (target, value) => { key = String(target); objects.set(key, value as ArrayBuffer); await withdrawMedia(getDb(env.DB), "gi", "c", NOW); await runMediaPurges(env); return {} as never; });
    expect((await audio("withdrawn audio")).status).toBe(410); expect(objects.has(key)).toBe(false); expect(db.prepare("SELECT * FROM audio_tracks").all()).toEqual([]);
    const orphan = `audio/s/${"a".repeat(64)}/${crypto.randomUUID()}.wav`, other = `audio/other/${"a".repeat(64)}/${crypto.randomUUID()}.wav`;
    objects.set(key, new ArrayBuffer(4)); objects.set(orphan, new ArrayBuffer(4)); objects.set(other, new ArrayBuffer(4)); await runMediaPurges(env);
    expect(objects.has(key)).toBe(false); expect(objects.has(orphan)).toBe(false); expect(objects.has(other)).toBe(true);
    expect(managedAudioKey("s", key)).toBe(true); expect(validMediaKey("s", "audio/s.wav")).toBe(true);
    expect(validMediaKey("s", other)).toBe(false); expect(validMediaKey("s", `audio/s/${"a".repeat(64)}/../x.wav`)).toBe(false);
  });
  it("부모 제출물 삭제도 선택됐던 hashed audio를 원장에 retire해 고아 객체로 남기지 않는다", async () => {
    const { db, env, audio, objects } = await setup(); await audio("parent removed"); const key = String(db.prepare("SELECT key FROM audio_tracks").all()[0]!.key);
    db.exec("DELETE FROM submissions WHERE id='s'"); expect(db.prepare("SELECT * FROM audio_tracks").all()).toEqual([]);
    await runMediaPurges(env); expect(objects.has(key)).toBe(false);
  });
});

describe("no-audio receipt와 준비 대기", () => {
  it("정상 프레임 후에만 receipt를 받고 3분 전 즉시 STT/번역 AI 없이 처리한다", async () => {
    const { env, frame, complete, state, jobs, full, db } = await setup();
    expect((await complete()).status).toBe(409); expect(state().audio_state).toBe("unknown");
    frame(); expect((await complete()).status).toBe(200); expect(state()).toMatchObject({ audio_state: "none", frames_complete: 1, generation: 1 });
    await full(); expect(jobs()).toContainEqual({ stage: "transcribe", status: "skipped", error: "no_audio_track" });
    expect(jobs()).toContainEqual({ stage: "translate", status: "skipped", error: "no_transcript" });
    expect(state()).toMatchObject({ completed_generation: 1, claim_token: null }); expect(db.prepare("SELECT status FROM submissions WHERE id='s'").all()[0]!.status).toBe("ready");
    expect(env.AI.run).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    const events = db.prepare("SELECT count(*) n FROM events").all()[0]!.n; await full();
    expect(db.prepare("SELECT count(*) n FROM events").all()[0]!.n).toBe(events);
  });
  it("unavailable은 조기 wake를 하지 않고 기존3분 대기 뒤 확인불가로만 끝난다", async () => {
    const { frame, complete, env, state, full, jobs } = await setup(); frame();
    expect((await complete({ kind: "unavailable", reason: "decode_limit" })).status).toBe(200);
    expect(env.PIPELINE.send).not.toHaveBeenCalled(); expect(state()).toMatchObject({ audio_state: "unknown", audio_reason: "decode_limit", generation: 0 });
    await full(); expect(jobs()).toEqual([]); expect(env.PIPELINE.send).toHaveBeenLastCalledWith(expect.anything(), { delaySeconds: 20 });
    vi.mocked(Date.now).mockReturnValue(NOW + 180_001); await full();
    expect(jobs()).toContainEqual({ stage: "transcribe", status: "skipped", error: "audio_unavailable" }); expect(env.AI.run).not.toHaveBeenCalled();
  });
  it("동시 receipt/응답소실·Queue실패 재시도는 세대를 한번만 회전한다", async () => {
    const { frame, complete, state, env } = await setup(); frame();
    vi.mocked(env.PIPELINE.send).mockRejectedValueOnce(new Error("unknown queue outcome"));
    expect((await complete()).status).toBe(503); expect(state().generation).toBe(1);
    const results = await Promise.all([complete(), complete()]); expect(results.map((r) => r.status)).toEqual([200, 200]); expect(state().generation).toBe(1);
  });
  it("중간SQL실패는 receipt를 일부 저장하지 않으며 재시도할 수 있다", async () => {
    const { db, frame, complete, state } = await setup(); frame();
    db.exec("CREATE TRIGGER fail_receipt BEFORE UPDATE ON submission_analysis WHEN NEW.audio_state='none' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    expect((await complete()).status).toBe(503); expect(state()).toMatchObject({ audio_state: "unknown", generation: 0, frames_complete: 0 });
    db.exec("DROP TRIGGER fail_receipt"); expect((await complete()).status).toBe(200); expect(state().generation).toBe(1);
  });
  it("위조 proof/프레임 불일치/동의철회는 상태와 wake를 바꾸지 않는다", async () => {
    const { db, env, frame, complete, state } = await setup(); frame();
    expect((await complete({ kind: "no_audio", proof: "decode-error" })).status).toBe(400); expect((await complete(undefined, 2)).status).toBe(409);
    db.exec(`UPDATE consents SET withdrawn_at=${NOW} WHERE id='c'`); expect((await complete()).status).toBe(403);
    expect(state().audio_state).toBe("unknown"); expect(env.PIPELINE.send).not.toHaveBeenCalled();
    expect(() => db.exec("UPDATE submission_analysis SET audio_state='none' WHERE submission_id='s'")).toThrow();
  });
  it("lookup 뒤 동의철회와 receipt UPDATE가 경합해도 원자 privacy fence가 막는다", async () => {
    const { db, frame, complete, state, beforeReceipt, env } = await setup(); frame();
    beforeReceipt(async () => { db.exec(`UPDATE consents SET withdrawn_at=${NOW} WHERE id='c'`); });
    expect((await complete()).status).toBe(410); expect(state()).toMatchObject({ audio_state: "unknown", generation: 0 }); expect(env.PIPELINE.send).not.toHaveBeenCalled();
  });
  it("이미 완료한 작업 뒤의 철회와 legacy 미확보를 실제 검수 DTO에서 구분한다", async () => {
    const { db, frame, complete, full, review } = await setup(); frame(); await complete(); await full();
    db.exec(`UPDATE consents SET withdrawn_at=${NOW} WHERE id='c'`);
    const withdrawn = await review(); expect(withdrawn.status).toBe(200); expect(await withdrawn.json()).toMatchObject({ mediaState: "withdrawn", segments: [], frames: [] });
    db.exec("UPDATE submissions SET consent_id=NULL WHERE id='s'");
    expect(await (await review()).json()).toMatchObject({ mediaState: "unavailable", segments: [], frames: [] });
  });
});

describe("실제 오디오 우선과 pipeline 세대/claim fence", () => {
  it("새 request의 seen marker와 terminal reset은 중간 실패 때 함께 rollback된다", async () => {
    const { db, env, audio } = await setup(); await audio(); env.AI_FAKE = "1";
    const payload = { submissionId: "s", stages: ["transcribe", "translate", "detect"], requestId: "existing-B" };
    await processSubmission(payload, env); const segments = db.prepare("SELECT id,text FROM transcript_segments").all();
    db.exec("CREATE TRIGGER fail_reset BEFORE UPDATE ON processing_jobs WHEN NEW.stage_request_id='new-C' BEGIN SELECT RAISE(ABORT,'synthetic reset rollback'); END");
    await expect(processSubmission({ ...payload, requestId: "new-C" }, env)).rejects.toThrow("analysis_write_failed");
    expect(db.prepare("SELECT * FROM submission_analysis_retries WHERE request_id='new-C'").all()).toEqual([]);
    expect(db.prepare("SELECT id,text FROM transcript_segments").all()).toEqual(segments);
    expect(db.prepare("SELECT DISTINCT status,stage_request_id FROM processing_jobs").all()).toEqual([{ status: "done", stage_request_id: "existing-B" }]);
    db.exec("DROP TRIGGER fail_reset"); await processSubmission({ ...payload, requestId: "new-C" }, env);
    expect(db.prepare("SELECT id,text FROM transcript_segments").all()).not.toEqual(segments);
    expect(db.prepare("SELECT completed_at FROM submission_analysis_retries WHERE request_id='new-C'").all()[0]!.completed_at).not.toBeNull();
  });
  it("기존 explicit request의 lease 회복은 done STT를 보존하고 running/queued만 실행한다", async () => {
    const { db, env, audio, state } = await setup(); await audio(); env.AI_FAKE = "1";
    db.prepare("INSERT INTO submission_analysis_retries(submission_id,request_id,generation,seen_at,first_claim_token) VALUES('s','resume-A',1,?,'abandoned')").run(NOW);
    db.prepare("UPDATE submission_analysis SET claim_token='abandoned',claim_until=? WHERE submission_id='s'").run(NOW + 1000);
    for (const [stage, status] of [["transcribe", "done"], ["translate", "running"], ["detect", "queued"]]) db.prepare("INSERT INTO processing_jobs(id,submission_id,stage,status,analysis_generation,stage_request_id) VALUES(?,'s',?,?,1,'resume-A')").run(stage!, stage!, status!);
    db.exec("INSERT INTO transcript_segments(id,submission_id,start_ms,end_ms,lang,text) VALUES('preserved','s',0,1000,'en','Existing sentence.')");
    const payload = { submissionId: "s", stages: ["transcribe", "translate", "detect"], requestId: "resume-A" };
    await processSubmission(payload, env); expect(state().claim_token).toBe("abandoned");
    vi.mocked(Date.now).mockReturnValue(NOW + 1001); await processSubmission(payload, env);
    expect(db.prepare("SELECT id FROM transcript_segments").all()).toEqual([{ id: "preserved" }]); expect(env.FILES.get).not.toHaveBeenCalled();
    expect(db.prepare("SELECT DISTINCT status FROM processing_jobs").all()).toEqual([{ status: "done" }]); expect(state().claim_token).toBeNull();
    expect(db.prepare("SELECT count(*) n FROM events WHERE name='processing_job_completed'").all()[0]!.n).toBe(2);
  });
  it("같은 explicit request의 finish rollback 재전달은 done 세 단계를 보존한다", async () => {
    const { db, env, audio, before } = await setup(); await audio(); env.AI_FAKE = "1";
    const payload = { submissionId: "s", stages: ["transcribe", "translate", "detect"], requestId: "explicit-A" };
    const hook = async (queries: string[]) => { if (queries.some((query) => /completed_generation=CASE/.test(query))) throw new Error("synthetic finish failure"); else before(hook); };
    before(hook); await expect(processSubmission(payload, env)).rejects.toThrow("analysis_write_failed");
    const segments = db.prepare("SELECT id,text FROM transcript_segments").all(), reads = vi.mocked(env.FILES.get).mock.calls.length;
    const events = db.prepare("SELECT count(*) n FROM events WHERE name='processing_job_completed'").all()[0]!.n;
    await processSubmission(payload, env);
    expect(db.prepare("SELECT id,text FROM transcript_segments").all()).toEqual(segments); expect(vi.mocked(env.FILES.get).mock.calls.length).toBe(reads);
    expect(db.prepare("SELECT count(*) n FROM events WHERE name='processing_job_completed'").all()[0]!.n).toBe(events);
  });
  it("old explicit A finish실패→새B완료→A재전달 ABA는 B의 terminal을 reset하지 않는다", async () => {
    const { db, env, audio, before, state } = await setup(); await audio(); env.AI_FAKE = "1";
    const payload = { submissionId: "s", stages: ["transcribe", "translate", "detect"], requestId: "explicit-A" };
    const hook = async (queries: string[]) => { if (queries.some((query) => /completed_generation=CASE/.test(query))) throw new Error("synthetic finish failure"); else before(hook); };
    before(hook); await expect(processSubmission(payload, env)).rejects.toThrow("analysis_write_failed");
    await processSubmission({ ...payload, requestId: "explicit-B" }, env);
    const segments = db.prepare("SELECT id,text FROM transcript_segments").all(), reads = vi.mocked(env.FILES.get).mock.calls.length;
    const events = db.prepare("SELECT count(*) n FROM events WHERE name='processing_job_completed'").all()[0]!.n;
    await processSubmission(payload, env);
    expect(db.prepare("SELECT id,text FROM transcript_segments").all()).toEqual(segments); expect(vi.mocked(env.FILES.get).mock.calls.length).toBe(reads);
    expect(db.prepare("SELECT count(*) n FROM events WHERE name='processing_job_completed'").all()[0]!.n).toBe(events);
    expect(db.prepare("SELECT DISTINCT stage_request_id FROM processing_jobs").all()).toEqual([{ stage_request_id: "explicit-B" }]);
    expect(state().completed_request_id).toBe("explicit-B");
  });
  it("동시 WAV의 PUT 응답과 DB commit 순서가 달라도 선택 객체와 hash가 일치한다", async () => {
    const { db, env, audio, objects } = await setup(); let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; }), gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(env.FILES.put).mockImplementation(async (key, value) => { const bytes = value as ArrayBuffer; objects.set(String(key), bytes); if (new TextDecoder().decode(bytes) === "older") { entered(); await gate; } return {} as never; });
    const old = audio("older"); await waiting; const recent = await audio("newer"); release(); const previous = await old;
    expect([previous.status, recent.status]).toEqual([201, 201]);
    const row = db.prepare("SELECT key,content_hash FROM audio_tracks WHERE submission_id='s'").all()[0]!;
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", objects.get(String(row.key))!))].map((n) => n.toString(16).padStart(2, "0")).join("");
    expect(row.content_hash).toBe(hash); expect(row.key).toMatch(/^audio\/s\/[a-f0-9]{64}\/[a-f0-9-]{36}\.wav$/);
    env.AI_FAKE = "1"; await processSubmission({ submissionId: "s", stages: ["transcribe"], requestId: "concurrent" }, env);
    expect(db.prepare("SELECT status,error FROM processing_jobs WHERE stage='transcribe'").all()[0]).toEqual({ status: "done", error: null });
  });
  it("같은 WAV의 동시 재전송은 동일 immutable key와 한 분석 세대를 보존한다", async () => {
    const { db, env, audio, objects, state } = await setup(); let release!: () => void, entered!: () => void, puts = 0;
    const waiting = new Promise<void>((resolve) => { entered = resolve; }), gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(env.FILES.put).mockImplementation(async (key, value) => { objects.set(String(key), value as ArrayBuffer); if (++puts === 1) { entered(); await gate; } return {} as never; });
    const first = audio("identical"); await waiting; const second = await audio("identical"); release(); const previous = await first;
    expect([previous.status, second.status]).toEqual([201, 201]); expect(state().generation).toBe(1);
    const key = String(db.prepare("SELECT key FROM audio_tracks WHERE submission_id='s'").all()[0]!.key);
    expect(key).toMatch(/^audio\/s\/[a-f0-9]{64}\/[a-f0-9-]{36}\.wav$/); expect(objects.size).toBe(1);
  });
  it("실 오디오의 많은 문장도 query당100 bindings 이하인 원자 결과 batch로 저장한다", async () => {
    const { db, env, audio, maxBindings } = await setup(); await audio();
    vi.mocked(env.AI.run).mockResolvedValue({ segments: Array.from({ length: 25 }, (_, i) => ({ start: i, end: i + 1, text: `Sentence ${i}.` })), transcription_info: { language: "en" } } as never);
    await processSubmission({ submissionId: "s", stages: ["transcribe"], requestId: "many" }, env);
    expect(db.prepare("SELECT count(*) n FROM transcript_segments").all()[0]!.n).toBe(25); expect(maxBindings()).toBeLessThanOrEqual(100);
  });
  it("12프레임의 no-audio 기본 경로를 무료 D1 API50회 안에 처리한다", async () => {
    const { db, env, complete, full, calls, objects } = await setup(); env.AI_FAKE = "1";
    db.prepare("UPDATE guides SET extra_rules=? WHERE id='g'").run(JSON.stringify([{ id: "visual", type: "required_scene", content: "Product in frame", severity: "should", targets: ["screen_text"], enabled: true },
      ...Array.from({ length: 50 }, (_, i) => ({ id: `speech${i}`, type: "required_phrase", content: `Required phrase ${i}`, severity: "should", targets: ["speech"], enabled: true }))]));
    for (let i = 0; i < 12; i++) { const key = `frames/s/${i * 1000}.jpg`; db.prepare("INSERT INTO frames(id,submission_id,t_ms,image_key,source) VALUES(?,'s',?,?,'fps')").run(`f${i}`, i * 1000, key); objects.set(key, new ArrayBuffer(4)); }
    await complete(undefined, 12); calls.reset(); await full(); expect(env.FILES.get).toHaveBeenCalledTimes(12); expect(calls.getCalls()).toBeLessThanOrEqual(50);
  });
  it("부분 retry 뒤 기본 wake는 같은 세대의 완료 STT를 다시 실행하지 않는다", async () => {
    const { db, env, audio, full, state } = await setup(); await audio(); env.AI_FAKE = "1";
    await processSubmission({ submissionId: "s", stages: ["transcribe"], requestId: "partial" }, env);
    const segments = db.prepare("SELECT id,text FROM transcript_segments").all(); expect(segments.length).toBeGreaterThan(0);
    await processSubmission({ submissionId: "s", stages: ["detect"], requestId: "detect-pending" }, env);
    expect(db.prepare("SELECT id,text FROM transcript_segments").all()).toEqual(segments);
    await full(); expect(db.prepare("SELECT id,text FROM transcript_segments").all()).toEqual(segments); expect(state().completed_generation).toBe(1);
  });
  it("실오디오는 none을 대체하고 동일 WAV 재전송/늦은 none은 세대를 되돌리지 않는다", async () => {
    const { frame, complete, audio, state } = await setup(); frame(); await complete();
    expect((await audio()).status).toBe(201); expect(state()).toMatchObject({ audio_state: "present", generation: 2 });
    await audio(); await complete(); expect(state()).toMatchObject({ audio_state: "present", generation: 2 });
  });
  it("작업중 duplicate는 claim을 뺏지 않고 stale lease 뒤 재처리하며 완료 stage는 재호출하지 않는다", async () => {
    const { db, frame, complete, full, state, env } = await setup(); frame(); await complete();
    db.prepare("UPDATE submission_analysis SET claim_token='abandoned',claim_until=? WHERE submission_id='s'").run(NOW + 1000);
    await full(); expect(state().claim_token).toBe("abandoned"); expect(env.PIPELINE.send).toHaveBeenLastCalledWith(expect.anything(), { delaySeconds: 20 });
    vi.mocked(Date.now).mockReturnValue(NOW + 1001); await full(); expect(state()).toMatchObject({ claim_token: null, completed_generation: 1 });
    const jobs = db.prepare("SELECT * FROM processing_jobs").all(); await full(); expect(db.prepare("SELECT * FROM processing_jobs").all()).toEqual(jobs);
  });
  it("마지막 ready batch 실패 뒤에는 claim만 해제하고 재시도에서 완료 stage를 재실행하지 않는다", async () => {
    const { db, env, frame, complete, full, state, before } = await setup(); frame(); await complete();
    const hook = async (queries: string[]) => { if (queries.some((query) => /completed_generation=CASE/.test(query))) throw new Error("synthetic finish failure"); else before(hook); };
    before(hook); await expect(full()).rejects.toThrow("analysis_write_failed");
    expect(state()).toMatchObject({ claim_token: null, completed_generation: -1 });
    const jobs = db.prepare("SELECT * FROM processing_jobs").all(); await full();
    expect(db.prepare("SELECT * FROM processing_jobs").all()).toEqual(jobs); expect(state().completed_generation).toBe(1); expect(env.AI.run).not.toHaveBeenCalled();
  });
  it("옛 vision AI가 실 audio의 새 처리 뒤 끝나도 새 후보/전사/job을 복원하지 않는다", async () => {
    const { db, env, frame, complete, full, audio, objects, state } = await setup(); frame(); objects.set("frames/s/0.jpg", new ArrayBuffer(4));
    db.prepare("UPDATE guides SET extra_rules=? WHERE id='g'").run(JSON.stringify([{ id: "visual", type: "required_scene", content: "Product", severity: "should", targets: ["screen_text"], enabled: true }]));
    await complete(); let finish!: (value: unknown) => void;
    vi.mocked(env.AI.run).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }) as never);
    const old = full(); await vi.waitFor(() => expect(finish).toBeDefined());
    await audio("new actual audio"); env.AI_FAKE = "1"; await full();
    const candidates = db.prepare("SELECT id,reason FROM violation_candidates").all(), segments = db.prepare("SELECT id,text FROM transcript_segments").all();
    finish({ response: "q1: yes, high" }); await old;
    expect(state()).toMatchObject({ generation: 2, completed_generation: 2 });
    expect(db.prepare("SELECT id,reason FROM violation_candidates").all()).toEqual(candidates); expect(db.prepare("SELECT id,text FROM transcript_segments").all()).toEqual(segments);
    expect(db.prepare("SELECT status FROM processing_jobs WHERE stage='detect'").all()[0]!.status).toBe("done");
  });
  it("옛 none pipeline의 늦은 DELETE/skip/ready/cancel이 실오디오 새 결과를 덮지 않는다", async () => {
    const { db, env, frame, complete, audio, state, full, before } = await setup(); frame(); await complete(); env.AI_FAKE = "1";
    const hook = async (sql: string[]) => {
      if (sql.some((query) => /delete from "transcript_segments"/i.test(query))) { await audio("new audio"); await full(); }
      else before(hook);
    };
    before(hook); await processSubmission({ submissionId: "s", stages: ["transcribe"], requestId: "old-none" }, env);
    expect(state()).toMatchObject({ audio_state: "present", generation: 2, completed_generation: 2 });
    expect(db.prepare("SELECT text FROM transcript_segments").all().length).toBeGreaterThan(0);
    expect(db.prepare("SELECT status,error FROM processing_jobs WHERE stage='transcribe'").all()[0]).toEqual({ status: "done", error: null });
    expect(db.prepare("SELECT status FROM submissions WHERE id='s'").all()[0]!.status).toBe("ready");
  });
  it("옛 AI 응답이 새 audio 세대 완료 후 돌아와도 새 transcript와 job을 덮지 않는다", async () => {
    const { db, env, audio, state } = await setup(); await audio("old audio"); let finish!: (result: unknown) => void;
    vi.mocked(env.AI.run).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }) as never)
      .mockResolvedValue({ segments: [{ start: 0, end: 1, text: "new speech" }], transcription_info: { language: "en" } } as never);
    const old = processSubmission({ submissionId: "s", stages: ["transcribe"], requestId: "old" }, env);
    await vi.waitFor(() => expect(finish).toBeDefined()); await audio("new audio");
    await processSubmission({ submissionId: "s", stages: ["transcribe"], requestId: "new" }, env);
    finish({ segments: [{ start: 0, end: 1, text: "old speech" }], transcription_info: { language: "en" } }); await old;
    expect(state().generation).toBe(2); expect(db.prepare("SELECT text FROM transcript_segments").all()).toEqual([{ text: "new speech" }]);
    expect(db.prepare("SELECT status FROM processing_jobs WHERE stage='transcribe'").all()[0]!.status).toBe("done");
    expect(state().completed_request_id).toBe("new"); expect(fetch).not.toHaveBeenCalled();
  });
  it("중간 transcript INSERT 실패는 부분 문장을 남기지 않고 명시 retry만 재실행한다", async () => {
    const { db, env, audio } = await setup(); await audio(); env.AI_FAKE = "1";
    db.exec("CREATE TRIGGER fail_transcript BEFORE INSERT ON transcript_segments BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    const payload = { submissionId: "s", stages: ["transcribe"], requestId: "retry1" }; await processSubmission(payload, env);
    expect(db.prepare("SELECT text FROM transcript_segments").all()).toEqual([]); expect(db.prepare("SELECT status,attempts FROM processing_jobs WHERE stage='transcribe'").all()[0]).toEqual({ status: "failed", attempts: 3 });
    db.exec("DROP TRIGGER fail_transcript"); await processSubmission(payload, env); expect(db.prepare("SELECT text FROM transcript_segments").all()).toEqual([]);
    await processSubmission({ ...payload, requestId: "retry2" }, env); expect(db.prepare("SELECT text FROM transcript_segments").all().length).toBeGreaterThan(0);
    const segments = db.prepare("SELECT id,text FROM transcript_segments").all(); await processSubmission(payload, env);
    expect(db.prepare("SELECT id,text FROM transcript_segments").all()).toEqual(segments);
  });
});
