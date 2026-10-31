import { extractAudioWav, extractFrames } from "./extract";

const MAX_ATTEMPTS = 2;

// 실패해도 1회 다시 보낸다
async function postWithRetry(base: string, path: string, body: BodyInit, headers?: HeadersInit) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const ok = await fetch(`${base}/${path}`, { method: "POST", body, headers }).then((r) => r.ok, () => false);
    if (ok) return true;
  }
  return false;
}

async function sendFrames(base: string, submissionId: string, file: File, maxFrames: number, onProgress: (r: number) => void) {
  let failed = false;
  const shots = await extractFrames(file, maxFrames, (r) => onProgress(r * 0.5));
  for (const [i, s] of shots.entries()) {
    const form = new FormData();
    form.set("submissionId", submissionId);
    form.set("t_ms", String(s.tMs));
    form.set("source", s.source);
    form.set("image", s.blob, `${s.tMs}.jpg`);
    if (!(await postWithRetry(base, "frames", form))) failed = true;
    onProgress(0.5 + (0.45 * (i + 1)) / shots.length);
  }
  return { failed, count: shots.length };
}

async function sendAudio(base: string, submissionId: string, file: File, frames: { failed: boolean; count: number }): Promise<boolean> {
  const audio = await extractAudioWav(file);
  if (audio.kind !== "audio") {
    if (frames.failed || frames.count === 0) return true;
    const ok = await postWithRetry(base, "analysis-complete", JSON.stringify({ submissionId, frameCount: frames.count, outcome: audio }), { "Content-Type": "application/json" });
    return !ok || audio.kind === "unavailable";
  }
  const form = new FormData();
  form.set("submissionId", submissionId);
  form.set("sampleRate", String(audio.sampleRate));
  form.set("durationS", String(audio.durationS));
  form.set("audio", audio.blob, "audio.wav");
  return !(await postWithRetry(base, "audio", form));
}

// 프레임과 오디오를 순차 전송. 각 요청은 1회 재시도하고, 실패가 있으면 true
export async function sendAnalysis(base: string, submissionId: string, file: File, maxFrames: number, onProgress: (r: number) => void): Promise<boolean> {
  let failed = false;
  let frames = { failed: true, count: 0 };
  try {
    frames = await sendFrames(base, submissionId, file, maxFrames, onProgress);
    if (frames.failed) failed = true;
  } catch {
    failed = true;
  }
  try {
    if (await sendAudio(base, submissionId, file, frames)) failed = true;
  } catch {
    failed = true;
  }
  onProgress(1);
  return failed;
}
