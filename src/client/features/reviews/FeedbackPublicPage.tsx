import { useCallback, useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { LoadingState } from "../../ui";
import { api } from "../../lib/api";
import { makeT, type Lang } from "../../i18n";
import { langFromSearch } from "../../../shared/guide-public";
import { PUBLIC_OPTS } from "../public-guide/guideTypes";
import { PublicShell } from "../public-guide/sections/PublicShell";
import { InfluencerTabs, useStickyNav } from "../public-guide/sections/InfluencerTabs";
import { FeedbackPublicBody, type FeedbackData } from "./sections/FeedbackPublicBody";
import "../public-guide/public.css";
import "./reviews.css";

// /f/:token 인플루언서 피드백 페이지 (F-62, F-48 게시물 URL). 모바일 우선, 가이드·업로드와 같은 탭 줄
export function FeedbackPublicPage() {
  const { token = "" } = useParams();
  const [data, setData] = useState<FeedbackData | null>(null);
  const [error, setError] = useState(false);
  const [langPick, setLang] = useState<Lang | null>(langFromSearch(useLocation().search));
  const lang = langPick ?? data?.lang ?? "ko";
  const t = makeT(lang);
  const base = `/public/feedback/${token}`;
  const load = useCallback(async () => {
    try {
      setData(await api.get<FeedbackData>(base, PUBLIC_OPTS));
    } catch {
      setError(true);
    }
  }, [base]);
  useEffect(() => void load(), [load]);
  const nav = useStickyNav(data ? { brand: data.brandName, tabs: data.tabs } : null);
  const tabs = nav && <InfluencerTabs tabs={nav.tabs} current="feedback" t={t} lang={lang} />;

  return (
    <PublicShell centerBrand brand={nav?.brand} tabs={tabs} langLabel={t("lang_toggle")} onToggleLang={() => setLang(lang === "ko" ? "en" : "ko")}>
      {error ? <p className="pub-error" role="alert">{t("link_expired")}</p> : !data ? <LoadingState label={t("loading")} /> : <FeedbackPublicBody data={data} base={base} t={t} lang={lang} onChanged={load} />}
    </PublicShell>
  );
}
