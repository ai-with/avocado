// Mirrored from the private POC contract. No URL/key/token is a service input.
export const PREPARATION_CAPS = Object.freeze({ inputBytes: 2 * 1024 ** 3, durationS: 180, videoBytes: 64 * 1024 ** 2, audioBytes: 6 * 1024 ** 2, chunkBytes: 1024 ** 2 });
export type PreparationJob = { jobId: string; generation: number; consentId: string; sourceEtag: string; declaredBytes: number };
export type ArtifactName = "audio.wav" | "video.mp4";
export type PreparedArtifact = { name: ArtifactName; bytes: number; sha256: string };
export type PreparationManifest = { v: 1; generation: number; consentId: string; sourceEtag: string; inputBytes: number; inputSha256: string; durationS: number;
  audio: { state: "present"; sampleRate: 16000; durationS: number } | { state: "none"; proof: "complete_probe_and_video_decode_no_audio" }; artifacts: PreparedArtifact[] };
export type PreparationPermit = { assertCurrent(job: PreparationJob): Promise<void> };
export type PreparationSink = { stage(name: ArtifactName, stream: ReadableStream<Uint8Array>, metadata: PreparedArtifact): Promise<void>; commit(manifest: PreparationManifest): Promise<void>; retireUnselected(): Promise<void> };
export type PreparationResult = PreparationManifest | { status: "busy" };
export type MediaPreparationService = { prepare(job: PreparationJob, source: ReadableStream<Uint8Array>, permit: PreparationPermit, sink: PreparationSink): Promise<PreparationResult>; cancel?(jobId: string): Promise<void> };
export const preparationError = () => new Error("media_preparation_unavailable");
export function managedPreparedKey(submissionId: string, key: string) {
  return /^[\w-]+$/.test(submissionId) && new RegExp(`^prepared/${submissionId}/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/video\\.mp4$`).test(key);
}
const HASH = /^[a-f0-9]{64}$/;
export function validateArtifact(value: PreparedArtifact): void {
  const cap = value?.name === "video.mp4" ? PREPARATION_CAPS.videoBytes : value?.name === "audio.wav" ? PREPARATION_CAPS.audioBytes : 0;
  if (!cap || !Number.isSafeInteger(value.bytes) || value.bytes <= 0 || value.bytes > cap || !HASH.test(value.sha256)) throw preparationError();
}
export function validateManifest(value: PreparationManifest, job: PreparationJob): void {
  if (!value || value.v !== 1 || value.generation !== job.generation || value.consentId !== job.consentId || value.sourceEtag !== job.sourceEtag
    || value.inputBytes !== job.declaredBytes || !HASH.test(value.inputSha256) || !Number.isFinite(value.durationS) || value.durationS <= 0 || value.durationS > PREPARATION_CAPS.durationS) throw preparationError();
  const audio = value.audio;
  if (!audio || (audio.state !== "present" && audio.state !== "none")) throw preparationError();
  if (audio.state === "none" && audio.proof !== "complete_probe_and_video_decode_no_audio") throw preparationError();
  if (audio.state === "present" && (audio.sampleRate !== 16000 || !Number.isFinite(audio.durationS) || audio.durationS <= 0 || audio.durationS > PREPARATION_CAPS.durationS + .1)) throw preparationError();
  const names = audio.state === "present" ? ["audio.wav", "video.mp4"] : ["video.mp4"];
  if (!Array.isArray(value.artifacts) || value.artifacts.length !== names.length || new Set(value.artifacts.map((a) => a.name)).size !== names.length) throw preparationError();
  for (const artifact of value.artifacts) { validateArtifact(artifact); if (!names.includes(artifact.name)) throw preparationError(); }
}

