import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { guides, submissions } from "../db/schema";
import { countD1Calls, createSqliteD1, type TestSqlite } from "../test/sqlite-d1";
import worker from "../index";
import type { PipelineMessage } from "../jobs";
import type { AppEnv } from "../types";
import type { Ctx } from "../pipeline/context";
import { stageTranscribe } from "../pipeline/stages/transcribe";
import { stageTranslate } from "../pipeline/stages/translate";
import { cancelProcessingFor, processSubmission } from "../pipeline/run";
import { uploadRoutes } from "../routes/public-guide/upload";
import { mediaRoutes } from "../routes/public-guide/media";
import { ApiError, errorBody } from "./errors";
import { assertMediaWritable, mediaWritable, purgeSubmissionMedia, rememberMedia, runMediaPurges, validMediaKey, withdrawMedia, withMediaWrite } from "./media-purge";

const NOW = 1_800_000_000_000;
const ORIGINAL = "originals/g1/gi1/s1.mp4";
const databases: TestSqlite[] = [];
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NOW); vi.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.restoreAllMocks(); });

class FakeR2 {
  objects = new Set<string>();
  uploads = new Set<string>();
  failDelete = new Set<string>();
  abortFailure = false;
  beforePut?: () => Promise<void>;
  beforeComplete?: () => Promise<void>;
  beforeCreate?: () => Promise<void>;
  nextUpload = 1;
  async put(key: string) { await this.beforePut?.(); this.objects.add(key); return {}; }
  async get(key: string) { return this.objects.has(key) ? { arrayBuffer: async () => new ArrayBuffer(8) } : null; }
  async delete(keys: string | string[]) {
    for (const key of typeof keys === "string" ? [keys] : keys) {
      if (this.failDelete.has(key)) throw new Error("R2 unavailable");
      this.objects.delete(key);
    }
  }
  async list({ prefix }: { prefix: string }) { return { objects: [...this.objects].filter((key) => key.startsWith(prefix)).map((key) => ({ key })), truncated: false }; }
  async createMultipartUpload(_key: string) { const uploadId = `mp${++this.nextUpload}`; this.uploads.add(uploadId); await this.beforeCreate?.(); return { uploadId }; }
  resumeMultipartUpload(key: string, uploadId: string) {
    return {
      abort: async () => {
        if (this.abortFailure) throw new Error("abort unavailable");
        if (!this.uploads.delete(uploadId)) throw new Error("The specified multipart upload does not exist (10024)");
      },
      uploadPart: async () => ({ partNumber: 1, etag: "etag" }),
      complete: async () => { await this.beforeComplete?.(); this.uploads.delete(uploadId); this.objects.add(key); return {}; },
    };
  }
}

