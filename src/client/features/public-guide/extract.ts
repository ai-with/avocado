// 브라우저에서 영상의 프레임과 오디오를 뽑는다 (F-60 일부를 클라이언트로 옮김)

export type VideoMeta = { durationS: number; width: number; height: number };
export type FrameShot = { tMs: number; source: "fps" | "scene"; blob: Blob };

function loadVideo(file: File): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error("video_load_failed"));
    v.src = URL.createObjectURL(file);
  });
}
const release = (v: HTMLVideoElement) => URL.revokeObjectURL(v.src);

export async function readVideoMeta(file: File): Promise<VideoMeta> {
  const v = await loadVideo(file);
  const meta = { durationS: v.duration, width: v.videoWidth, height: v.videoHeight };
  release(v);
  return meta;
}

function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    v.onseeked = () => resolve();
    v.currentTime = t;
  });
}

const toJpeg = (c: HTMLCanvasElement) => new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/jpeg", 0.8));

const STEP_S = 0.5;
const SMALL = 32;
// ponytail: 32x32 흑백 평균 픽셀 차이로 장면 전환을 어림한다. 0.5초 간격이라 빠른 컷은 놓치고,
// 조명만 바뀌어도 걸릴 수 있다. 정확도가 필요하면 서버 ffmpeg select='gt(scene,0.4)' 로 옮긴다
const SCENE_THRESHOLD = 30;

// 직전 프레임과의 흑백 평균 픽셀 차이. 첫 프레임이면 0
function lumaDiff(px: Uint8ClampedArray, prev: Uint8ClampedArray | null): number {
  let diff = 0;
  if (prev) {
    for (let i = 0; i < px.length; i += 4) diff += Math.abs(px[i]! * 0.3 + px[i + 1]! * 0.59 + px[i + 2]! * 0.11 - (prev[i]! * 0.3 + prev[i + 1]! * 0.59 + prev[i + 2]! * 0.11));
    diff /= SMALL * SMALL;
  }
  return diff;
}

// 1초 간격 + 장면 전환 프레임의 합집합. 긴 변 720px, 품질 0.8, 상한 max 장
export async function extractFrames(file: File, max: number, onProgress?: (ratio: number) => void): Promise<FrameShot[]> {
  const v = await loadVideo(file);
  const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
  const big = document.createElement("canvas");
  big.width = Math.round(v.videoWidth * scale);
  big.height = Math.round(v.videoHeight * scale);
  const small = document.createElement("canvas");
  small.width = small.height = SMALL;
  const bctx = big.getContext("2d")!;
  const sctx = small.getContext("2d", { willReadFrequently: true })!;

  const fps: FrameShot[] = [];
  const scene: FrameShot[] = [];
  let prev: Uint8ClampedArray | null = null;
  const end = v.duration;
  for (let t = 0; t < end; t += STEP_S) {
    await seek(v, Math.max(0.01, Math.min(t, end - 0.05)));
    sctx.drawImage(v, 0, 0, SMALL, SMALL);
    const px = sctx.getImageData(0, 0, SMALL, SMALL).data;
    const diff = lumaDiff(px, prev);
    prev = px;
    const onSecond = Number.isInteger(t);
    if (onSecond || diff > SCENE_THRESHOLD) {
      bctx.drawImage(v, 0, 0, big.width, big.height);
      const blob = await toJpeg(big);
      if (blob) (onSecond ? fps : scene).push({ tMs: Math.round(t * 1000), source: onSecond ? "fps" : "scene", blob });
    }
    onProgress?.(t / end);
  }
  release(v);

  // 상한을 넘으면 장면 전환은 남기고 1초 간격 프레임을 고르게 솎는다
  const keepScene = scene.slice(0, max);
  const budget = max - keepScene.length;
  const stride = budget > 0 ? Math.ceil(fps.length / budget) : Infinity;
  const keepFps = fps.filter((_, i) => i % stride === 0).slice(0, budget);
  return [...keepFps, ...keepScene].sort((a, b) => a.tMs - b.tMs);
}

const MAX_AUDIO_DECODE_BYTES = 500 * 1024 ** 2;

// 16kHz mono WAV. 오디오 트랙이 없거나 너무 큰 파일이면 null
export async function extractAudioWav(file: File): Promise<{ blob: Blob; sampleRate: number; durationS: number } | null> {
  // ponytail: 파일 전체를 메모리에 읽어 디코딩한다. 500MB 넘으면 건너뛰고 서버 처리에 맡긴다
  if (file.size > MAX_AUDIO_DECODE_BYTES) return null;
  const rate = 16000;
  let decoded: AudioBuffer;
  try {
    decoded = await new OfflineAudioContext(1, 1, rate).decodeAudioData(await file.arrayBuffer());
  } catch {
    return null;
  }
  const n = decoded.length;
  const mono = new Float32Array(n);
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    const data = decoded.getChannelData(ch);
    for (let i = 0; i < n; i++) mono[i]! += data[i]! / decoded.numberOfChannels;
  }
  return { blob: encodeWav(mono, decoded.sampleRate), sampleRate: decoded.sampleRate, durationS: decoded.duration };
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
