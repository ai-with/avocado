import { api } from "../../lib/api";
import { UPLOAD_LIMITS } from "../../../shared/guides";
import { readVideoMeta } from "./extract";
import { PUBLIC_OPTS } from "./guideTypes";
import { RetryableError, withRetry } from "./retry";

export type SlotKind = "final" | "clean";
type Started = { submissionId: string; partSize: number; doneParts: number[] };
type Saved = { submissionId: string; fileName: string; size: number };
export type UploadArgs = { token: string; kind: SlotKind; file: File; note: string; onProgress: (r: number) => void; onRetry: (retrying: boolean) => void };

const SERVER_ERROR = 500;
const savedKey = (token: string, kind: SlotKind) => `upload-resume:${token}:${kind}`;

// 페이지를 새로 열어도 이어 올리도록 업로드 ID 를 남긴다. 저장소를 못 쓰는 브라우저면 서버의 같은 파일 찾기에 맡긴다
function loadSaved(key: string): Saved | null {
  try {
    const raw = localStorage.getItem(key);
    const v: Partial<Saved> | null = raw ? JSON.parse(raw) : null;
    return v && typeof v.submissionId === "string" && typeof v.fileName === "string" && typeof v.size === "number" ? (v as Saved) : null;
  } catch {
    return null;
  }
}
export const hasSavedUpload = (token: string, kind: SlotKind) => loadSaved(savedKey(token, kind)) !== null;
function writeSaved(key: string, v: Saved | null) {
  try {
    if (v) localStorage.setItem(key, JSON.stringify(v));
    else localStorage.removeItem(key);
  } catch {
    // 저장소가 막혀 있어도 업로드는 계속한다
  }
}

// 남겨 둔 업로드가 같은 파일이고 아직 올리는 중이면 서버가 기록한 part 부터 이어 간다
async function resumeSaved(args: UploadArgs, key: string): Promise<Started | null> {
  const saved = loadSaved(key);
  if (!saved || saved.fileName !== args.file.name || saved.size !== args.file.size) return null;
  try {
    const st = await api.get<{ status: string; doneParts: number[] }>(`/public/upload/${args.token}/status?submissionId=${saved.submissionId}`, PUBLIC_OPTS);
    return st.status === "uploading" ? { submissionId: saved.submissionId, partSize: UPLOAD_LIMITS.partBytes, doneParts: st.doneParts } : null;
  } catch {
    return null;
  }
}

async function start(args: UploadArgs, key: string): Promise<Started> {
  const resumed = await resumeSaved(args, key);
  if (resumed) return resumed;
  const { token, kind, file, note } = args;
  const meta = await readVideoMeta(file);
  const body = { kind, fileName: file.name, size: file.size, durationS: meta.durationS, width: meta.width, height: meta.height, note };
  const init = await withRetry(() => api.post<Started>(`/public/upload/${token}/init`, body, PUBLIC_OPTS), args.onRetry);
  writeSaved(key, { submissionId: init.submissionId, fileName: file.name, size: file.size });
  return init;
}

async function putPart(token: string, submissionId: string, n: number, chunk: Blob) {
  const res = await fetch(`/api/public/upload/${token}/part?submissionId=${submissionId}&n=${n}`, { method: "PUT", body: chunk });
  if (res.status >= SERVER_ERROR) throw new RetryableError("part_5xx");
  if (!res.ok) throw new Error("part_failed");
}

// 나눠 올리고 완료한다. 끊기면 part 단위로 다시 시도한다. submissionId 를 돌려준다
export async function uploadParts(args: UploadArgs): Promise<string> {
  const { token, file, onProgress, onRetry } = args;
  const key = savedKey(token, args.kind);
  const { submissionId, partSize, doneParts } = await start(args, key);
  const total = Math.ceil(file.size / partSize);
  const done = new Set(doneParts);
  let sent = Math.min(file.size, done.size * partSize);
  onProgress(sent / file.size);
  for (let n = 1; n <= total; n++) {
    if (done.has(n)) continue;
    const chunk = file.slice((n - 1) * partSize, n * partSize);
    await withRetry(() => putPart(token, submissionId, n, chunk), onRetry);
    sent += chunk.size;
    onProgress(Math.min(1, sent / file.size));
  }
  await withRetry(() => api.post(`/public/upload/${token}/complete`, { submissionId }, PUBLIC_OPTS), onRetry);
  writeSaved(key, null);
  return submissionId;
}
