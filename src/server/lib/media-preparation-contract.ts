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

// Count and cap without buffering or hashing a video in the Worker.
export function boundedMediaStream(source: ReadableStream<Uint8Array>, expected: number, cap: number, check: () => Promise<void>, complete: () => void) {
  const reader = source.getReader(); let bytes = 0;
  return new ReadableStream({ type: "bytes",
    async pull(controller) {
      try {
        await check(); const item = await reader.read();
        if (item.done) { if (bytes !== expected) throw preparationError(); complete(); reader.releaseLock(); controller.close(); return; }
        if (!(item.value instanceof Uint8Array) || item.value.byteLength > PREPARATION_CAPS.chunkBytes) throw preparationError();
        bytes += item.value.byteLength; if (bytes > expected || bytes > cap) throw preparationError(); controller.enqueue(item.value);
      } catch { await reader.cancel().catch(() => {}); controller.error(preparationError()); }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}
