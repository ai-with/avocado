import { useState } from "react";
import { Badge, Button, Card, ChoiceChips, FloatingActionBar, ProgressBar, Spinner, TextField, type BadgeTone, type ChoiceOption } from "../../../ui";
import type { Lang } from "../../../i18n";
import { useSlotUpload, type Phase, type SlotKind } from "../useSlotUpload";
import { hasSavedUpload } from "../uploadParts";
import { initialKind, needsFinalNotice } from "../kindChoice";
import type { DriveCheck } from "../useDriveCheck";
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
const NOTE_MAX = 500;

type SlotState = ReturnType<typeof useSlotUpload>;

// 입력 중 확인 결과. 막힌 링크면 공유 설정 바꾸는 법을 보여 주고, 제출은 막지 않는다
function DriveAccessNote({ access, t }: { access: DriveCheck; t: T }) {
  if (access === "checking") return <p className="text-caption" role="status">{t("drive_checking")}</p>;
  if (access === "accessible") return <p className="text-caption pub-ok" role="status">{t("drive_ok")}</p>;
  if (access !== "blocked") return null;
  return (
    <div className="stack-tight" role="status">
      <span><Badge tone="warn">{t("drive_blocked")}</Badge></span>
      <p className="text-secondary">{t("drive_fix_1")}<br />{t("drive_fix_2")}<br />{t("drive_fix_3")}</p>
    </div>
  );
}

function TooBigForm({ s, t }: { s: SlotState; t: T }) {
  return (
    <div className="stack">
      <p><strong>{t("limit_title")}</strong></p>
      <p className="text-secondary">{t("limit_desc")}</p>
      <TextField label={t("drive_url")} type="url" inputMode="url" clearable value={s.driveUrl} onChange={(e) => s.setDriveUrl(e.target.value)} placeholder="https://drive.google.com/..." />
      <DriveAccessNote access={s.driveAccess} t={t} />
      <FloatingActionBar>
        <Button size="xl" onClick={() => void s.submitLink()} disabled={!s.driveUrl}>{s.driveAccess === "blocked" ? t("submit_link_anyway") : t("submit_link")}</Button>
      </FloatingActionBar>
    </div>
  );
}

function UploadForm({ s, t, title }: { s: SlotState; t: T; title: string }) {
  const busy = s.phase === "uploading" || s.phase === "analyzing";
  return (
    <>
      <TextField label={t("version_note")} value={s.note} onChange={(e) => s.setNote(e.target.value)} maxLength={NOTE_MAX} showCount />
      {(busy || s.progress > 0) && <ProgressBar value={s.progress} label={title} />}
      {s.phase === "uploading" && <p className="text-caption" role="status">{s.reconnecting ? t("upload_reconnecting") : `${t("uploading")} ${Math.round(s.progress * PERCENT)}%`}</p>}
      {s.phase === "analyzing" && <p className="row text-caption" role="status"><Spinner size="sm" />{t("analyzing")}</p>}
      {!busy && (
        <FloatingActionBar>
          <Button size="xl" onClick={() => void s.upload()} disabled={!s.file || s.phase === "bad_format"}>
            {s.phase === "paused" ? t("retry") : t("upload_start")}
          </Button>
        </FloatingActionBar>
      )}
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
      {s.phase === "bad_format" && <p className="field-error">{t("bad_format")}</p>}
      {s.phase === "too_big" ? <TooBigForm s={s} t={t} /> : <UploadForm s={s} t={t} title={title} />}
    </>
  );
}

type Props = { token: string; t: T; lang: Lang; maxFrames: number; hasFinal: boolean; onDone: () => Promise<void> };
// 올리는 중이거나 멈춘 업로드가 있는 동안에는 종류를 바꾸지 못하게 한다(진행 상태와 섞이지 않게)
const LOCKED: Phase[] = ["uploading", "analyzing", "paused"];
const OTHER: Record<SlotKind, SlotKind> = { final: "clean", clean: "final" };

function KindNotes({ kind, s, t, token, hasFinal }: { kind: SlotKind; s: SlotState; t: T; token: string; hasFinal: boolean }) {
  const resumable = s.phase === "idle" && !s.file && hasSavedUpload(token, kind);
  return (
    <>
      <p className="text-caption">{kind === "final" ? t("kind_final_desc") : t("kind_clean_desc")}</p>
      {needsFinalNotice(kind, hasFinal) && <p className="pub-note" role="status">{t("clean_needs_final")}</p>}
      {resumable && <p className="text-caption" role="status">{t("upload_resume_found")}</p>}
    </>
  );
}

// 업로드 칸 하나. 위에서 완성본·클린본을 고르고, 머리 오른쪽에 지금 상태를 글자로 보인다
export function Slot({ token, t, lang, maxFrames, hasFinal, onDone }: Props) {
  const [kind, setKind] = useState<SlotKind>(() => initialKind((k) => hasSavedUpload(token, k)));
  const s = useSlotUpload({ token, kind, t, maxFrames, onDone });
  const status = PHASE_STATUS[s.phase];
  const finished = s.phase === "done" || s.phase === "external_done";
  const options: ChoiceOption<SlotKind>[] = [{ value: "final", label: t("final_cut") }, { value: "clean", label: t("kind_clean") }];
  const choose = (next: SlotKind) => {
    if (finished) s.reset();
    setKind(next);
  };
  const again = () => choose(OTHER[kind]);
  return (
    <Card className="stack pub-slot">
      <div className="pub-slot-head">
        <ChoiceChips label={t("kind_label")} options={options} value={kind} onChange={choose} disabled={LOCKED.includes(s.phase)} />
        <span aria-live="polite"><Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[lang][status]}</Badge></span>
      </div>
      <KindNotes kind={kind} s={s} t={t} token={token} hasFinal={hasFinal} />
      {finished ? <p className="pub-ok">{s.phase === "done" ? t("upload_done") : t("link_submitted")}</p> : <SlotForm s={s} t={t} title={options.find((o) => o.value === kind)?.label ?? ""} />}
      {s.msg && <p className={s.phase === "done" ? "text-caption" : "field-error"} role="status">{s.msg}</p>}
      {finished && <FloatingActionBar><Button size="xl" onClick={again}>{t("upload_another")}</Button></FloatingActionBar>}
    </Card>
  );
}
