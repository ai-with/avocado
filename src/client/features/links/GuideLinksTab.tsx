import { LoadingState } from "../../ui";
import { LinkAnalytics } from "./LinkAnalytics";
import { LinkDetailModal } from "./LinkDetailModal";
import { DestinationSection } from "./sections/DestinationSection";
import { GuideDocsSection } from "./sections/GuideDocsSection";
import { LinkGridSection } from "./sections/LinkGridSection";
import { useGuideLinks } from "./useGuideLinks";
import "./lead-tools.css";

// 가이드 상세 '리드 링크' 탭 (F-50, F-51). 목적지 고르기 → 인플루언서 × 채널 발급 → 표, QR, 카드, 분석
export function GuideLinksTab({ guideId }: { guideId: string }) {
  const s = useGuideLinks(guideId);
  const { data, docs } = s;
  if (!data) return <LoadingState />;
  const guideDocs = docs.filter((d) => d.guideId === guideId || data.links.some((l) => l.destinationType === "document" && l.destinationId === d.id));
  const reload = () => void s.load();

  return (
    <div className="stack-section">
      <DestinationSection s={s} guideId={guideId} />
      <LinkGridSection data={data} s={s} />
      <GuideDocsSection docs={guideDocs} channels={data.channels} onSaved={reload} />
      <LinkAnalytics guideId={guideId} channels={data.channels} />
      {s.open && <LinkDetailModal link={s.open} channels={data.channels} onClose={() => s.setOpen(null)} onChanged={reload} />}
    </div>
  );
}
