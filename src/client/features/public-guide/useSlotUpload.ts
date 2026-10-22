import { useState } from "react";
import { api, errorMessage } from "../../lib/api";
import type { TKey } from "../../i18n";
import { checkUpload } from "../../../shared/guides";
import { readVideoMeta } from "./extract";
import { sendAnalysis } from "./sendAnalysis";
import { PUBLIC_OPTS } from "./guideTypes";

export type Phase = "idle" | "too_big" | "bad_format" | "uploading" | "paused" | "analyzing" | "done" | "external_done";
export type SlotKind = "final" | "clean";
type SlotArgs = { token: string; kind: SlotKind; t: (k: TKey) => string; maxFrames: number; onDone: () => Promise<void> };

// 같은 파일이면 서버가 미완료 업로드를 찾아 완료된 part 목록을 돌려준다 (이어 올리기). submissionId 를 돌려준다
async function uploadParts(token: string, kind: SlotKind, file: File, note: string, setProgress: (r: number) => void): Promise<string> {
  const base = `/api/public/upload/${token}`;
  const meta = await readVideoMeta(file);
  const init = await api.post<{ submissionId: string; partSize: number; doneParts: number[] }>(
    `/public/upload/${token}/init`,
    { kind, fileName: file.name, size: file.size, durationS: meta.durationS, width: meta.width, height: meta.height, note },
    PUBLIC_OPTS,
  );
  const submissionId = init.submissionId;
  const total = Math.ceil(file.size / init.partSize);
  const done = new Set(init.doneParts);
  let sent = done.size * init.partSize;
  setProgress(Math.min(1, sent / file.size));
  for (let n = 1; n <= total; n++) {
    if (done.has(n)) continue;
    const chunk = file.slice((n - 1) * init.partSize, n * init.partSize);
    const res = await fetch(`${base}/part?submissionId=${submissionId}&n=${n}`, { method: "PUT", body: chunk });
    if (!res.ok) throw new Error("part_failed");
    sent += chunk.size;
    setProgress(Math.min(1, sent / file.size));
  }
  await api.post(`/public/upload/${token}/complete`, { submissionId }, PUBLIC_OPTS);
  return submissionId;
}

// 고른 파일과 진행 상태. 고를 때 형식·길이·크기를 먼저 검사한다
function useSlotFile() {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [msg, setMsg] = useState("");
  const pick = async (f: File | null) => {
    setFile(f);
    setMsg("");
    setProgress(0);
    if (!f) return setPhase("idle");
    const meta = await readVideoMeta(f).catch(() => ({ durationS: 0, width: 0, height: 0 }));
    const check = checkUpload(f.name, f.size, meta.durationS);
    setPhase(check.ok ? "idle" : check.reason === "bad_format" ? "bad_format" : "too_big");
  };
  return { file, phase, setPhase, progress, setProgress, msg, setMsg, pick };
}

// 업로드 칸 하나의 상태와 동작 (파일 고르기, 나눠 올리기, 분석 자료 전송, 외부 링크 제출)
export function useSlotUpload({ token, kind, t, maxFrames, onDone }: SlotArgs) {
  const { file, phase, setPhase, progress, setProgress, msg, setMsg, pick } = useSlotFile();
  const [note, setNote] = useState("");
  const [driveUrl, setDriveUrl] = useState("");
  const base = `/api/public/upload/${token}`;

  const upload = async () => {
    if (!file) return;
    setPhase("uploading");
    setMsg("");
    let submissionId = "";
    try {
      submissionId = await uploadParts(token, kind, file, note, setProgress);
    } catch (e) {
      setPhase("paused");
      setMsg(e instanceof TypeError || (e instanceof Error && e.message === "part_failed") ? t("upload_resume_hint") : errorMessage(e));
      return;
    }
    setPhase("analyzing");
    setProgress(0);
    const failed = await sendAnalysis(base, submissionId, file, maxFrames, setProgress);
    setPhase("done");
    setMsg(failed ? t("analysis_partial") : "");
    await onDone();
  };

  const submitLink = async () => {
    try {
      await api.post(`/public/upload/${token}/external`, { kind, driveUrl, note }, PUBLIC_OPTS);
      setPhase("external_done");
      await onDone();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  return { file, note, setNote, phase, progress, msg, driveUrl, setDriveUrl, pick, upload, submitLink };
}
