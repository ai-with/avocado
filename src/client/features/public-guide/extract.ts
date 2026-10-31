// 브라우저에서 영상의 프레임과 오디오를 뽑는다 (F-60 일부를 클라이언트로 옮김)
import { frameTargets, sceneChanged, sceneSample, validateFrameDuration, validateFrameLimit, type SceneSample } from "./frame-scenes";
import type { AudioExtraction } from "../../../shared/audio-analysis";
import { probeAudioTracks } from "./audio-probe";

export type VideoMeta = { durationS: number; width: number; height: number };
export type FrameShot = { tMs: number; source: "fps" | "scene"; blob: Blob };
export const VIDEO_LOAD_TIMEOUT_MS = 30_000, FRAME_STEP_TIMEOUT_MS = 10_000;

function release(v: HTMLVideoElement, url = v.src) {
  v.onloadeddata = null; v.onseeked = null; v.onerror = null;
  try { v.pause(); v.removeAttribute("src"); v.load(); } catch { /* still revoke the blob URL if decoder cleanup fails */ }
  URL.revokeObjectURL(url);
}

function loadVideo(file: File): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    const url = URL.createObjectURL(file); let done = false;
    const finish = (reason?: string) => {
      if (done) return; done = true; clearTimeout(timer); v.onloadeddata = null; v.onerror = null;
      if (reason) { release(v, url); reject(new Error(reason)); } else resolve(v);
    };
    const timer = setTimeout(() => finish("video_load_timeout"), VIDEO_LOAD_TIMEOUT_MS);
    v.onloadeddata = () => finish();
    v.onerror = () => finish("video_load_failed");
    try { v.src = url; } catch { finish("video_load_failed"); }
  });
}

export async function readVideoMeta(file: File): Promise<VideoMeta> {
  const v = await loadVideo(file);
  const meta = { durationS: v.duration, width: v.videoWidth, height: v.videoHeight };
  release(v);
  return meta;
}

function seek(v: HTMLVideoElement, t: number): Promise<void> {
  if (v.error) return Promise.reject(new Error("video_seek_failed"));
  if (!v.seeking && v.readyState >= 2 && Math.abs(v.currentTime - t) < 0.000001) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (reason?: string) => { if (done) return; done = true; clearTimeout(timer); v.onseeked = null; v.onerror = null; reason ? reject(new Error(reason)) : resolve(); };
    const timer = setTimeout(() => finish("video_seek_timeout"), FRAME_STEP_TIMEOUT_MS);
    v.onseeked = () => finish(); v.onerror = () => finish("video_seek_failed");
    try { v.currentTime = t; } catch { finish("video_seek_failed"); }
  });
}

const toJpeg = (c: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => {
  let done = false;
  const finish = (blob?: Blob | null) => { if (done) return; done = true; clearTimeout(timer); blob ? resolve(blob) : reject(new Error("frame_encode_failed")); };
  const timer = setTimeout(() => finish(), FRAME_STEP_TIMEOUT_MS);
  try { c.toBlob(finish, "image/jpeg", 0.8); } catch { finish(); }
});

const STEP_S = 0.5;
const SMALL = 32;

// 1초 간격 + 장면 전환 프레임의 합집합. 긴 변 720px, 품질 0.8, 상한 max 장
export async function extractFrames(file: File, max: number, onProgress?: (ratio: number) => void): Promise<FrameShot[]> {
  validateFrameLimit(max);
  if (!max) { onProgress?.(1); return []; }
  const v = await loadVideo(file);
  try {
    validateFrameDuration(v.duration);
    if (!v.duration) { onProgress?.(1); return []; }
    if (!(v.videoWidth > 0 && v.videoHeight > 0 && Number.isFinite(v.videoWidth) && Number.isFinite(v.videoHeight))) throw new Error("video_metadata_invalid");
    const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
    const big = document.createElement("canvas");
    big.width = Math.round(v.videoWidth * scale);
    big.height = Math.round(v.videoHeight * scale);
    const small = document.createElement("canvas");
    small.width = small.height = SMALL;
    const bctx = big.getContext("2d");
    const sctx = small.getContext("2d", { willReadFrequently: true });
    if (!bctx || !sctx) throw new Error("frame_canvas_unavailable");

    const cuts: number[] = [];
    let prev: SceneSample | null = null;
    const end = v.duration;
    const at = (t: number) => Math.max(0, Math.min(Math.max(0.01, t), Math.max(0, end - 0.05)));
    // Pass 1 retains at most max timestamps and one previous small sample.
    for (let t = 0; t < end; t += STEP_S) {
      await seek(v, at(t));
      sctx.drawImage(v, 0, 0, SMALL, SMALL);
      const px = sctx.getImageData(0, 0, SMALL, SMALL).data;
      const current = sceneSample(px), changed = sceneChanged(current, prev); prev = current;
      if (changed && cuts.length < max) cuts.push(Math.round(t * 1000));
      onProgress?.(0.8 * t / end);
    }
    const targets = frameTargets(end, max, cuts), shots: FrameShot[] = [];
    // Pass 2 encodes only the selected union, rather than every 1fps/scene candidate.
    for (const [index, target] of targets.entries()) {
      await seek(v, at(target.tMs / 1000)); bctx.drawImage(v, 0, 0, big.width, big.height);
      shots.push({ tMs: target.tMs, source: target.source, blob: await toJpeg(big) });
      onProgress?.(0.8 + 0.2 * (index + 1) / targets.length);
    }
    return shots;
  } finally { release(v); }
}

const MAX_AUDIO_DECODE_BYTES = 500 * 1024 ** 2;

// 16kHz mono WAV. Decode failure/size limits are not evidence of no audio.
export async function extractAudioWav(file: File): Promise<AudioExtraction> {
  const probe = await probeAudioTracks(file);
  if (probe.kind === "no_audio") return probe;
  if (file.size > MAX_AUDIO_DECODE_BYTES) return probe.kind === "unavailable" && probe.reason === "probe_limit" ? probe : { kind: "unavailable", reason: "decode_limit" };
  const rate = 16000;
  let decoded: AudioBuffer;
  try {
    decoded = await new OfflineAudioContext(1, 1, rate).decodeAudioData(await file.arrayBuffer());
  } catch {
    return { kind: "unavailable", reason: probe.kind === "unavailable" ? probe.reason : "decode_failed" };
  }
  const n = decoded.length;
  const mono = new Float32Array(n);
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    const data = decoded.getChannelData(ch);
    for (let i = 0; i < n; i++) mono[i]! += data[i]! / decoded.numberOfChannels;
  }
  return { kind: "audio", blob: encodeWav(mono, decoded.sampleRate), sampleRate: decoded.sampleRate, durationS: decoded.duration };
}

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const dv = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => dv.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  dv.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  str(36, "data");
  dv.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}
