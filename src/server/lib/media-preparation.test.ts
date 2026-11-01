import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createSqliteD1 } from "../test/sqlite-d1";
import { getDb } from "../db";
import type { AppEnv, Auth } from "../types";
import { audioHash, claimAnalysis } from "../pipeline/analysis";
import type { Ctx } from "../pipeline/context";
import { processSubmission } from "../pipeline/run";
import * as preparation from "./media-preparation";
import { boundedMediaStream, type PreparationJob, type PreparationManifest, type PreparationPermit, type PreparationSink } from "./media-preparation-contract";
import { cleanupRetiredAudio, runMediaPurges, withdrawMedia } from "./media-purge";
import { fileRoutes } from "../routes/reviews/files";
import { mediaRoutes } from "../routes/public-guide/media";
import { ApiError, errorBody } from "./errors";

const NOW = 1_800_000_000_000, ORIGINAL = "originals/g/gi/s.mp4", encoder = new TextEncoder();
const closes: (() => void)[] = [];
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NOW); vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "log").mockImplementation(() => {}); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No real provider/AI"); })); });
afterEach(() => { closes.splice(0).forEach((close) => close()); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const asBuffer = (value: Uint8Array) => value.slice().buffer as ArrayBuffer;
function bytesStream(value: Uint8Array) { let sent = false; return new ReadableStream({ type: "bytes", pull(controller) { if (sent) controller.close(); else { sent = true; controller.enqueue(value.slice()); } } }); }
type Stored = { bytes: Uint8Array; etag: string; sha?: ArrayBuffer; type?: string };
async function setup(audio = true) {
  const base = await createSqliteD1(); closes.push(base.close); const { db } = base;
  db.exec(`INSERT INTO workspaces(id,name,created_at) VALUES('w','Synthetic',1),('other','Other',1);
    INSERT INTO guides(id,workspace_id,name,slug,status,extra_rules,product,deliverables,secondary_use_scope,created_at,updated_at) VALUES('g','w','Guide','guide','published','[]','{}','{}','{}',1,1);
    INSERT INTO influencers(id,workspace_id,display_name,created_at) VALUES('i','w','Synthetic',1);
    INSERT INTO guide_influencers(id,guide_id,influencer_id,guide_token,upload_token,feedback_token,connect_token,token_expires_at,created_at) VALUES('gi','g','i','guide','upload','feedback','connect',9999999999999,1);
    INSERT INTO consents(id,guide_influencer_id,doc_version,items,secondary_use_scope,name,email,country,age_confirmed,agreed_at) VALUES('c','gi','v1','{}','{}','Synthetic','synthetic@example.test','KR',1,1);`);
  db.prepare("INSERT INTO submissions(id,guide_influencer_id,consent_id,version,kind,status,original_key,size_bytes,created_at,uploaded_at) VALUES('s','gi','c',1,'final','uploaded',?,5,?,?)").run(ORIGINAL, NOW - 100, NOW - 100);
  const hooks: { beforeBatch?: (sql: string[]) => Promise<void>; afterRead?: (sql: string) => Promise<void>; polls?: (permit: PreparationPermit, job: PreparationJob) => Promise<void>; loseCommit?: boolean; put?: (key: string) => Promise<void>; afterPut?: (key: string) => Promise<void>; beforeCommit?: (sink: PreparationSink, manifest: PreparationManifest) => Promise<void>; get?: (key: string) => Promise<void>; badChecksum?: boolean; metadataOnly?: boolean; failService?: boolean; delayService?: Promise<void> } = {};
  let physical = 0, calls = 0, maxBinds = 0, maxBytes = 0;
  const statements = new WeakMap<D1PreparedStatement, string>();
  const wrap = (s: D1PreparedStatement, text: string): D1PreparedStatement => {
    const proxy = new Proxy(s, { get(target, key) {
      if (key === "bind") return (...args: unknown[]) => { maxBinds = Math.max(maxBinds, args.length); maxBytes = Math.max(maxBytes, encoder.encode(JSON.stringify(args)).byteLength); if (args.length > 100) throw new Error("bind cap"); return wrap(target.bind(...args), text); };
      if (["all", "run", "first", "raw"].includes(String(key))) return async (...args: unknown[]) => { calls++; physical++; const result = await Reflect.get(target, key).apply(target, args); await hooks.afterRead?.(text); return result; };
      return Reflect.get(target, key);
    } }); statements.set(proxy, text); return proxy;
  };
  const d1 = { ...base.d1, prepare: (text: string) => wrap(base.d1.prepare(text), text), batch: async (items: D1PreparedStatement[]) => {
    calls++; physical += items.length; await hooks.beforeBatch?.(items.map((s) => statements.get(s) ?? "")); const result = await base.d1.batch(items);
    if (hooks.loseCommit && items.some((s) => statements.get(s)?.includes("SET state='selected'"))) { hooks.loseCommit = false; throw new Error("PRIVATE commit ACK lost"); }
    return result;
  } } as D1Database;
  const objects = new Map<string, Stored>([[ORIGINAL, { bytes: encoder.encode("input"), etag: "source-A", type: "video/quicktime" }]]);
  const objectMeta = (key: string, value: Stored) => ({ key, etag: value.etag, httpEtag: `"${value.etag}"`, size: value.bytes.byteLength, checksums: { sha256: value.sha }, writeHttpMetadata(headers: Headers) { headers.set("content-type", value.type ?? "application/octet-stream"); } });
  const head = vi.fn(async (key: string) => { const value = objects.get(key); return value ? objectMeta(key, value) : null; });
  const readArray = vi.fn();
  const get = vi.fn(async (key: string, options?: R2GetOptions) => {
    await hooks.get?.(key); const value = objects.get(key); if (!value) return null;
    const metadata = objectMeta(key, value), condition = options?.onlyIf as { etagMatches?: string } | undefined;
    if (hooks.metadataOnly || condition?.etagMatches && condition.etagMatches !== value.etag) return metadata;
    const range = options?.range instanceof Headers ? options.range.get("range")?.match(/^bytes=(\d+)-(\d+)$/) : null;
    const selected = range ? value.bytes.slice(Number(range[1]), Number(range[2]) + 1) : value.bytes;
    return { ...metadata, body: bytesStream(selected), ...(range ? { range: { offset: Number(range[1]), length: selected.byteLength } } : {}), arrayBuffer: async () => { readArray(key); return asBuffer(value.bytes); } };
  });
  const put = vi.fn(async (key: string, body: ReadableStream<Uint8Array> | ArrayBuffer, options?: R2PutOptions) => {
    await hooks.put?.(key); const chunks: Uint8Array[] = []; let length = 0;
    if (body instanceof ArrayBuffer) { chunks.push(new Uint8Array(body)); length = body.byteLength; }
    else { const reader = body.getReader(); while (true) { const { value, done } = await reader.read(); if (done) break; chunks.push(value); length += value.byteLength; } }
    const data = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    const sha = await crypto.subtle.digest("SHA-256", asBuffer(data)), digest = await audioHash(asBuffer(data));
    if (options?.sha256 && options.sha256 !== digest) throw new Error("checksum mismatch");
    const stored: Stored = { bytes: data, etag: `etag-${objects.size}`, sha: hooks.badChecksum ? new Uint8Array(32).buffer : sha, type: (options?.httpMetadata as R2HTTPMetadata)?.contentType };
    objects.set(key, stored); await hooks.afterPut?.(key); return objectMeta(key, stored);
  });
  const remove = vi.fn(async (keys: string | string[]) => { for (const key of typeof keys === "string" ? [keys] : keys) objects.delete(key); });
  const service = { cancel: vi.fn(async (_jobId: string) => {}), prepare: vi.fn(async (job: PreparationJob, input: ReadableStream<Uint8Array>, permit: PreparationPermit, sink: PreparationSink) => {
    if (hooks.delayService) await hooks.delayService;
    if (hooks.failService) throw new Error("PRIVATE service error");
    await permit.assertCurrent(job); const reader = input.getReader(); while (!(await reader.read()).done) {} reader.releaseLock();
    await hooks.polls?.(permit, job);
    const outputs = [...(audio ? [{ name: "audio.wav" as const, body: encoder.encode("wave-audio") }] : []), { name: "video.mp4" as const, body: encoder.encode("video-proxy") }];
    const manifest: PreparationManifest = { v: 1, generation: job.generation, consentId: job.consentId, sourceEtag: job.sourceEtag, inputBytes: job.declaredBytes, inputSha256: "a".repeat(64), durationS: 1,
      audio: audio ? { state: "present", sampleRate: 16000, durationS: 1 } : { state: "none", proof: "complete_probe_and_video_decode_no_audio" }, artifacts: [] };
    try {
      for (const output of outputs) { const metadata = { name: output.name, bytes: output.body.byteLength, sha256: await audioHash(asBuffer(output.body)) }; manifest.artifacts.push(metadata); await sink.stage(output.name, bytesStream(output.body), metadata); }
      await hooks.beforeCommit?.(sink, manifest); await sink.commit(manifest); return manifest;
    } catch (e) { await sink.retireUnselected(); throw e; }
  }) };
  const env = { DB: d1, FILES: { head, get, put, delete: remove, list: vi.fn(async ({ prefix }: { prefix: string }) => ({ objects: [...objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })), truncated: false })) }, MEDIA_PREPARATION: service,
    PIPELINE: { send: vi.fn(async () => {}) }, AI: { run: vi.fn(() => { throw new Error("No real AI"); }) }, AI_FAKE: "1", APP_URL: "https://app.test" } as unknown as Env;
  const prepare = preparation.createMediaPreparation({ targets: async (permit, sink) => ({ permit, sink }), fixedLength: () => new TransformStream<Uint8Array, Uint8Array>() });
  vi.spyOn(preparation, "prepareSubmissionMedia").mockImplementation(prepare);
  const auth: Auth = { sessionId: "session", user: { id: "reader", email: "synthetic@example.test", name: "Synthetic" }, workspace: { id: "w", name: "Synthetic", plan: "starter", onboardedAt: 1 }, role: "viewer", phone: null, phoneVerified: true };
  const app = new Hono<AppEnv>(); app.use("*", async (c, next) => { c.set("db", getDb(c.env.DB)); c.set("auth", c.req.path.startsWith("/api/files") ? auth : null); await next(); }); app.route("/api/files", fileRoutes); app.route("/api/public", mediaRoutes);
  app.onError((error, c) => error instanceof ApiError ? c.json(errorBody(error.code, error.message), error.status) : c.text("internal", 500));
  const orm = getDb(d1), state = () => db.prepare("SELECT * FROM submission_analysis WHERE submission_id='s'").all()[0]!;
  const ctx = async (): Promise<Ctx> => ({ env, db: orm, sub: (await orm.query.submissions.findFirst({ where: (s, { eq }) => eq(s.id, "s") }))!, guide: (await orm.query.guides.findFirst())!, workspaceId: "w", giId: "gi" });
  const addFrame = () => { db.exec("INSERT INTO frames(id,submission_id,t_ms,image_key,source) VALUES('f','s',0,'frames/s/0.jpg','fps')"); objects.set("frames/s/0.jpg", { bytes: encoder.encode("frame"), etag: "frame" }); };
  const frameReceipt = () => app.request("/api/public/upload/upload/analysis-complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ submissionId: "s", frameCount: 1, outcome: { kind: "unavailable", reason: "decode_limit" } }) }, env);
  return { ...base, env, d1, objects, hooks, service, prepare, state, ctx, app, auth, addFrame, frameReceipt, put, head, get, remove, readArray,
    metrics: () => ({ physical, calls, maxBinds, maxBytes }), reset: () => { physical = calls = maxBinds = maxBytes = 0; } };
}

describe("optional app-owned media preparation", () => {
  it("absent binding is exactly the old path with no preparation IO", async () => {
    const s = await setup(); delete s.env.MEDIA_PREPARATION; s.reset(); expect(await s.prepare(s.env, "s")).toBe("original"); expect(s.metrics().physical).toBe(0); expect(s.head).not.toHaveBeenCalled(); expect(s.service.prepare).not.toHaveBeenCalled();
  });
  it("streams and checksums two staged artifacts, settles a new generation before any analysis claim, then reuses selection", async () => {
    const s = await setup(); expect(await s.prepare(s.env, "s")).toBe("yield"); expect(s.state()).toMatchObject({ generation: 1, audio_state: "present", claim_token: null });
    expect(s.db.prepare("SELECT state,selected_generation FROM media_preparations").all()).toEqual([{ state: "selected", selected_generation: 1 }]);
    expect(s.objects.size).toBe(3); expect(s.readArray).not.toHaveBeenCalled(); expect(s.env.AI.run).not.toHaveBeenCalled();
    expect(s.put.mock.calls.every((call) => call[1] instanceof ReadableStream)).toBe(true);
    expect(Object.keys(s.service.prepare.mock.calls[0]![0])).toEqual(["jobId", "generation", "consentId", "sourceEtag", "declaredBytes"]);
    expect(await s.prepare(s.env, "s")).toBe("ready"); expect(s.service.prepare).toHaveBeenCalledOnce(); expect(s.state().generation).toBe(1);
    expect(s.metrics().physical).toBeLessThanOrEqual(50); expect(s.metrics().maxBinds).toBeLessThanOrEqual(100);
  });
  it("confirmed no-audio remains a positive server proof without claiming browser frames complete", async () => {
    const s = await setup(false); await s.prepare(s.env, "s"); expect(s.state()).toMatchObject({ audio_state: "none", audio_reason: "server_prepared_no_audio", generation: 1, frames_complete: 0 }); expect(s.objects.size).toBe(2); expect(s.db.prepare("SELECT * FROM audio_tracks").all()).toHaveLength(0);
  });
  it("a terminal unavailable service is attempted once per source/generation and cannot starve the browser fallback", async () => {
    const s = await setup(); s.hooks.failService = true; expect(await s.prepare(s.env, "s")).toBe("yield"); expect(await s.prepare(s.env, "s")).toBe("original"); expect(s.service.prepare).toHaveBeenCalledOnce(); expect(s.state().generation).toBe(0);
  });
  it("metadata-only conditional GET and checksum mismatch never publish", async () => {
    const a = await setup(); a.hooks.metadataOnly = true; await a.prepare(a.env, "s"); expect(a.service.prepare).not.toHaveBeenCalled(); expect(a.db.prepare("SELECT state FROM media_preparations").all()).toEqual([{ state: "failed" }]);
    const b = await setup(); b.hooks.badChecksum = true; await b.prepare(b.env, "s"); expect(b.state().generation).toBe(0); expect([...b.objects.keys()]).toEqual([ORIGINAL]);
  });
  it("current ETag/generation/consent fences reject stale output while preserving other current audio", async () => {
    const s = await setup(); s.hooks.beforeCommit = async () => { s.db.exec("INSERT INTO audio_tracks(id,submission_id,key,sample_rate,duration_s) VALUES('browser','s','audio/s.wav',16000,1)"); s.objects.set("audio/s.wav", { bytes: encoder.encode("browser"), etag: "browser" }); };
    await s.prepare(s.env, "s"); expect(s.state().generation).toBe(1); expect(s.db.prepare("SELECT key FROM audio_tracks").all()).toEqual([{ key: "audio/s.wav" }]); expect(s.objects.size).toBe(2);
    const t = await setup(); t.hooks.beforeCommit = async () => { t.objects.get(ORIGINAL)!.etag = "source-B"; t.db.exec("UPDATE submissions SET original_etag='source-B'"); };
    await t.prepare(t.env, "s"); expect(t.state().generation).toBe(0); expect(t.objects.size).toBe(1);
  });
  it("an active old analysis claim is never rotated and native claim TOCTOU chooses only one winner", async () => {
    const a = await setup(), context = await a.ctx(); expect(await claimAnalysis(context, null)).toBe("claimed"); const before = a.state(); expect(await a.prepare(a.env, "s")).toBe("busy"); expect(a.state()).toEqual(before); expect(a.service.prepare).not.toHaveBeenCalled();
    const b = await setup(); let once = true;
    b.hooks.beforeBatch = async (sqls) => { if (once && sqls.some((text) => text.includes("INSERT INTO media_preparations"))) { once = false; await claimAnalysis(await b.ctx(), null); } };
    expect(await b.prepare(b.env, "s")).toBe("busy"); expect(b.db.prepare("SELECT * FROM media_preparations").all()).toHaveLength(0); expect(b.state().generation).toBe(0);
  });
  it("lost commit ACK and a duplicate commit during a fresh analysis claim never retire selected objects or rotate again", async () => {
    const a = await setup(); a.hooks.loseCommit = true; await a.prepare(a.env, "s"); expect(a.state().generation).toBe(1); expect(a.objects.size).toBe(3); expect(a.db.prepare("SELECT retired_at FROM media_purge_objects").all().every((r) => r.retired_at === null)).toBe(true);
    expect(a.service.cancel).not.toHaveBeenCalled();
    const b = await setup(); let token: unknown;
    b.hooks.beforeCommit = async (sink, manifest) => { await sink.commit(manifest); const context = await b.ctx(); expect(await claimAnalysis(context, null)).toBe("claimed"); token = context.analysis!.token; };
    await b.prepare(b.env, "s"); expect(b.state()).toMatchObject({ generation: 1, claim_token: token }); expect(b.objects.size).toBe(3);
  });
  it("a missing exact-key purge intent fails selection and is repaired for compensation", async () => {
    const s = await setup(); s.hooks.beforeCommit = async () => { s.db.exec("DELETE FROM media_purge_objects WHERE key LIKE 'prepared/%'"); };
    await s.prepare(s.env, "s"); expect(s.state().generation).toBe(0); expect(s.objects.size).toBe(1); expect(s.db.prepare("SELECT retired_at FROM media_purge_objects").all().every((r) => r.retired_at !== null)).toBe(true);
  });
  it("withdrawal and parent deletion cannot lose staged keys or preserve selected outputs from the purger", async () => {
    const a = await setup(); await a.prepare(a.env, "s"); await withdrawMedia(getDb(a.env.DB), "gi", "c", NOW); await runMediaPurges(a.env); expect(a.objects.size).toBe(0); expect(a.db.prepare("SELECT state FROM media_preparations").all()).toEqual([{ state: "retired" }]);
    const b = await setup(); b.hooks.beforeCommit = async () => { b.db.exec("DELETE FROM submissions WHERE id='s'"); }; await b.prepare(b.env, "s"); await cleanupRetiredAudio(b.env, getDb(b.env.DB)); expect([...b.objects.keys()]).toEqual([ORIGINAL]); expect(b.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("withdrawing an older consent preserves a newly consented submission and its selected derivatives", async () => {
    const s = await setup(); await s.prepare(s.env, "s");
    s.db.exec("INSERT INTO consents(id,guide_influencer_id,doc_version,items,secondary_use_scope,name,email,country,age_confirmed,agreed_at) VALUES('c2','gi','v2','{}','{}','Synthetic','synthetic@example.test','KR',1,2)");
    s.db.prepare("INSERT INTO submissions(id,guide_influencer_id,consent_id,version,kind,status,original_key,size_bytes,created_at,uploaded_at) VALUES('s2','gi','c2',2,'final','uploaded','originals/g/gi/s2.mp4',5,?,?)").run(NOW, NOW);
    s.objects.set("originals/g/gi/s2.mp4", { bytes: encoder.encode("input"), etag: "source-2" }); await s.prepare(s.env, "s2");
    await withdrawMedia(getDb(s.env.DB), "gi", "c", NOW); await runMediaPurges(s.env);
    expect(s.objects.size).toBe(3); expect([...s.objects.keys()].every((key) => key.includes("/s2/") || key.endsWith("/s2.mp4"))).toBe(true);
    expect(s.db.prepare("SELECT state FROM media_preparations WHERE submission_id='s2'").all()).toEqual([{ state: "selected" }]); expect(s.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("playback uses the proxy with Range, download uses the original, and missing proxy falls back", async () => {
    const s = await setup(); await s.prepare(s.env, "s"); const url = `/api/files/${ORIGINAL}`;
    const range = await s.app.request(url, { headers: { range: "bytes=0-1" } }, s.env); expect(range.status).toBe(206); expect(await range.text()).toBe("vi");
    const original = await s.app.request(url + "?download=1", undefined, s.env); expect(await original.text()).toBe("input");
    const proxy = String(s.db.prepare("SELECT video_key FROM media_preparations").all()[0]!.video_key); s.objects.delete(proxy);
    const fallback = await s.app.request(url, undefined, s.env); expect(await fallback.text()).toBe("input");
    s.auth.workspace!.id = "other"; expect((await s.app.request(url, undefined, s.env)).status).toBe(404);
  });
  it("withdrawal during a proxy read forbids the original fallback", async () => {
    const s = await setup(); await s.prepare(s.env, "s"); s.hooks.get = async (key) => { if (key.startsWith("prepared/")) { await withdrawMedia(getDb(s.env.DB), "gi", "c", NOW); throw new Error("missing"); } };
    expect((await s.app.request(`/api/files/${ORIGINAL}`, undefined, s.env)).status).toBe(410);
  });
  it("selected server audio accepts browser frame completion without replacing its audio or changing generation", async () => {
    const s = await setup(); await s.prepare(s.env, "s"); s.addFrame(); const before = s.db.prepare("SELECT key FROM audio_tracks").all();
    const body = new FormData(); body.set("submissionId", "s"); body.set("frameCount", "1"); body.set("sampleRate", "16000"); body.set("durationS", "1"); body.set("audio", new Blob(["different browser audio"], { type: "audio/wav" }), "audio.wav");
    expect((await s.app.request("/api/public/upload/upload/audio", { method: "POST", body }, s.env)).status).toBe(201); expect(s.db.prepare("SELECT key FROM audio_tracks").all()).toEqual(before); expect(s.state()).toMatchObject({ generation: 1, frames_complete: 1 });
  });
  it("an already-open legacy client can complete existing nonzero frames without the new count/version fields", async () => {
    const s = await setup(); await s.prepare(s.env, "s"); s.addFrame(); const before = s.db.prepare("SELECT key FROM audio_tracks").all();
    const body = new FormData(); body.set("submissionId", "s"); body.set("sampleRate", "16000"); body.set("durationS", "1"); body.set("audio", new Blob(["legacy browser"], { type: "audio/wav" }), "audio.wav");
    expect((await s.app.request("/api/public/upload/upload/audio", { method: "POST", body }, s.env)).status).toBe(201);
    expect(s.state()).toMatchObject({ generation: 1, frames_complete: 1 }); expect(s.db.prepare("SELECT key FROM audio_tracks").all()).toEqual(before);
    expect(s.env.PIPELINE.send).toHaveBeenLastCalledWith(expect.objectContaining({ payload: { submissionId: "s", stages: ["detect"], requestId: "prepared-frames:1" } }));
  });
  it("a legacy browser finishing before server preparation carries its frame fence into the selected generation", async () => {
    const s = await setup(); s.addFrame();
    const body = new FormData(); body.set("submissionId", "s"); body.set("sampleRate", "16000"); body.set("durationS", "1"); body.set("audio", new Blob(["legacy browser first"], { type: "audio/wav" }), "audio.wav");
    expect((await s.app.request("/api/public/upload/upload/audio", { method: "POST", body }, s.env)).status).toBe(201); expect(s.state()).toMatchObject({ generation: 1, frames_complete: 1 });
    await s.prepare(s.env, "s"); expect(s.state()).toMatchObject({ generation: 2, frames_complete: 1 }); expect(await s.prepare(s.env, "s")).toBe("ready");
  });
  it("zero-frame legacy and versioned incomplete extraction never become frame-complete", async () => {
    for (const versioned of [false, true]) {
      const s = await setup(); await s.prepare(s.env, "s"); if (versioned) s.addFrame();
      const body = new FormData(); body.set("submissionId", "s"); body.set("sampleRate", "16000"); body.set("durationS", "1"); body.set("audio", new Blob(["browser"], { type: "audio/wav" }), "audio.wav"); if (versioned) body.set("frameHandshakeVersion", "1");
      expect((await s.app.request("/api/public/upload/upload/audio", { method: "POST", body }, s.env)).status).toBe(201); expect(s.state().frames_complete).toBe(0);
    }
  });
  it("preparation retires a replaced browser-managed WAV and preserves the new selected artifacts", async () => {
    const s = await setup(); const body = new FormData(); body.set("submissionId", "s"); body.set("sampleRate", "16000"); body.set("durationS", "1"); body.set("audio", new Blob(["browser first"], { type: "audio/wav" }), "audio.wav");
    expect((await s.app.request("/api/public/upload/upload/audio", { method: "POST", body }, s.env)).status).toBe(201);
    const old = String(s.db.prepare("SELECT key FROM audio_tracks").all()[0]!.key); await s.prepare(s.env, "s");
    expect(s.db.prepare("SELECT retired_at IS NOT NULL AS retired FROM media_purge_objects WHERE key=?").all(old)).toEqual([{ retired: 1 }]);
    await cleanupRetiredAudio(s.env, getDb(s.env.DB)); expect(s.objects.has(old)).toBe(false); expect(s.objects.size).toBe(3); expect(s.state().generation).toBe(2);
  });
  it("server selection winning after the browser lookup does not drop the browser's frame handshake", async () => {
    const s = await setup(); s.addFrame(); let entered!: () => void, resume!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; }), gate = new Promise<void>((resolve) => { resume = resolve; });
    s.hooks.beforeCommit = async () => { entered(); await gate; };
    const preparing = s.prepare(s.env, "s"); await waiting;
    s.hooks.afterRead = async (query) => { if (query.includes("SELECT p.* FROM media_preparations")) { s.hooks.afterRead = undefined; resume(); await preparing; } };
    const body = new FormData(); body.set("submissionId", "s"); body.set("frameCount", "1"); body.set("sampleRate", "16000"); body.set("durationS", "1"); body.set("audio", new Blob(["browser winner"], { type: "audio/wav" }), "audio.wav");
    expect((await s.app.request("/api/public/upload/upload/audio", { method: "POST", body }, s.env)).status).toBe(201);
    expect(s.state()).toMatchObject({ generation: 2, frames_complete: 1 }); expect(s.db.prepare("SELECT state FROM media_preparations").all()).toEqual([{ state: "retired" }]);
  });
  it("normal done detect is not reset by a late deterministic frame-complete message", async () => {
    const s = await setup(false); await s.prepare(s.env, "s"); s.addFrame(); await s.frameReceipt();
    await processSubmission({ submissionId: "s" }, s.env); const before = s.db.prepare("SELECT * FROM processing_jobs WHERE stage='detect'").all(); s.get.mockClear();
    await processSubmission({ submissionId: "s", stages: ["detect"], requestId: "prepared-frames:1" }, s.env);
    expect(s.db.prepare("SELECT * FROM processing_jobs WHERE stage='detect'").all()).toEqual(before); expect(s.get).not.toHaveBeenCalled(); expect(s.env.AI.run).not.toHaveBeenCalled();
  });
  it("frames arriving after the skip decision still wake one detect retry after the old claim finishes", async () => {
    const s = await setup(false); await s.prepare(s.env, "s"); s.db.prepare("UPDATE submissions SET uploaded_at=? WHERE id='s'").run(NOW - 240_000);
    let raced = false;
    s.hooks.afterRead = async (query) => {
      if (!raced && query.includes("SELECT 1 FROM submission_analysis a JOIN media_preparations")) {
        raced = true; s.hooks.afterRead = undefined; s.addFrame(); expect((await s.frameReceipt()).status).toBe(200);
      }
    };
    await processSubmission({ submissionId: "s" }, s.env); expect(raced).toBe(true);
    expect(s.db.prepare("SELECT status,error FROM processing_jobs WHERE stage='detect'").all()).toEqual([{ status: "skipped", error: "frames_unavailable" }]);
    await processSubmission({ submissionId: "s", stages: ["detect"], requestId: "prepared-frames:1" }, s.env);
    expect(s.db.prepare("SELECT status FROM processing_jobs WHERE stage='detect'").all()).toEqual([{ status: "done" }]); const reads = s.get.mock.calls.length;
    await processSubmission({ submissionId: "s", stages: ["detect"], requestId: "prepared-frames:1" }, s.env); expect(s.get.mock.calls.length).toBe(reads);
  });
  it("source polling and the failed final-check cleanup keep the entire preparation below 50 physical SQL", async () => {
    const s = await setup();
    s.hooks.polls = async (permit, job) => { for (let elapsed = 0; elapsed <= 220_000; elapsed += 20_000) { vi.mocked(Date.now).mockReturnValue(NOW + elapsed); await permit.assertCurrent(job); await permit.assertCurrent(job); } };
    await s.prepare(s.env, "s"); expect(s.state().generation).toBe(0); expect(s.objects.size).toBe(1);
    expect(s.metrics().physical).toBeLessThanOrEqual(50); expect(s.metrics().maxBinds).toBeLessThanOrEqual(100); expect(s.metrics().maxBytes).toBeLessThan(100_000);
    expect(await s.prepare(s.env, "s")).toBe("original"); expect(s.service.prepare).toHaveBeenCalledOnce();
  });
  it("the worst allowed permit count plus failed native selection and compensation stays under 50 SQL", async () => {
    const s = await setup(); s.hooks.polls = async (permit, job) => { for (let elapsed = 20_000; elapsed <= 200_000; elapsed += 20_000) { vi.mocked(Date.now).mockReturnValue(NOW + elapsed); await permit.assertCurrent(job); } };
    s.hooks.beforeCommit = async () => { s.db.exec("DELETE FROM media_purge_objects WHERE key LIKE 'prepared/%'"); };
    await s.prepare(s.env, "s"); expect(s.state().generation).toBe(0); expect(s.objects.size).toBe(1); expect(s.metrics().physical).toBeLessThanOrEqual(50);
  });
  it("an unreachable service times out once then yields to the original path", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); const s = await setup(); let release!: () => void;
    s.hooks.delayService = new Promise<void>((resolve) => { release = resolve; });
    const pending = s.prepare(s.env, "s");
    while (!s.service.prepare.mock.calls.length) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(240_001); expect(await pending).toBe("yield"); expect(await s.prepare(s.env, "s")).toBe("original");
    expect(s.service.prepare).toHaveBeenCalledOnce(); expect(s.service.cancel).toHaveBeenCalledExactlyOnceWith(s.service.prepare.mock.calls[0]![0].jobId); release(); await Promise.resolve();
  });
  it("expiry retires the attempt before a late PUT can publish, and its tombstone deletes a resurrection", async () => {
    const s = await setup(); let entered!: () => void, resume!: () => void, held = "";
    const waiting = new Promise<void>((resolve) => { entered = resolve; }), gate = new Promise<void>((resolve) => { resume = resolve; });
    s.hooks.put = async (key) => { if (!held) { held = key; entered(); await gate; } };
    const pending = s.prepare(s.env, "s"); await waiting; vi.mocked(Date.now).mockReturnValue(NOW + 240_001);
    await cleanupRetiredAudio(s.env, getDb(s.env.DB)); resume(); await pending;
    expect(s.service.cancel).toHaveBeenCalledExactlyOnceWith(s.service.prepare.mock.calls[0]![0].jobId);
    expect(s.state().generation).toBe(0); expect(s.objects.has(held)).toBe(false);
    s.objects.set(held, { bytes: encoder.encode("late"), etag: "late" }); await cleanupRetiredAudio(s.env, getDb(s.env.DB)); expect(s.objects.has(held)).toBe(false);
  });
  it("source wrappers stay byte-oriented and only explicit checks touch authority", async () => {
    let complete = false; const check = vi.fn(async () => {}), wrapped = boundedMediaStream(bytesStream(encoder.encode("bytes")), 5, 5, check, () => { complete = true; });
    const reader = wrapped.getReader({ mode: "byob" }); expect((await reader.read(new Uint8Array(5))).value?.byteLength).toBe(5); await reader.cancel(); expect(complete).toBe(false);
  });
});
