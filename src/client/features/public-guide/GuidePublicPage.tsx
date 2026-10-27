import { useCallback, useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { Button, LoadingState } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import { makeT, type Lang } from "../../i18n";
import { langFromSearch } from "../../../shared/guide-public";
import { PUBLIC_OPTS, type GuideData, type PersonalData, type T } from "./guideTypes";
import { PublicShell } from "./sections/PublicShell";
import { GuideBody } from "./sections/GuideBody";
import { JoinForm } from "./sections/JoinForm";
import { ConsentForm } from "./sections/ConsentForm";
import "./public.css";

// 화면 언어: 링크의 ?lang= 이 먼저, 없으면 서버가 정한 인플루언서·가이드 기본 언어 (AIWITH-373)
function useGuideData(token: string) {
  const urlLang = langFromSearch(useLocation().search);
  const [data, setData] = useState<GuideData | null>(null);
  const [error, setError] = useState("");
  const [lang, setLang] = useState<Lang>(urlLang ?? "ko");
  const load = useCallback(async () => {
    try {
      const d = await api.get<GuideData>(`/public/guide/${token}${urlLang ? `?lang=${urlLang}` : ""}`, PUBLIC_OPTS);
      setData(d);
      setLang(urlLang ?? d.lang);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [token, urlLang]);
  useEffect(() => void load(), [load]);
  return { data, error, lang, setLang, load };
}

// 하단 고정 행동 영역. 참여 전에는 '참여하기', 참여 뒤에는 업로드와 참여 취소
function GuideCta({ data, t, onJoin, onWithdraw }: { data: PersonalData; t: T; onJoin: () => void; onWithdraw: () => void }) {
  if (!data.consent) return <div className="pub-cta"><Button className="pub-btn" onClick={onJoin}>{t("join")}</Button></div>;
  return (
    <div className="pub-cta">
      <p><strong>{t("joined")}</strong></p>
      {data.uploadUrl && <Button className="pub-btn" onClick={() => location.assign(data.uploadUrl!)}>{t("go_upload")}</Button>}
      <Button variant="ghost" size="sm" className="pub-btn" onClick={onWithdraw}>{t("withdraw")}</Button>
    </div>
  );
}

// /g/:token (모바일 우선). 인플루언서별 토큰 또는 가이드 공용 slug
export function GuidePublicPage() {
  const { token = "" } = useParams();
  const { data, error, lang, setLang, load } = useGuideData(token);
  const [view, setView] = useState<"guide" | "consent">("guide");
  const t = makeT(lang);
  const shell = { langLabel: t("lang_toggle"), onToggleLang: () => setLang(lang === "ko" ? "en" : "ko"), brand: data?.guide.brandName };

  if (error) return <PublicShell {...shell}><p className="pub-error">{t("link_expired")}</p></PublicShell>;
  if (!data) return <PublicShell {...shell}><LoadingState label={t("loading")} /></PublicShell>;
  if (data.mode === "shared") return <PublicShell {...shell}><JoinForm slug={token} lang={lang} title={data.guide.name} /></PublicShell>;
  if (view === "consent" && !data.consent)
    return (
      <PublicShell {...shell}>
        <ConsentForm token={token} lang={lang} data={data} onDone={() => { setView("guide"); void load(); }} />
      </PublicShell>
    );

  const withdraw = async () => {
    if (!confirm(t("withdraw_confirm"))) return;
    await api.post(`/public/guide/${token}/withdraw`, {}, PUBLIC_OPTS);
    alert(t("withdrawn"));
    await load();
  };
  return (
    <PublicShell {...shell} className="has-cta">
      <GuideBody guide={data.guide} leadLinks={data.leadLinks} t={t} lang={lang} />
      <GuideCta data={data} t={t} onJoin={() => { setView("consent"); scrollTo(0, 0); }} onWithdraw={() => void withdraw()} />
    </PublicShell>
  );
}
