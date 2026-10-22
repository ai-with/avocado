import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Button, LoadingState } from "../../ui";
import { api } from "../../lib/api";
import { makeT, type Lang, type TKey } from "../../i18n";
import { PUBLIC_OPTS, type T } from "./guideTypes";
import { PublicShell, PublicSection } from "./sections/PublicShell";
import { Slot } from "./sections/Slot";
import "./public.css";

type Sub = { id: string; version: number; kind: "final" | "clean"; status: string; fileName: string | null; note: string | null; driveUrl: string | null; uploadedAt: number | null };
type UploadData = { brandName: string; guideName: string; lang: Lang; displayName: string; consented: boolean; guideUrl: string; feedbackUrl: string | null; deliverables: { clean: boolean }; limits: { maxFrames: number }; submissions: Sub[] };

function PreviousSubmissions({ subs, t }: { subs: Sub[]; t: T }) {
  return (
    <PublicSection title={t("previous")}>
      <ul className="pub-list">
        {subs.map((s) => (
          <li key={s.id}>
            v{s.version} {s.kind === "final" ? t("final_cut") : t("clean_cut")} · {t(`status_${s.status}` as TKey) ?? s.status}
            {s.note && <span className="text-caption"> · {s.note}</span>}
          </li>
        ))}
      </ul>
    </PublicSection>
  );
}

function UploadBody({ data, token, t, lang, onDone }: { data: UploadData; token: string; t: T; lang: Lang; onDone: () => Promise<void> }) {
  if (!data.consented)
    return (
      <div className="stack">
        <p>{t("upload_need_consent")}</p>
        <Button className="pub-btn" onClick={() => location.assign(data.guideUrl)}>{t("open_guide")}</Button>
      </div>
    );
  const slot = { token, t, lang, maxFrames: data.limits.maxFrames, onDone };
  return (
    <div className="stack">
      <h1 className="pub-title">{t("upload_title")}</h1>
      <p className="text-secondary">{data.guideName} · {t("limits_hint")}</p>
      {data.feedbackUrl && <a href={data.feedbackUrl}>{t("prev_feedback")}</a>}
      <Slot kind="final" title={t("slot_final")} {...slot} />
      <Slot kind="clean" title={t("slot_clean")} {...slot} />
      {data.submissions.length > 0 && <PreviousSubmissions subs={data.submissions} t={t} />}
    </div>
  );
}

// /u/:token: 완성본(필수)·클린본(선택) 업로드 (F-59). 업로드 후 브라우저에서 프레임·오디오를 뽑아 보낸다
export function UploadPublicPage() {
  const { token = "" } = useParams();
  const [data, setData] = useState<UploadData | null>(null);
  const [error, setError] = useState(false);
  const [langPick, setLang] = useState<Lang | null>(null);
  const lang = langPick ?? data?.lang ?? "ko";
  const t = makeT(lang);
  const load = useCallback(async () => {
    try {
      setData(await api.get<UploadData>(`/public/upload/${token}`, PUBLIC_OPTS));
    } catch {
      setError(true);
    }
  }, [token]);
  useEffect(() => void load(), [load]);

  return (
    <PublicShell brand={data?.brandName} langLabel={t("lang_toggle")} onToggleLang={() => setLang(lang === "ko" ? "en" : "ko")}>
      {error ? <p className="pub-error">{t("link_expired")}</p> : !data ? <LoadingState label={t("loading")} /> : <UploadBody data={data} token={token} t={t} lang={lang} onDone={load} />}
    </PublicShell>
  );
}
