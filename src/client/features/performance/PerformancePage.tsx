import { PageHeader } from "../../ui";
import { PerformanceTable } from "./PerformanceTable";

// /performance 성과표 (F-49, W08)
export function PerformancePage() {
  return (
    <>
      <PageHeader title="성과표" description="게시물별 24시간·3일·7일 지표와 링크 클릭, 리드를 한 표에서 봐요." />
      <PerformanceTable />
    </>
  );
}

// 가이드 상세 '성과' 탭
export function GuidePerformanceTab({ guideId }: { guideId: string }) {
  return <PerformanceTable guideId={guideId} />;
}
