/** Native ctx.container API, pinned workers-types 5.20261014.1; no SDK dependency.
 * No HTTP server/proxy, bucket binding, secret or arbitrary command execution.
 * RPC disconnect is NOT an abort signal: explicit cancel + watchdog/alarm own it.
 */
import { BoundedByteReader } from "./byte-reader.ts";
export type Job = { jobId: string; generation: number; consentId: string; sourceEtag: string; declaredBytes: number };
export type Gate = { check(): Promise<void>; force(): Promise<void>; cancel(): void };
type Runtime = Pick<Container, "running" | "images" | "start" | "exec" | "destroy" | "signal" | "setInactivityTimeout">;
type Limits = { totalMs?: number; idleMs?: number; graceMs?: number; cleanupMs?: number };
type Phase = "startup" | "input" | "compute" | "output";
type Diagnostic = { event: "start_requested" | "exec_ready" | "input_eof" | "manifest" | "completed" | "abort";
  phase: Phase; elapsedMs: number; inputBytes: number; code?: string };
type Options = Limits & { log?: (record: Diagnostic) => void };
type Artifact = { name: "audio.wav" | "video.mp4"; bytes: number };
const CHUNK = 1024 ** 2;
const error = (code: string) => new Error(code);
const DIAGNOSTIC_CODES = new Set(["job_timeout", "stream_idle_timeout", "permit_revoked", "job_cancelled",
  "container_image_missing", "job_header_limit", "input_incomplete", "input_chunk_limit", "input_size_limit",
  "input_transfer_failed", "input_cancelled", "process_streams_missing", "process_stderr_limit", "process_failed",
  "protocol_output_incomplete", "protocol_output_chunk_limit", "protocol_output_frame_limit", "protocol_output_trailing",
  "protocol_manifest_invalid", "output_order_invalid", "output_size_limit", "output_incomplete", "output_transfer_failed",
  "container_cleanup_unknown", "container_preparation_failed"]);
function diagnosticCode(cause: unknown, fallback: string) {
  return cause instanceof Error && DIAGNOSTIC_CODES.has(cause.message) ? cause.message : fallback;
}
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => {}); return { promise, resolve, reject };
}
function frame(bytes: Uint8Array) {
  const result = new Uint8Array(bytes.byteLength + 4);
  new DataView(result.buffer).setUint32(0, bytes.byteLength); result.set(bytes, 4); return result;
}
class Frames {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private bytes: Uint8Array<ArrayBufferLike> = new Uint8Array(0); private offset = 0;
  private wait: <T>(p: Promise<T>) => Promise<T>; private touch: () => void;
  constructor(source: ReadableStream<Uint8Array>, wait: <T>(p: Promise<T>) => Promise<T>, touch: () => void) { this.reader = source.getReader(); this.wait = wait; this.touch = touch; }
  async exact(size: number) {
    const result = new Uint8Array(size); let copied = 0;
    while (copied < size) {
      if (this.offset === this.bytes.byteLength) {
        const item = await this.wait(this.reader.read());
        if (item.done) throw error("protocol_output_incomplete");
        if (!(item.value instanceof Uint8Array) || item.value.byteLength > 2 * CHUNK) throw error("protocol_output_chunk_limit");
        this.bytes = item.value; this.offset = 0; this.touch();
      }
      const count = Math.min(size - copied, this.bytes.byteLength - this.offset);
      result.set(this.bytes.subarray(this.offset, this.offset + count), copied); this.offset += count; copied += count;
    }
    return result;
  }
  async frame(cap: number) {
    const head = await this.exact(4), size = new DataView(head.buffer).getUint32(0);
    if (size > cap) throw error("protocol_output_frame_limit");
    return this.exact(size);
  }
  async eof() {
    if (this.offset !== this.bytes.byteLength || !(await this.wait(this.reader.read())).done) throw error("protocol_output_trailing");
    this.reader.releaseLock();
  }
  cancel() { void this.reader.cancel().catch(() => {}); }
}
function header(bytes: Uint8Array): { manifest: Record<string, unknown>; artifacts: Artifact[] } {
  const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!raw || typeof raw !== "object" || !("artifacts" in raw) || !Array.isArray(raw.artifacts) || raw.artifacts.length < 1 || raw.artifacts.length > 2) throw error("protocol_manifest_invalid");
  const seen = new Set<string>(), artifacts: Artifact[] = [];
  for (const item of raw.artifacts) {
    if (!item || typeof item !== "object" || !["audio.wav", "video.mp4"].includes(item.name) || seen.has(item.name) || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || item.bytes > (item.name === "audio.wav" ? 6 : 64) * CHUNK) throw error("protocol_manifest_invalid");
    seen.add(item.name); artifacts.push({ name: item.name, bytes: item.bytes });
  }
  // Object shape checked above; full media manifest is independently validated
  // by private-rpc before the app receives any artifact stream.
  return { manifest: raw as Record<string, unknown>, artifacts };
}