async function setup() {
  const { db, d1 } = await createSqliteD1();
  databases.push(db);
  db.exec("INSERT INTO workspaces (id,name,created_at) VALUES ('w1','팀',1)");
  db.exec("INSERT INTO guides (id,workspace_id,name,slug,status,extra_rules,product,deliverables,secondary_use_scope,created_at,updated_at) VALUES ('g1','w1','가이드','guide','published','[]','{}','{}','{}',1,1)");
  db.exec("INSERT INTO influencers (id,workspace_id,display_name,created_at) VALUES ('i1','w1','크리에이터',1)");
  db.prepare("INSERT INTO guide_influencers (id,guide_id,influencer_id,guide_token,upload_token,feedback_token,connect_token,token_expires_at,created_at) VALUES ('gi1','g1','i1','guide-token','upload-token','feedback-token','connect-token',?,1)").run(NOW + 86_400_000);
  const consent = (id: string) => db.prepare("INSERT INTO consents (id,guide_influencer_id,doc_version,items,secondary_use_scope,name,email,country,age_confirmed,agreed_at) VALUES (?,'gi1','v1','{}','{}','이름','test@example.com','KR',1,?)").run(id, NOW - 1000);
  consent("c1");
  const sub = (id: string, consentId = "c1", key: string | null = `originals/g1/gi1/${id}.mp4`) => db.prepare("INSERT INTO submissions (id,guide_influencer_id,consent_id,version,kind,status,original_key,upload_id,size_bytes,created_at,uploaded_at) VALUES (?,'gi1',?,1,'final','uploaded',?,'mp1',8,?,?)").run(id, consentId, key, NOW - 100, NOW - 100);
  sub("s1");
  db.exec("INSERT INTO frames (id,submission_id,t_ms,image_key,source) VALUES ('f1','s1',0,'frames/s1/0.jpg','fps')");
  db.exec("INSERT INTO audio_tracks (id,submission_id,key,sample_rate,duration_s) VALUES ('a1','s1','audio/s1.wav',16000,1)");
  db.exec("INSERT INTO transcript_segments (id,submission_id,start_ms,end_ms,lang,text,translated_text) VALUES ('t1','s1',0,1000,'en','private transcript','비공개 전사')");
  db.exec("INSERT INTO approvals (id,guide_influencer_id,submission_id,approved_at) VALUES ('approval','gi1','s1',1)");
  db.exec("INSERT INTO review_rounds (id,submission_id,guide_influencer_id,n,submitted_at) VALUES ('round','s1','gi1',1,1)");
  const r2 = new FakeR2();
  for (const key of [ORIGINAL, "frames/s1/0.jpg", "audio/s1.wav"]) r2.objects.add(key);
  r2.uploads.add("mp1");
  const env = { DB: d1, FILES: r2 as unknown as R2Bucket, PIPELINE: { send: vi.fn() }, APP_URL: "https://app.example.com", AI: { run: vi.fn() } } as unknown as Env;
  const orm = getDb(d1);
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("db", orm); c.set("auth", null); await next(); });
  app.route("/api/public", uploadRoutes);
  app.route("/api/public", mediaRoutes);
  app.onError((error, c) => error instanceof ApiError ? c.json(errorBody(error.code, error.message), error.status) : c.text(String(error), 500));
  const call = (path: string, init: RequestInit) => app.request(`/api/public/upload/upload-token/${path}`, init, env);
  const withdraw = () => withdrawMedia(orm, "gi1", "c1", NOW);
  return { db, d1, env, orm, r2, sub, consent, call, withdraw };
}
const row = (db: TestSqlite, table: string) => db.prepare(`SELECT * FROM ${table}`).all();
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("동의 철회 미디어 파기", () => {
  it("R2 부분 실패시 DB참조·전사를 보존하고 재시도 성공 뒤 원본·multipart·분석재료만 지운다", async () => {
    const { db, env, r2, withdraw } = await setup();
    r2.failDelete.add("frames/s1/0.jpg");
    await withdraw();
    await expect(runMediaPurges(env)).rejects.toThrow("media_purge_failed:1");
    expect(row(db, "media_purges")[0]).toMatchObject({ completed_at: null, last_error: "media_delete_failed" });
    expect(row(db, "submissions")[0]?.original_key).toBe(ORIGINAL);
    expect(row(db, "transcript_segments")).toHaveLength(1);
    expect(row(db, "frames")).toHaveLength(1);
    r2.failDelete.clear();
    vi.spyOn(Date, "now").mockReturnValue(NOW + 60_001);
    await runMediaPurges(env);
    expect(r2.objects.size).toBe(0);
    expect(r2.uploads.size).toBe(0);
    expect(row(db, "submissions")[0]).toMatchObject({ original_key: null, upload_id: null, media_purged_at: NOW + 60_001 });
    for (const table of ["frames", "audio_tracks", "transcript_segments"]) expect(row(db, table)).toHaveLength(0);
    expect(row(db, "approvals")).toHaveLength(1);
    expect(row(db, "review_rounds")).toHaveLength(1);
    expect(row(db, "media_purges")[0]?.completed_at).toBe(NOW + 60_001);
    expect(row(db, "media_purge_objects").length).toBeGreaterThan(2);
  });

  it("완료 tombstone을 재검사해 늦게 끝난 put과 참조 없는 프레임도 다시 삭제한다", async () => {
    const { db, env, r2, withdraw } = await setup();
    await withdraw(); await runMediaPurges(env);
    r2.objects.add("frames/s1/900.jpg"); r2.objects.add(ORIGINAL);
    vi.spyOn(Date, "now").mockReturnValue(NOW + 60_000);
    await runMediaPurges(env);
    expect(r2.objects.size).toBe(0);
    expect(row(db, "media_purges")[0]?.attempts).toBe(2);
  });

  it("미확인 multipart 원장은 실제 파기 완료로 처리하지 않는다", async () => {
    const { db, env, orm, withdraw } = await setup();
    await rememberMedia(orm, "s1", { key: ORIGINAL, kind: "multipart" });
    db.exec("UPDATE submissions SET upload_id=NULL WHERE id='s1'");
    await withdraw(); await expect(runMediaPurges(env)).rejects.toThrow("media_purge_failed:1");
    expect(row(db, "media_purges")[0]).toMatchObject({ completed_at: null, last_error: "multipart_upload_id_unknown" });
    expect(row(db, "submissions")[0]?.original_key).toBe(ORIGINAL);
    expect(row(db, "transcript_segments")).toHaveLength(1);
  });

  it("다른 제출물 키·경로탈출은 삭제하지 않고 오류를 영속화한다", async () => {
    const { db, env, r2, withdraw } = await setup();
    r2.objects.add("frames/other/0.jpg");
    await withdraw();
    db.exec("INSERT INTO media_purge_objects (id,submission_id,key,kind) VALUES ('bad','s1','frames/other/0.jpg','object')");
    await expect(runMediaPurges(env)).rejects.toThrow("media_purge_failed:1");
    expect(r2.objects.has("frames/other/0.jpg")).toBe(true);
    expect(row(db, "media_purges")[0]).toMatchObject({ completed_at: null, last_error: "invalid_media_key" });
    expect(validMediaKey("s1", "frames/s1/../other.jpg")).toBe(false);
    expect(validMediaKey("s1", "originals/g1/gi1/other.mp4")).toBe(false);
  });

  it("재동의의 새 제출물은 기존 파기 snapshot에 포함되지 않고 이전 제출물은 계속 차단된다", async () => {
    const { db, env, orm, r2, consent, sub, withdraw } = await setup();
    await withdraw(); consent("c2"); sub("s2", "c2");
    r2.objects.add("originals/g1/gi1/s2.mp4");
    await runMediaPurges(env);
    expect(r2.objects.has("originals/g1/gi1/s2.mp4")).toBe(true);
    expect(row(db, "media_purges").map((job) => job.submission_id)).toEqual(["s1"]);
    expect(await mediaWritable(orm, "s1")).toBe(false);
    expect(await mediaWritable(orm, "s2")).toBe(true);
    await expect(assertMediaWritable(orm, "s1")).rejects.toMatchObject({ code: "media_withdrawn" });
  });

  it("R2 put 도중 철회되면 늦은 객체를 보상 삭제하고 DB frame을 다시 쓰지 않는다", async () => {
    const { db, env, orm, r2, withdraw } = await setup();
    r2.beforePut = async () => { r2.beforePut = undefined; await withdraw(); await runMediaPurges(env); };
    let committed = false;
    await expect(withMediaWrite(env, orm, "s1", { key: "frames/s1/123.jpg", kind: "object" }, () => r2.put("frames/s1/123.jpg"), async () => { committed = true; })).rejects.toMatchObject({ code: "media_withdrawn" });
    expect(committed).toBe(false);
    expect(r2.objects.has("frames/s1/123.jpg")).toBe(false);
    expect(row(db, "media_purges")[0]?.completed_at).not.toBeNull();
  });

  it("실제 multipart complete가 철회 뒤 끝나도 원본을 보상 삭제하고 uploaded로 되돌리지 않는다", async () => {
    const { db, env, r2, call, withdraw } = await setup();
    db.exec("UPDATE submissions SET status='uploading' WHERE id='s1'");
    db.exec("INSERT INTO upload_parts (submission_id,part_number,etag,size) VALUES ('s1',1,'etag',8)");
    r2.beforeComplete = async () => { await withdraw(); await runMediaPurges(env); };
    const response = await call("complete", post({ submissionId: "s1" }));
    expect(response.status).toBe(410);
    expect(r2.objects.has(ORIGINAL)).toBe(false);
    expect(row(db, "submissions")[0]?.status).not.toBe("uploaded");
    expect(env.PIPELINE.send).not.toHaveBeenCalled();
  });

  it("실제 frame POST가 철회와 겹치면 늦은 put을 삭제하고 frame행도 만들지 않는다", async () => {
    const { db, env, r2, call, withdraw } = await setup();
    r2.beforePut = async () => { r2.beforePut = undefined; await withdraw(); await runMediaPurges(env); };
    const body = new FormData();
    body.set("submissionId", "s1"); body.set("t_ms", "123"); body.set("image", new Blob(["jpeg"], { type: "image/jpeg" }), "frame.jpg");
    expect((await call("frames", { method: "POST", body })).status).toBe(410);
    expect(r2.objects.has("frames/s1/123.jpg")).toBe(false);
    expect(row(db, "frames")).toHaveLength(0);
  });

  it("multipart 생성 중 철회되면 미확인 원장을 유지하다 알려진 ID의 abort로 완료한다", async () => {
    const { db, env, r2, call, withdraw } = await setup();
    r2.beforeCreate = async () => { await withdraw(); await expect(runMediaPurges(env)).rejects.toThrow("media_purge_failed:1"); };
    const response = await call("init", post({ kind: "final", fileName: "new.mp4", size: 8, durationS: 1 }));
    expect(response.status).toBe(410);
    expect(r2.uploads.size).toBe(0);
    expect(row(db, "media_purges")).toHaveLength(2);
    expect(row(db, "media_purges").every((job) => job.completed_at !== null)).toBe(true);
    expect(row(db, "submissions").find((sub) => sub.id !== "s1")).toMatchObject({ status: "aborted", original_key: null, upload_id: null });
  });

  it("DB fence가 철회된 기존 세대의 미디어·전사·후보·part·완료 상태 재쓰기를 원자적으로 막는다", async () => {
    const { db, withdraw } = await setup();
    await withdraw();
    for (const statement of [
      "INSERT INTO frames (id,submission_id,t_ms,image_key,source) VALUES ('late','s1',9,'frames/s1/9.jpg','fps')",
      "UPDATE audio_tracks SET key='audio/s1.wav' WHERE id='a1'",
      "INSERT INTO transcript_segments (id,submission_id,start_ms,end_ms,lang,text) VALUES ('late','s1',0,1,'en','late private')",
      "UPDATE transcript_segments SET translated_text='late translation' WHERE id='t1'",
      "INSERT INTO upload_parts (submission_id,part_number,etag,size) VALUES ('s1',99,'etag',8)",
      "UPDATE submissions SET status='ready' WHERE id='s1'",
    ]) expect(() => db.exec(statement)).toThrow(/consent|media|privacy/i);
  });

  it("카운터는없는객체삭제와구별한처리수이며실패·unknown·남은수를기록하고나머지job도처리한다", async () => {
    const { db, env, orm, r2, sub, withdraw } = await setup();
    sub("s2"); r2.objects.add("originals/g1/gi1/s2.mp4");
    await rememberMedia(orm, "s1", { key: ORIGINAL, kind: "multipart" });
    db.exec("UPDATE submissions SET upload_id=NULL WHERE id='s1'");
    await withdraw();
    await expect(runMediaPurges(env)).rejects.toThrow("media_purge_failed:1");
    const stats = JSON.parse(String(db.prepare("SELECT props FROM events WHERE name='media_purge_run'").all()[0]?.props));
    expect(stats).toMatchObject({ attempted: 2, succeeded: 1, failed: 1, pending: 1, overdue: 1, unknownMultipart: 1 });
    expect(JSON.stringify(stats)).not.toMatch(/test@example|originals\/|s1|private transcript/);
    expect(row(db, "media_purges").find((job) => job.submission_id === "s2")?.completed_at).toBe(NOW);
  });

  it("완료 tombstone 재검사도 checked_at 순서로 순환해 다음 대기 제출물이 굶지 않는다", async () => {
    const { db, env, sub, withdraw } = await setup();
    for (let n = 2; n <= 22; n++) sub(`s${n}`);
    await withdraw();
    await runMediaPurges(env);
    expect(row(db, "media_purges").filter((job) => job.completed_at === null)).toHaveLength(18);
    for (let pass = 1; pass <= 5; pass++) {
      vi.spyOn(Date, "now").mockReturnValue(NOW + pass);
      await runMediaPurges(env);
    }
    expect(row(db, "media_purges").filter((job) => job.completed_at === null)).toHaveLength(0);
  });

  it("실제 처리 파이프라인은 철회 중 AI 완료를 skipped로 끝내고 ready나 후속 AI로 진행하지 않는다", async () => {
    const { db, env, withdraw } = await setup();
    const ai = vi.fn(async () => {
      await withdraw(); await runMediaPurges(env);
      return { transcription_info: { language: "en" }, segments: [{ start: 0, end: 1, text: "late private text" }] };
    });
    env.AI = { run: ai } as unknown as Ai;
    await processSubmission({ submissionId: "s1", stages: ["transcribe", "translate"] }, env);
    expect(ai).toHaveBeenCalledTimes(1);
    expect(row(db, "processing_jobs").map((job) => [job.status, job.error])).toEqual([["skipped", "withdrawn"], ["skipped", "withdrawn"]]);
    expect(row(db, "submissions")[0]?.status).not.toBe("ready");
    expect(row(db, "transcript_segments")).toHaveLength(0);
  });

  it("철회 처리 중 재동의가 생겨도 새 동의의 처리 job은 취소하지 않는다", async () => {
    const { db, orm, consent, sub, withdraw } = await setup();
    db.exec("INSERT INTO processing_jobs (id,submission_id,stage,status) VALUES ('old','s1','transcribe','queued')");
    await withdraw(); consent("c2"); sub("s2", "c2");
    db.exec("INSERT INTO processing_jobs (id,submission_id,stage,status) VALUES ('new','s2','transcribe','queued')");
    await cancelProcessingFor(orm, "gi1", "c1");
    expect(db.prepare("SELECT status FROM processing_jobs WHERE id='old'").all()[0]?.status).toBe("skipped");
    expect(db.prepare("SELECT status FROM processing_jobs WHERE id='new'").all()[0]?.status).toBe("queued");
    db.exec("UPDATE guide_influencers SET stage='consented' WHERE id='gi1'");
    expect(await withdrawMedia(orm, "gi1", "c1", NOW + 1)).toBe(false);
    expect(row(db, "guide_influencers")[0]?.stage).toBe("consented");
    expect(await mediaWritable(orm, "s2")).toBe(true);
  });

  it("R2 put 중 부모가 cascade 삭제되어도 prewrite 동의 원장으로 fallback job을 만들고 고아 객체를 지운다", async () => {
    const { db, env, orm, r2 } = await setup();
    r2.beforePut = async () => { r2.beforePut = undefined; db.exec("DELETE FROM guide_influencers WHERE id='gi1'"); };
    await expect(withMediaWrite(env, orm, "s1", { key: "frames/s1/777.jpg", kind: "object" }, () => r2.put("frames/s1/777.jpg"), async () => {})).rejects.toMatchObject({ code: "media_withdrawn" });
    expect(r2.objects.size).toBe(0);
    expect(row(db, "media_purges")[0]).toMatchObject({ submission_id: "s1", consent_id: "c1", completed_at: NOW });
    expect(row(db, "media_purge_objects").every((object) => object.consent_id === "c1")).toBe(true);
  });

  it("multipart create 중 부모가 삭제되어도 알려진 upload ID를 원장에 보존하고 abort한다", async () => {
    const { db, r2, call } = await setup();
    r2.beforeCreate = async () => { db.exec("DELETE FROM guide_influencers WHERE id='gi1'"); };
    const response = await call("init", post({ kind: "final", fileName: "new.mp4", size: 8, durationS: 1 }));
    expect(response.status).toBe(410);
    const job = row(db, "media_purges")[0]!;
    expect(job).toMatchObject({ consent_id: "c1", completed_at: NOW });
    const multipart = row(db, "media_purge_objects").find((object) => object.submission_id === job.submission_id && object.kind === "multipart");
    expect(multipart?.upload_id).toBe("mp2");
    expect(r2.uploads.has("mp2")).toBe(false);
  });

  it.each([false, true])("180프레임 대기4건·완료1건은 Cron과 별도 Queue의 D1/R2 예산 안에서 처리한다(실패=%s)", async (failCommit) => {
    const { db, d1, env, r2, sub, withdraw } = await setup();
    for (let n = 2; n <= 5; n++) sub(`s${n}`);
    for (let n = 1; n <= 5; n++) for (let frame = n === 1 ? 1 : 0; frame < 180; frame++) {
      const key = `frames/s${n}/${frame}.jpg`;
      db.prepare("INSERT INTO frames (id,submission_id,t_ms,image_key,source) VALUES (?,?,?,?,'fps')").run(`frame-${n}-${frame}`, `s${n}`, frame, key);
      r2.objects.add(key);
    }
    await withdraw(); await purgeSubmissionMedia(env, "s5");
    const counted = countD1Calls(d1);
    env.DB = counted.d1;
    const enqueued: PipelineMessage[] = [];
    env.PIPELINE = { sendBatch: vi.fn(async (messages: Iterable<{ body: PipelineMessage }>) => { enqueued.push(...[...messages].map((message) => message.body)); }) } as unknown as Queue;
    const at = Math.floor(NOW / 86_400_000) * 86_400_000 + 18 * 3_600_000;
    vi.spyOn(Date, "now").mockReturnValue(at);
    const pending: Promise<unknown>[] = [];
    await worker.scheduled({ scheduledTime: at, cron: "*/15 * * * *", noRetry() {} }, env, { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } } as unknown as ExecutionContext);
    await Promise.all(pending);
    expect(counted.getCalls()).toBe(9); // 03:00 KST의 기존 빈 태스크만 실행되고 개인정보 D1은 소비하지 않는다.
    expect(enqueued).toHaveLength(3);
    if (failCommit) db.exec("CREATE TRIGGER fail_purge_commit BEFORE UPDATE OF media_purged_at ON submissions BEGIN SELECT RAISE(ABORT,'test'); END");
    const list = vi.spyOn(r2, "list"), remove = vi.spyOn(r2, "delete"), multipart = vi.spyOn(r2, "resumeMultipartUpload");
    const ack = vi.fn(), retry = vi.fn();
    const message = enqueued.find((message) => (message.payload as { kind: string }).kind === "media")!;
    counted.reset();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await worker.queue({ queue: "avocado-pipeline", messages: [{ body: message, ack, retry }] } as unknown as MessageBatch<PipelineMessage>, env);
    const d1Calls = counted.getCalls();
    const r2Calls = list.mock.calls.length + remove.mock.calls.length + multipart.mock.calls.length;
    expect(d1Calls).toBeLessThanOrEqual(failCommit ? 45 : 40); // D1 제품별 Free 50회
    expect(d1Calls).toBeGreaterThan(0);
    expect(r2Calls).toBeLessThanOrEqual(15);
    expect(d1Calls + r2Calls).toBeLessThan(1000); // Free 내부 서비스 한도, 외부 fetch는 없다.
    expect(failCommit ? retry : ack).toHaveBeenCalledTimes(1);
    expect(failCommit ? ack : retry).not.toHaveBeenCalled();
    expect(row(db, "media_purges").every((job) => job.completed_at !== null)).toBe(!failCommit);
  });

  it.each(["transcribe", "translate"])("%s AI가 철회 뒤 완료되어도 전사·번역 결과를 복원하지 않는다", async (stage) => {
    const { db, env, orm, withdraw } = await setup();
    db.exec(`INSERT INTO processing_jobs (id,submission_id,stage,status) VALUES ('job','s1','${stage}','running')`);
    env.AI = { run: vi.fn(async () => {
      await withdraw(); await runMediaPurges(env);
      return stage === "transcribe" ? { transcription_info: { language: "en" }, segments: [{ start: 0, end: 1, text: "late private text" }] } : { translated_text: "late translation" };
    }) } as unknown as Ai;
    const ctx = { env, db: orm, sub: (await orm.select().from(submissions).where(eq(submissions.id, "s1")).get())!, guide: (await orm.select().from(guides).get())!, giId: "gi1", workspaceId: "w1" } as Ctx;
    await expect(stage === "transcribe" ? stageTranscribe(ctx) : stageTranslate(ctx)).rejects.toMatchObject({ code: "media_withdrawn" });
    expect(row(db, "transcript_segments")).toHaveLength(0);
  });
});
