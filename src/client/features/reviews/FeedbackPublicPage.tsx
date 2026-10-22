import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Button, Checkbox, Input, Textarea } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import type { Lang } from "../../i18n";
import type { FeedbackShape } from "../../../shared/review";
import { FrameMarkup } from "./FrameMarkup";
import "../public-guide/public.css";
import "./reviews.css";

type Item = { id: string; n: number; tMs: number; timecode: string; frameUrl: string | null; shape: FeedbackShape | null; text: string; textTranslated: string | null; done: boolean; reply: string | null };
type Data = {
  brandName: string;
  guideName: string;
  lang: Lang;
  displayName: string;
  uploadUrl: string;
  approved: boolean;
  approvedVersion: number | null;
  postUrl: string | null;
  rounds: { n: number; version: number | null; submittedAt: number; items: Item[] }[];
};
const opts = { redirectOn401: false };

// 이 화면에서만 쓰는 문구 (인플루언서 언어)
const T = {
  ko: {
    lang_toggle: "English",
    title: "영상 피드백",
    none: "아직 받은 피드백이 없어요.",
    round: (n: number, v: number | null) => `${n}회차 피드백${v ? ` (v${v})` : ""}`,
    auto: "자동 번역",
    show_original: "원문 보기",
    hide_original: "원문 숨기기",
    done: "반영함",
    reply: "질문·답글",
    reply_save: "답글 남기기",
    reply_saved: "답글을 남겼어요.",
    upload_new: "수정한 영상 올리기",
    approved: "최종 승인됐어요",
    approved_desc: "게시한 뒤 게시물 주소를 붙여 넣어 주세요.",
    post_url: "게시물 URL",
    save: "저장",
    post_saved: "게시물 주소를 저장했어요.",
    post_conflict: "브랜드가 이미 다른 주소를 넣었어요. 브랜드에서 확인할게요.",
    expired: "링크가 만료되었거나 찾을 수 없어요. 브랜드에 새 링크를 요청해 주세요.",
    loading: "불러오는 중이에요",
  },
  en: {
    lang_toggle: "한국어",
    title: "Video feedback",
    none: "No feedback yet.",
    round: (n: number, v: number | null) => `Feedback round ${n}${v ? ` (v${v})` : ""}`,
    auto: "Auto-translated",
    show_original: "Show original",
    hide_original: "Hide original",
    done: "Done",
    reply: "Question or reply",
    reply_save: "Send reply",
    reply_saved: "Reply sent.",
    upload_new: "Upload a revised video",
    approved: "Your video is approved",
    approved_desc: "After you post it, paste the post URL here.",
    post_url: "Post URL",
    save: "Save",
    post_saved: "Post URL saved.",
    post_conflict: "The brand already entered a different URL. They will check it.",
    expired: "This link has expired or cannot be found. Please ask the brand for a new link.",
    loading: "Loading",
  },
};

// /f/:token 인플루언서 피드백 페이지 (F-62, F-48 게시물 URL). 모바일 우선
export function FeedbackPublicPage() {
  const { token = "" } = useParams();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const [langPick, setLang] = useState<Lang | null>(null);
  const lang = langPick ?? data?.lang ?? "ko";
  const t = T[lang];
  const base = `/public/feedback/${token}`;
  const load = useCallback(async () => {
    try {
      setData(await api.get<Data>(base, opts));
    } catch {
      setError(true);
    }
  }, [base]);
  useEffect(() => void load(), [load]);

  return (
    <div className="pub">
      <header className="pub-head">
        <span className="pub-brand">{data?.brandName}</span>
        <button type="button" className="pub-lang" lang={lang === "ko" ? "en" : "ko"} onClick={() => setLang(lang === "ko" ? "en" : "ko")}>{t.lang_toggle}</button>
      </header>
      <main className="pub-main">
        {error ? <p className="pub-error" role="alert">{t.expired}</p> : !data ? <p className="text-secondary" role="status">{t.loading}</p> : <FeedbackBody data={data} base={base} t={t} onChanged={load} />}
      </main>
    </div>
  );
}

type Dict = (typeof T)["ko"];

function FeedbackBody({ data, base, t, onChanged }: { data: Data; base: string; t: Dict; onChanged: () => Promise<void> }) {
  return (
    <>
      <h1 className="pub-title">{t.title}</h1>
      <p className="text-secondary">{data.guideName}</p>
      {data.approved && <PostUrl base={base} t={t} initial={data.postUrl} />}
      {data.rounds.length === 0 && <p className="text-secondary">{t.none}</p>}
      {data.rounds.map((r) => (
        <section key={r.n} className="pub-section">
          <h2 className="pub-h">{t.round(r.n, r.version)}</h2>
          {r.items.map((it) => <FeedbackCard key={it.id} it={it} base={base} t={t} showTranslation={!!it.textTranslated} onChanged={onChanged} />)}
        </section>
      ))}
      {!data.approved && data.rounds.length > 0 && <Button onClick={() => location.assign(data.uploadUrl)}>{t.upload_new}</Button>}
    </>
  );
}

function FeedbackCard({ it, base, t, showTranslation, onChanged }: { it: Item; base: string; t: Dict; showTranslation: boolean; onChanged: () => Promise<void> }) {
  const [original, setOriginal] = useState(false);
  const [reply, setReply] = useState(it.reply ?? "");
  const [msg, setMsg] = useState("");
  const save = async (body: { done?: boolean; reply?: string }, ok = "") => {
    try {
      await api.post(`${base}/items/${it.id}`, body, opts);
      setMsg(ok);
      await onChanged();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  return (
    <div className="pub-fb-item">
      <div className="pub-fb-head">
        <span className="fb-n">{it.n}</span>
        <strong>{it.timecode}</strong>
      </div>
      {it.frameUrl && <FrameMarkup src={it.frameUrl} alt={it.timecode} shapes={it.shape ? [it.shape] : []} />}
      <p>{showTranslation && !original ? it.textTranslated : it.text}</p>
      {showTranslation && (
        <p className="text-caption">
          {t.auto} · <button type="button" className="seg-time" onClick={() => setOriginal(!original)}>{original ? t.hide_original : t.show_original}</button>
        </p>
      )}
      <Checkbox label={t.done} checked={it.done} onChange={(e) => void save({ done: e.target.checked })} />
      <Textarea label={t.reply} value={reply} onChange={(e) => setReply(e.target.value)} rows={2} maxLength={2000} />
      <Button variant="secondary" size="sm" onClick={() => void save({ reply }, t.reply_saved)} disabled={reply === (it.reply ?? "")}>{t.reply_save}</Button>
      {msg && <p className="text-caption" role="status">{msg}</p>}
    </div>
  );
}

function PostUrl({ base, t, initial }: { base: string; t: Dict; initial: string | null }) {
  const [url, setUrl] = useState(initial ?? "");
  const [msg, setMsg] = useState("");
  const save = async () => {
    try {
      const r = await api.post<{ status: string }>(`${base}/post-url`, { url }, opts);
      setMsg(r.status === "conflict" ? t.post_conflict : t.post_saved);
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  return (
    <section className="pub-section">
      <h2 className="pub-h pub-ok">{t.approved}</h2>
      <p className="text-secondary">{t.approved_desc}</p>
      <Input label={t.post_url} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.instagram.com/reel/..." />
      <Button onClick={() => void save()} disabled={!url.trim()}>{t.save}</Button>
      {msg && <p className="text-caption" role="status">{msg}</p>}
    </section>
  );
}
