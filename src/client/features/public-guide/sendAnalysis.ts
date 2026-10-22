import { extractAudioWav, extractFrames } from "./extract";

const MAX_ATTEMPTS = 2;

// 실패해도 1회 다시 보낸다
async function postWithRetry(base: string, path: string, form: FormData) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const ok = await fetch(`${base}/${path}`, { method: "POST", body: form }).then((r) => r.ok, () => false);
    if (ok) return true;
  }
  return false;
}

async function sendFrames(base: string, submissionId: string, file: File, maxFrames: number, onProgress: (r: number) => void): Promise<boolean> {
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
  return failed;
}

async function sendAudio(base: string, submissionId: string, file: File): Promise<boolean> {
  const audio = await extractAudioWav(file);
  if (!audio) return false;
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
  try {
    if (await sendFrames(base, submissionId, file, maxFrames, onProgress)) failed = true;
  } catch {
    failed = true;
  }
  try {
    if (await sendAudio(base, submissionId, file)) failed = true;
  } catch {
    failed = true;
  }
  onProgress(1);
  return failed;
}
