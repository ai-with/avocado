import { useState } from "react";
import { Button, Switch, Textarea, TextField } from "../../../ui";
import { api, errorMessage } from "../../../lib/api";
import type { FeedbackShape } from "../../../../shared/review";
import { PUBLIC_OPTS, type T } from "../../public-guide/guideTypes";
import { FrameMarkup } from "../FrameMarkup";

export type PublicFeedbackItem = { id: string; n: number; tMs: number; timecode: string; frameUrl: string | null; shape: FeedbackShape | null; text: string; textTranslated: string | null; done: boolean; reply: string | null };
const REPLY_MAX = 2000;

export type FeedbackCtx = { base: string; t: T; onChanged: () => Promise<void> };

// 장면 이미지, 번역 코멘트, 원문 보기. 최신 버전만 반영 체크·답글을 바꿀 수 있고 지난 버전은 읽기 전용
export function FeedbackCard({ it, base, t, onChanged, readOnly }: FeedbackCtx & { it: PublicFeedbackItem; readOnly: boolean }) {
  const [original, setOriginal] = useState(false);
  const translated = !!it.textTranslated;
  return (
    <div className="pub-fb-item">
      <div className="pub-fb-head">
        <span className="fb-n">{it.n}</span>
        <strong>{it.timecode}</strong>
      </div>
      {it.frameUrl && <FrameMarkup src={it.frameUrl} alt={it.timecode} shapes={it.shape ? [it.shape] : []} />}
      <p>{translated && !original ? it.textTranslated : it.text}</p>
      {translated && (
        <p className="text-caption">
          {t("fb_auto")} · <button type="button" className="seg-time" onClick={() => setOriginal(!original)}>{original ? t("fb_hide_original") : t("fb_show_original")}</button>
        </p>
      )}
      {readOnly ? <ReadOnlyState it={it} t={t} /> : <ItemActions it={it} base={base} t={t} onChanged={onChanged} />}
    </div>
  );
}

function ReadOnlyState({ it, t }: { it: PublicFeedbackItem; t: T }) {
  return (
    <>
      <p className={`text-caption ${it.done ? "pub-ok" : ""}`}>{it.done ? t("fb_done") : t("fb_not_done")}</p>
      {it.reply && <p className="text-secondary">{t("fb_reply")}: {it.reply}</p>}
    </>
  );
}

function ItemActions({ it, base, t, onChanged }: FeedbackCtx & { it: PublicFeedbackItem }) {
  const [reply, setReply] = useState(it.reply ?? "");
  const [msg, setMsg] = useState("");
  const save = async (body: { done?: boolean; reply?: string }, ok = "") => {
    try {
      await api.post(`${base}/items/${it.id}`, body, PUBLIC_OPTS);
      setMsg(ok);
      await onChanged();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  return (
    <>
      <Switch label={t("fb_done")} checked={it.done} onChange={(done) => void save({ done })} />
      <Textarea label={t("fb_reply")} value={reply} onChange={(e) => setReply(e.target.value)} rows={2} maxLength={REPLY_MAX} autoGrow showCount />
      <Button variant="secondary" size="sm" onClick={() => void save({ reply }, t("fb_reply_saved"))} disabled={reply === (it.reply ?? "")}>{t("fb_reply_save")}</Button>
      {msg && <p className="text-caption" role="status">{msg}</p>}
    </>
  );
}

export function PostUrl({ base, t, initial }: { base: string; t: T; initial: string | null }) {
  const [url, setUrl] = useState(initial ?? "");
  const [msg, setMsg] = useState("");
  const save = async () => {
    try {
      const r = await api.post<{ status: string }>(`${base}/post-url`, { url }, PUBLIC_OPTS);
      setMsg(r.status === "conflict" ? t("fb_post_conflict") : t("fb_post_saved"));
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  return (
    <section className="pub-section">
      <h2 className="pub-h pub-ok">{t("fb_approved")}</h2>
      <p className="text-secondary">{t("fb_approved_desc")}</p>
      <TextField label={t("fb_post_url")} type="url" inputMode="url" clearable value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.instagram.com/reel/..." />
      <Button onClick={() => void save()} disabled={!url.trim()}>{t("fb_save")}</Button>
      {msg && <p className="text-caption" role="status">{msg}</p>}
    </section>
  );
}
