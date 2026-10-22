import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, LoadingState, PageHeader, Tabs, useToast } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import { useMe } from "../../lib/me";
import type { GuideResponse } from "./types";
import { GuideUrlSection } from "./sections/GuideUrlSection";
import { InfluencersTab } from "./sections/InfluencersTab";
import "./guides.css";
import { GuideLinksTab } from "../links/GuideLinksTab";
import { GuideLeadsTab } from "../leads/GuideLeadsTab";
import { GuidePerformanceTab } from "../performance/PerformancePage";
import { ReviewList } from "../reviews/ReviewsPage";

type Tab = "influencers" | "links" | "reviews" | "performance" | "leads";
const TABS: { value: Tab; label: string }[] = [
  { value: "influencers", label: "인플루언서" },
  { value: "links", label: "리드 링크" },
  { value: "reviews", label: "검수" },
  { value: "performance", label: "성과" },
  { value: "leads", label: "리드" },
];
const BACK = { to: "/guides", label: "가이드" };

function useGuideDetail(id: string) {
  const toast = useToast();
  const [data, setData] = useState<GuideResponse | null>(null);
  const load = useCallback(async () => setData(await api.get<GuideResponse>(`/guides/${id}`)), [id]);
  useEffect(() => void load(), [load]);
  const publish = async () => {
    try {
      await api.post(`/guides/${id}/publish`);
      toast("가이드를 공개했습니다.", "success");
      await load();
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };
  return { data, publish };
}

// /guides/:id (D10 기본 단위, US-25)
export function GuideDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { me } = useMe();
  const canEdit = me?.role === "owner" || me?.role === "editor";
  const { data, publish } = useGuideDetail(id);
  const [tab, setTab] = useState<Tab>("influencers");
  if (!data) return <LoadingState />;
  const { guide } = data;
  const published = guide.status === "published";
  const actions = canEdit && (
    <>
      <Button variant="secondary" onClick={() => navigate(`/guides/${id}/edit`)}>편집</Button>
      {!published && <Button onClick={() => void publish()}>공개하기</Button>}
    </>
  );

  return (
    <>
      <PageHeader title={guide.name} description={[guide.product.name, guide.purpose].filter(Boolean).join(" · ")} actions={actions} back={BACK} />
      <div className="stack-loose">
        <GuideUrlSection data={data} />
        <div>
          <Tabs tabs={TABS} value={tab} onChange={setTab} />
          {tab === "influencers" && <InfluencersTab guideId={id} canEdit={canEdit} published={published} />}
          {tab === "links" && <GuideLinksTab guideId={id} />}
          {tab === "reviews" && <ReviewList guideId={id} />}
          {tab === "performance" && <GuidePerformanceTab guideId={id} />}
          {tab === "leads" && <GuideLeadsTab guideId={id} />}
        </div>
      </div>
    </>
  );
}
