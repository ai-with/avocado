import { Badge, Button, Card, Input, type BadgeTone } from "../../../ui";
import type { Lang } from "../../../i18n";
import { useSlotUpload, type Phase, type SlotKind } from "../useSlotUpload";
import type { T } from "../guideTypes";

type SlotStatus = "waiting" | "uploading" | "processing" | "done" | "error";

const PHASE_STATUS: Record<Phase, SlotStatus> = {
  idle: "waiting",
  uploading: "uploading",
  analyzing: "processing",
  done: "done",
  external_done: "done",
  paused: "error",
  bad_format: "error",
  too_big: "error",
};
// 상태를 색만이 아니라 글자로도 알린다. 공개 화면 전용 문구
const STATUS_LABELS: Record<Lang, Record<SlotStatus, string>> = {
  ko: { waiting: "대기 중", uploading: "올리는 중", processing: "처리 중", done: "완료", error: "확인 필요" },
  en: { waiting: "Waiting", uploading: "Uploading", processing: "Processing", done: "Done", error: "Needs attention" },
};
const STATUS_TONES: Record<SlotStatus, BadgeTone> = { waiting: "neutral", uploading: "info", processing: "info", done: "success", error: "danger" };
const ACCEPT = "video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm";
const PERCENT = 100;

type SlotState = ReturnType<typeof useSlotUpload>;

function ProgressBar({ progress, label }: { progress: number; label: string }) {
  const pct = Math.round(progress * PERCENT);
  return (
    <div className="pub-progress" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={PERCENT}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

function TooBigForm({ s, t }: { s: SlotState; t: T }) {
  return (
    <div className="stack">
      <p><strong>{t("limit_title")}</strong></p>
      <p className="text-secondary">{t("limit_desc")}</p>
      <Input label={t("drive_url")} type="url" value={s.driveUrl} onChange={(e) => s.setDriveUrl(e.target.value)} placeholder="https://drive.google.com/..." />
      <Button onClick={() => void s.submitLink()} disabled={!s.driveUrl}>{t("submit_link")}</Button>
    </div>
  );
}

function UploadForm({ s, t, title }: { s: SlotState; t: T; title: string }) {
  const busy = s.phase === "uploading" || s.phase === "analyzing";
  return (
    <>
      <Input label={t("version_note")} value={s.note} onChange={(e) => s.setNote(e.target.value)} maxLength={500} />
      {(busy || s.progress > 0) && <ProgressBar progress={s.progress} label={title} />}
      {s.phase === "uploading" && <p className="text-caption">{t("uploading")} {Math.round(s.progress * PERCENT)}%</p>}
      {s.phase === "analyzing" && <p className="text-caption">{t("analyzing")}</p>}
      <Button onClick={() => void s.upload()} disabled={!s.file || busy || s.phase === "bad_format"}>
        {s.phase === "paused" ? t("retry") : t("upload_start")}
      </Button>
    </>
  );
}

function SlotForm({ s, t, title }: { s: SlotState; t: T; title: string }) {
  return (
    <>
      <label className="pub-file">
        <input type="file" accept={ACCEPT} onChange={(e) => void s.pick(e.target.files?.[0] ?? null)} disabled={s.phase === "uploading" || s.phase === "analyzing"} />
        <span>{s.file ? s.file.name : t("choose_file")}</span>
      </label>
      {s.phase === "bad_format" && <p className="form-error">{t("bad_format")}</p>}
      {s.phase === "too_big" ? <TooBigForm s={s} t={t} /> : <UploadForm s={s} t={t} title={title} />}
    </>
  );
}

type Props = { token: string; kind: SlotKind; title: string; t: T; lang: Lang; maxFrames: number; onDone: () => Promise<void> };

// 업로드 칸 하나 (완성본 또는 클린본). 머리글 오른쪽에 지금 상태를 글자로 보인다
export function Slot({ token, kind, title, t, lang, maxFrames, onDone }: Props) {
  const s = useSlotUpload({ token, kind, t, maxFrames, onDone });
  const status = PHASE_STATUS[s.phase];
  const finished = s.phase === "done" || s.phase === "external_done";
  return (
    <Card className="stack pub-slot">
      <div className="row-between">
        <strong>{title}</strong>
        <span aria-live="polite"><Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[lang][status]}</Badge></span>
      </div>
      {finished ? <p className="pub-ok">{s.phase === "done" ? t("upload_done") : t("link_submitted")}</p> : <SlotForm s={s} t={t} title={title} />}
      {s.msg && <p className={s.phase === "done" ? "text-caption" : "form-error"} role="status">{s.msg}</p>}
    </Card>
  );
}
