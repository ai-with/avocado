import { useCallback, useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { ButtonLink, Disclosure, FloatingActionBar, LoadingState } from "../../ui";
import { api } from "../../lib/api";
import { makeT, type Lang } from "../../i18n";
import { langFromSearch, withLangParam } from "../../../shared/guide-public";
import type { InfluencerTabs as TabLinks } from "../../../shared/influencer-tabs";
import type { VersionGroup } from "../../../shared/versions";
import { versionLine } from "./versionLabel";
import { PUBLIC_OPTS, type T } from "./guideTypes";
import { InfluencerTabs, useStickyNav } from "./sections/InfluencerTabs";
import { PublicShell } from "./sections/PublicShell";
import { Slot } from "./sections/Slot";
import "./public.css";

type UploadData = { brandName: string; guideName: string; lang: Lang; displayName: string; consented: boolean; tabs: TabLinks; approved: boolean; deliverables: { clean: boolean }; limits: { maxFrames: number }; versions: VersionGroup[] };

// 버전별 한 줄, 최신순 (TASK-074). 평소엔 안 봐도 되는 묶음이라 접어 둔다
function PreviousVersions({ versions, t }: { versions: VersionGroup[]; t: T }) {
  return (
    <section className="pub-section">
      <Disclosure title={t("previous")} count={versions.length}>
        <ul className="pub-list">
          {versions.map((g) => <li key={g.version}>{versionLine(t, g)}</li>)}
        </ul>
      </Disclosure>
    </section>
  );
}

function UploadBody({ data, token, t, lang, onDone }: { data: UploadData; token: string; t: T; lang: Lang; onDone: () => Promise<void> }) {
  if (!data.consented)
    return (
      <div className="stack">
        <p>{t("upload_need_consent")}</p>
        <FloatingActionBar><ButtonLink variant="primary" size="xl" to={withLangParam(data.tabs.guide, lang)}>{t("open_guide")}</ButtonLink></FloatingActionBar>
      </div>
    );
  return (
    <div className="stack">
      <h1 className="pub-title">{t("upload_title")}</h1>
      <p className="text-secondary">{data.guideName} · {t("limits_hint")}</p>
      {data.approved && <p className="text-secondary">{t("upload_after_approval")}</p>}
      <Slot token={token} t={t} lang={lang} maxFrames={data.limits.maxFrames} hasFinal={data.versions.some((g) => g.hasFinal)} onDone={onDone} />
      {data.versions.length > 0 && <PreviousVersions versions={data.versions} t={t} />}
    </div>
  );
}

// /u/:token: 업로드 칸 하나에서 완성본·클린본을 골라 올린다 (F-59). 업로드 후 브라우저에서 프레임·오디오를 뽑아 보낸다
export function UploadPublicPage() {
  const { token = "" } = useParams();
  const [data, setData] = useState<UploadData | null>(null);
  const [error, setError] = useState(false);
  const [langPick, setLang] = useState<Lang | null>(langFromSearch(useLocation().search));
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
  const nav = useStickyNav(data ? { brand: data.brandName, tabs: data.tabs } : null);
  const tabs = nav && <InfluencerTabs tabs={nav.tabs} current="upload" t={t} lang={lang} />;

  return (
    <PublicShell centerBrand brand={nav?.brand} tabs={tabs} langLabel={t("lang_toggle")} onToggleLang={() => setLang(lang === "ko" ? "en" : "ko")}>
      {error ? <p className="pub-error">{t("link_expired")}</p> : !data ? <LoadingState label={t("loading")} /> : <UploadBody data={data} token={token} t={t} lang={lang} onDone={load} />}
    </PublicShell>
  );
}
