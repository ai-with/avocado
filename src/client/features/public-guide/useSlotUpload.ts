import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import type { TKey } from "../../i18n";
import { checkUpload } from "../../../shared/guides";
import { readVideoMeta } from "./extract";
import { sendAnalysis } from "./sendAnalysis";
import { PUBLIC_OPTS } from "./guideTypes";
import { uploadParts, type SlotKind } from "./uploadParts";
import { isRetryable } from "./retry";
import { useDriveCheck } from "./useDriveCheck";

export type Phase = "idle" | "too_big" | "bad_format" | "uploading" | "paused" | "analyzing" | "done" | "external_done";
export type { SlotKind };
type SlotArgs = { token: string; kind: SlotKind; t: (k: TKey) => string; maxFrames: number; onDone: () => Promise<void> };

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
  const reset = () => {
    setFile(null);
    setPhase("idle");
    setProgress(0);
    setMsg("");
  };
  return { file, phase, setPhase, progress, setProgress, msg, setMsg, pick, reset };
}

// 다시 시도를 다 쓰고 멈춘 뒤에도 연결이 돌아오면 저절로 이어 간다
function useResumeOnline(active: boolean, resume: () => Promise<void>) {
  useEffect(() => {
    if (!active) return;
    const onOnline = () => void resume();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  });
}

type LinkArgs = { token: string; kind: SlotKind; note: string; onSubmitted: () => void; onError: (m: string) => void; onDone: () => Promise<void> };

// 드라이브 링크 입력·즉시 확인·제출. 막힌 링크도 제출은 받는다
function useDriveLink({ token, kind, note, onSubmitted, onError, onDone }: LinkArgs) {
  const [driveUrl, setDriveUrl] = useState("");
  const driveAccess = useDriveCheck(token, driveUrl);
  const submitLink = async () => {
    try {
      await api.post(`/public/upload/${token}/external`, { kind, driveUrl, note }, PUBLIC_OPTS);
      onSubmitted();
      await onDone();
    } catch (e) {
      onError(errorMessage(e));
    }
  };
  return { driveUrl, setDriveUrl, driveAccess, submitLink };
}

// 업로드 칸 하나의 상태와 동작 (파일 고르기, 나눠 올리기, 분석 자료 전송, 외부 링크 제출)
export function useSlotUpload({ token, kind, t, maxFrames, onDone }: SlotArgs) {
  const { file, phase, setPhase, progress, setProgress, msg, setMsg, pick, reset: resetFile } = useSlotFile();
  const [note, setNote] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  const link = useDriveLink({ token, kind, note, onSubmitted: () => setPhase("external_done"), onError: setMsg, onDone });
  const base = `/api/public/upload/${token}`;

  const upload = async () => {
    if (!file) return;
    setPhase("uploading");
    setMsg("");
    let submissionId = "";
    try {
      submissionId = await uploadParts({ token, kind, file, note, onProgress: setProgress, onRetry: setReconnecting });
    } catch (e) {
      setReconnecting(false);
      setPhase("paused");
      setMsg(isRetryable(e) || (e instanceof Error && e.message === "part_failed") ? t("upload_resume_hint") : errorMessage(e));
      return;
    }
    setPhase("analyzing");
    setProgress(0);
    const failed = await sendAnalysis(base, submissionId, file, maxFrames, setProgress);
    setPhase("done");
    setMsg(failed ? t("analysis_partial") : "");
    await onDone();
  };

  // 다 올린 뒤 다른 종류를 이어 올릴 수 있게 처음 상태로 돌린다
  const reset = () => {
    resetFile();
    setNote("");
    link.setDriveUrl("");
  };

  useResumeOnline(phase === "paused" && !!file, upload);
  return { file, note, setNote, phase, progress, msg, reconnecting, ...link, pick, upload, reset };
}
