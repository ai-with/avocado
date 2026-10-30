import { useLocation } from "react-router-dom";
import { LinkTabs } from "../../../ui";
import type { Lang } from "../../../i18n";
import { withLangParam } from "../../../../shared/guide-public";
import type { InfluencerTabKey, InfluencerTabs as TabLinks } from "../../../../shared/influencer-tabs";
import type { T } from "../guideTypes";
import { DeadlineCountdown } from "./DeadlineCountdown";

type Nav = { brand: string; tabs: TabLinks };

// ponytail: 모듈 변수 캐시. 탭을 옮기면 새 화면이 데이터를 받기 전까지 직전 화면의 브랜드·탭 줄을 보여 줘
// 헤더가 흔들리지 않게 한다. 같은 인플루언서의 탭 주소일 때만 쓴다
let lastNav: Nav | null = null;

export function useStickyNav(fresh: Nav | null): Nav | null {
  const { pathname } = useLocation();
  if (fresh) {
    lastNav = fresh;
    return fresh;
  }
  const paths = lastNav ? [lastNav.tabs.guide, lastNav.tabs.upload, lastNav.tabs.feedback] : [];
  return paths.includes(pathname) ? lastNav : null;
}

const withLang = (to: string | null, lang: Lang) => (to ? withLangParam(to, lang) : null);

// 가이드·영상 올리기·피드백을 한 페이지처럼 오가는 탭 줄 (AIWITH-480). 언어는 ?lang= 으로 넘겨 이동 후에도 유지
export function InfluencerTabs({ tabs, current, t, lang }: { tabs: TabLinks; current: InfluencerTabKey; t: T; lang: Lang }) {
  return (
    <div className="pub-tabs">
      <LinkTabs
        label={t("tabs_label")}
        current={current}
        tabs={[
          { key: "guide", label: t("tab_guide"), to: withLang(tabs.guide, lang) },
          { key: "upload", label: t("tab_upload"), to: withLang(tabs.upload, lang) },
          { key: "feedback", label: t("tab_feedback"), to: withLang(tabs.feedback, lang), count: tabs.unreadFeedback },
        ]}
      />
      {(!tabs.upload || tabs.deadlineAt !== null) && (
        <div className="pub-tabs-hint">
          {!tabs.upload && <p className="text-caption">{t("tab_locked_upload")}</p>}
          {tabs.deadlineAt !== null && <DeadlineCountdown at={tabs.deadlineAt} t={t} />}
        </div>
      )}
    </div>
  );
}