type Active = { job: Job; gate: Gate; aborted: ReturnType<typeof deferred<never>>; finished: ReturnType<typeof deferred<void>>;
  process?: ExecProcess; exited: boolean; startedAt: number; inputBytes: number; abortLogged?: boolean;
  lastIO: number; phase: Phase; stopping: boolean; frames?: Frames;
  cancelInput?: () => void; cancelStderr?: () => void; stop?: Promise<void>; timer?: ReturnType<typeof setTimeout>; heartbeat?: ReturnType<typeof setInterval> };
export class ContainerTransport {
  private active: Active | null = null;
  private limits: Required<Limits>;
  private runtime: Runtime;
  private log: (record: Diagnostic) => void;
  constructor(runtime: Runtime, options: Options = {}) {
    this.runtime = runtime;
    this.limits = { totalMs: options.totalMs ?? 240000, idleMs: options.idleMs ?? 15000, graceMs: options.graceMs ?? 250, cleanupMs: options.cleanupMs ?? 3000 };
    this.log = options.log ?? (record => console.log("media_preparation_phase", JSON.stringify(record)));
  }
  private record(a: Active, event: Diagnostic["event"], code?: string) {
    const record: Diagnostic = { event, phase: a.phase, elapsedMs: Math.max(0, Date.now() - a.startedAt), inputBytes: a.inputBytes };
    if (code) record.code = DIAGNOSTIC_CODES.has(code) ? code : "container_preparation_failed";
    // Logging is observational. Never pass errors, job identities, wire bytes,
    // paths, image references, manifests or stderr to a logging API.
    try { this.log(record); } catch { /* A log sink must not change processing. */ }
  }
  private abort(a: Active, code: string) {
    if (!a.abortLogged) { a.abortLogged = true; this.record(a, "abort", code); }
    a.gate.cancel(); a.aborted.reject(error(code)); a.finished.reject(error(code));
    if (a.stopping) return;
    void this.stop(a, true).catch(() => {});
  }
  private stop(a: Active, failed: boolean): Promise<void> {
    if (a.stop) return a.stop;
    a.stopping = true; clearTimeout(a.timer); clearInterval(a.heartbeat);
    a.cancelInput?.(); a.frames?.cancel(); a.cancelStderr?.();
    a.stop = (async () => {
      if (failed && a.process && !a.exited) {
        // Exec kill only reaches Python, not FFmpeg children. Always stop the
        // entire container below; never leave a child/old job across reuse.
        try { a.process.kill(15); } catch { /* Exit may have just won. */ }
        await Promise.race([a.process.exitCode.catch(() => -1), pause(this.limits.graceMs)]);
        if (!a.exited) { try { this.runtime.signal(9); } catch { /* destroy still required */ } }
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([this.runtime.destroy(), new Promise<never>((_, no) => { timer = setTimeout(() => no(error("container_cleanup_unknown")), this.limits.cleanupMs); })]);
        if (this.active === a) this.active = null;
      } finally { clearTimeout(timer); }
      // If destroy fails/times out active remains blocked. Cached failed cleanup
      // is NOT an automatic retry; DO recreation/recovery must destroy the orphan.
      // Never start a second job against uncertain old state.
    })();
    return a.stop;
  }
  async cancel(jobId: string) {
    const a = this.active;
    if (!a || a.job.jobId !== jobId) return;
    if (!a.abortLogged) { a.abortLogged = true; this.record(a, "abort", "job_cancelled"); }
    a.gate.cancel(); a.aborted.reject(error("job_cancelled")); a.finished.reject(error("job_cancelled"));
    return this.stop(a, true);
  }
  async run(job: Job, source: ReadableStream<Uint8Array>, gate: Gate) {
    if (this.active) throw error("container_busy");
    const now = Date.now();
    const a: Active = { job, gate, aborted: deferred<never>(), finished: deferred<void>(), exited: false,
      startedAt: now, inputBytes: 0, lastIO: now, phase: "startup", stopping: false };
    this.active = a;
    const touch = () => { a.lastIO = Date.now(); };
    const wait = <T>(p: Promise<T>) => Promise.race([p, a.aborted.promise]);
    a.timer = setTimeout(() => this.abort(a, "job_timeout"), this.limits.totalMs);
    let polling = false;
    a.heartbeat = setInterval(() => {
      if (a.stopping) return;
      if (a.phase !== "compute" && Date.now() - a.lastIO > this.limits.idleMs) { this.abort(a, "stream_idle_timeout"); return; }
      if (!polling) { polling = true; void gate.check().catch(() => this.abort(a, "permit_revoked")).finally(() => { polling = false; }); }
    }, Math.min(1000, Math.max(5, this.limits.idleMs / 2)));
    try {
      const image = this.runtime.images.base;
      if (!image) throw error("container_image_missing");
      if (this.runtime.running) await wait(this.runtime.destroy());
      this.record(a, "start_requested");
      this.runtime.start({ image, instance: "standard-2", enableInternet: false, entrypoint: ["sleep", "infinity"], env: {} });
      // Native exec's effect on inactivity is not specified. Never use a short
      // idle window during compute; explicit destroy/alarm bound the whole job.
      await wait(this.runtime.setInactivityTimeout(this.limits.totalMs + this.limits.cleanupMs + 5000));
      const reader = new BoundedByteReader(source); let first = true, ended = false, sent = 0;
      a.cancelInput = () => { void reader.cancel().catch(() => {}); };
      const input = new ReadableStream<Uint8Array>({ type: "bytes", pull: async controller => {
        try {
          if (first) { first = false; const meta = new TextEncoder().encode(JSON.stringify(job)); if (meta.byteLength > 4096) throw error("job_header_limit"); controller.enqueue(frame(meta)); return; }
          a.phase = "input";
          const part = await reader.read(Math.max(1, Math.min(CHUNK, job.declaredBytes - sent)), gate.check, wait); touch();
          if (part.done) { if (sent !== job.declaredBytes) throw error("input_incomplete"); ended = true; a.phase = "compute"; reader.releaseLock(); controller.enqueue(frame(new Uint8Array())); controller.close(); if ("byobRequest" in controller) controller.byobRequest?.respond(0); this.record(a, "input_eof"); return; }
          if (!(part.value instanceof Uint8Array) || part.value.byteLength > CHUNK) throw error("input_chunk_limit");
          sent += part.value.byteLength;
          if (sent > job.declaredBytes || sent > 2 * 1024 ** 3) throw error("input_size_limit");
          a.inputBytes = sent;
          controller.enqueue(frame(part.value));
        } catch (cause) { controller.error(error("input_transfer_failed")); this.abort(a, diagnosticCode(cause, "input_transfer_failed")); }
      }, cancel: () => { this.abort(a, "input_cancelled"); } });
      a.process = await wait(this.runtime.exec(["python3", "/app/protocol.py"], { stdin: input, stdout: "pipe", stderr: "pipe", cwd: "/work", env: { TMPDIR: "/work", PYTHONDONTWRITEBYTECODE: "1" }, user: "65532:65532" }));
      this.record(a, "exec_ready");
      const process = a.process;
      void process.exitCode.then(() => { a.exited = true; }, () => { a.exited = true; });
      if (!process.stdout || !process.stderr) throw error("process_streams_missing");
      const stderr = (async () => { let size = 0; const r = process.stderr!.getReader(); a.cancelStderr = () => { void r.cancel().catch(() => {}); }; try { while (true) { const item = await wait(r.read()); if (item.done) break; size += item.value.byteLength; if (size > 65536) throw error("process_stderr_limit"); } } finally { r.releaseLock(); } })();
      void stderr.catch(() => this.abort(a, "process_stderr_limit"));
      a.frames = new Frames(process.stdout, wait, touch);
      const parsed = header(await a.frames.frame(16384));
      a.phase = "output"; touch();
      if (!ended) throw error("input_incomplete");
      this.record(a, "manifest");
      const outputs: Record<string, ReadableStream<Uint8Array>> = {}; let next = 0;
      for (const [index, item] of parsed.artifacts.entries()) {
        let total = 0;
        outputs[item.name] = new ReadableStream<Uint8Array>({ type: "bytes", pull: async controller => {
          try {
            if (index !== next) throw error("output_order_invalid");
            const bytes = await a.frames!.frame(CHUNK);
            if (bytes.byteLength) { total += bytes.byteLength; if (total > item.bytes) throw error("output_size_limit"); controller.enqueue(bytes); return; }
            if (total !== item.bytes) throw error("output_incomplete");
            next++;
            if (next === parsed.artifacts.length) {
              await a.frames!.frame(0); await a.frames!.eof(); await wait(stderr);
              if (await wait(process.exitCode) !== 0) throw error("process_failed");
              await this.stop(a, false); this.record(a, "completed"); a.finished.resolve();
            }
            // Last output never closes until footer+stdout EOF+stderr+exit0 and
            // whole-container teardown are known. A manifest is not completion.
            controller.close(); if ("byobRequest" in controller) controller.byobRequest?.respond(0);
          } catch (cause) { this.abort(a, diagnosticCode(cause, "output_transfer_failed")); controller.error(error("output_transfer_failed")); }
        }, cancel: async () => { await this.cancel(job.jobId); } });
      }
      return { manifest: parsed.manifest, outputs, finished: a.finished.promise };
    } catch (cause) { this.abort(a, diagnosticCode(cause, "container_preparation_failed")); await this.stop(a, true).catch(() => {}); throw error("container_preparation_failed"); }
  }
}
