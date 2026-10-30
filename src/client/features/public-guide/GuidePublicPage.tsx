import { useCallback, useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { Button, ButtonLink, FloatingActionBar, LoadingState } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import { makeT, type Lang } from "../../i18n";
import { langFromSearch, withLangParam } from "../../../shared/guide-public";
import { PUBLIC_OPTS, type GuideData, type PersonalData, type T } from "./guideTypes";
import { PublicShell } from "./sections/PublicShell";
import { GuideBody } from "./sections/GuideBody";
import { JoinForm } from "./sections/JoinForm";
import { ConsentForm } from "./sections/ConsentForm";
import { InfluencerTabs, useStickyNav } from "./sections/InfluencerTabs";
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

// 참여 전에는 '참여하기', 참여 뒤에는 '영상 올리러 가기'가 하단에 떠 있다. 참여 취소는 본문에 둔다
function GuideCta({ data, t, lang, onJoin, onWithdraw }: { data: PersonalData; t: T; lang: Lang; onJoin: () => void; onWithdraw: () => void }) {
  if (!data.consent) return <FloatingActionBar><Button size="xl" onClick={onJoin}>{t("join")}</Button></FloatingActionBar>;
  return (
    <>
      <p><strong>{t("joined")}</strong></p>
      <Button variant="ghost" size="sm" onClick={onWithdraw}>{t("withdraw")}</Button>
      {data.tabs.upload && <FloatingActionBar><ButtonLink variant="primary" size="xl" to={withLangParam(data.tabs.upload, lang)}>{t("go_upload")}</ButtonLink></FloatingActionBar>}
    </>
  );
}

// /g/:token (모바일 우선). 인플루언서별 토큰 또는 가이드 공용 slug
export function GuidePublicPage() {
  const { token = "" } = useParams();
  const { data, error, lang, setLang, load } = useGuideData(token);
  const [view, setView] = useState<"guide" | "consent">("guide");
  const t = makeT(lang);
  const nav = useStickyNav(data?.mode === "personal" ? { brand: data.guide.brandName, tabs: data.tabs } : null);
  const shell = {
    centerBrand: true,
    langLabel: t("lang_toggle"),
    onToggleLang: () => setLang(lang === "ko" ? "en" : "ko"),
    brand: data?.guide.brandName ?? nav?.brand,
    tabs: nav && <InfluencerTabs tabs={nav.tabs} current="guide" t={t} lang={lang} />,
  };

  if (error) return <PublicShell {...shell}><p className="pub-error">{t("link_expired")}</p></PublicShell>;
  if (!data) return <PublicShell {...shell}><LoadingState pattern="detail" label={t("loading")} /></PublicShell>;
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
    <PublicShell {...shell}>
      <GuideBody guide={data.guide} leadLinks={data.leadLinks} t={t} lang={lang} />
      <GuideCta data={data} t={t} lang={lang} onJoin={() => { setView("consent"); scrollTo(0, 0); }} onWithdraw={() => void withdraw()} />
    </PublicShell>
  );
}