// Native BYOB batches R2's small chunks before crossing RPC. Only one <=1 MiB
// output buffer (plus at most one bounded default-reader chunk) is retained.
export function boundedMediaStream(source: ReadableStream<Uint8Array>, expected: number, cap: number, check: () => Promise<void>, complete: () => void) {
  if (!Number.isSafeInteger(expected) || expected <= 0 || !Number.isSafeInteger(cap) || expected > cap) throw preparationError();
  let byob: ReadableStreamBYOBReader | undefined;
  try { byob = source.getReader({ mode: "byob" }); } catch { /* Non-byte test/adapter streams use bounded coalescing. */ }
  const reader = byob ?? source.getReader();
  type BatchReader = { read(view: Uint8Array, options: { min: number }): Promise<ReadableStreamReadResult<Uint8Array>>;
    readAtLeast?(minimum: number, view: Uint8Array): Promise<ReadableStreamReadResult<Uint8Array>> };
  const batchReader = byob as unknown as BatchReader | undefined;
  let bytes = 0, received = 0, cancelled = false, released = false, pending: Uint8Array | undefined;
  const release = () => { if (!released) { released = true; reader.releaseLock(); } };
  const cancel = async (reason?: unknown) => {
    cancelled = true; pending = undefined;
    try { if (!released) await reader.cancel(reason); } finally { release(); }
  };
  const read = (view: Uint8Array) => batchReader
    ? typeof batchReader.readAtLeast === "function" ? batchReader.readAtLeast(view.byteLength, view) : batchReader.read(view, { min: view.byteLength })
    : (reader as ReadableStreamDefaultReader<Uint8Array>).read();
  return new ReadableStream({ type: "bytes",
    async pull(controller) {
      try {
        if (cancelled) return;
        if (bytes === expected) {
          // Reading exactly the declared bytes does not prove EOF. Probe once
          // before setting the app's input-complete selection fence.
          await check(); const item = await read(new Uint8Array(1));
          if (cancelled) return;
          await check();
          const extra = (item.value as Uint8Array | undefined)?.byteLength ?? 0;
          if (!item.done || extra) throw preparationError();
          complete(); release(); controller.close(); controller.byobRequest?.respond(0); return;
        }
        const size = Math.min(PREPARATION_CAPS.chunkBytes, expected - bytes);
        let buffer: Uint8Array = new Uint8Array(size), filled = 0, ended = false;
        while (filled < size) {
          await check(); if (cancelled) return;
          if (!pending) {
            const item = await read(buffer.subarray(filled));
            if (cancelled) return;
            await check();
            const value = item.value;
            if (value !== undefined && (!(value instanceof Uint8Array) || value.byteLength > PREPARATION_CAPS.chunkBytes)) throw preparationError();
            const length = value?.byteLength ?? 0;
            received += length;
            if (received > expected || received > cap || !length && !item.done) throw preparationError();
            if (batchReader && length) {
              // BYOB transfers/detaches the supplied buffer. Recover its returned
              // view, including any prefix retained from a short read.
              const offset = value!.byteOffset - filled;
              if (offset < 0 || offset + size > value!.buffer.byteLength || length > size - filled) throw preparationError();
              buffer = new Uint8Array(value!.buffer, offset, size); filled += length;
            } else if (length) pending = value;
            if (item.done) ended = true;
            if (!length && item.done) break;
          }
          if (pending) {
            const take = Math.min(pending.byteLength, size - filled);
            buffer.set(pending.subarray(0, take), filled); filled += take;
            pending = take === pending.byteLength ? undefined : pending.subarray(take);
          }
          if (ended && filled < size) break;
        }
        if (filled !== size || cancelled) { if (cancelled) return; throw preparationError(); }
        bytes += filled; await check(); if (cancelled) return;
        controller.enqueue(buffer);
        if (ended) { if (bytes !== expected || pending) throw preparationError(); complete(); release(); controller.close(); controller.byobRequest?.respond(0); }
      } catch {
        if (!cancelled) { await cancel().catch(() => {}); controller.error(preparationError()); }
      }
    },
    cancel,
  });
}
