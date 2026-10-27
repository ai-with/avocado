import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, LoadingState, PageHeader, Tabs, useToast } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import { useMe } from "../../lib/me";
import type { GuideResponse } from "./types";
import { GuideUrlSection } from "./sections/GuideUrlSection";
import { InfluencersTab } from "./sections/InfluencersTab";
import { SendGuideModal } from "./sections/SendGuideModal";
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
const BACK = { to: "/dashboard/guides", label: "가이드" };

function useGuideDetail(id: string) {
  const toast = useToast();
  const [data, setData] = useState<GuideResponse | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const load = useCallback(async () => setData(await api.get<GuideResponse>(`/guides/${id}`)), [id]);
  useEffect(() => void load(), [load]);
  const publish = async () => {
    try {
      await api.post(`/guides/${id}/publish`);
      await load();
      setSendOpen(true);
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };
  return { data, publish, sendOpen, closeSend: () => setSendOpen(false) };
}

// 보내기 모달에서 '인플루언서 추가하기'를 누르면 인플루언서 탭을 새로 그려(key) 추가 모달을 연다
function useDetailTabs(closeSend: () => void) {
  const [tab, setTab] = useState<Tab>("influencers");
  const [addRequest, setAddRequest] = useState(0);
  const startEmail = () => {
    closeSend();
    setTab("influencers");
    setAddRequest((n) => n + 1);
  };
  return { tab, setTab, addRequest, startEmail };
}

// /guides/:id (D10 기본 단위, US-25)
export function GuideDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { me } = useMe();
  const canEdit = me?.role === "owner" || me?.role === "editor";
  const { data, publish, sendOpen, closeSend } = useGuideDetail(id);
  const { tab, setTab, addRequest, startEmail } = useDetailTabs(closeSend);
  if (!data) return <LoadingState />;
  const { guide } = data;
  const published = guide.status === "published";
  const actions = canEdit && (
    <>
      <Button variant="secondary" onClick={() => navigate(`/dashboard/guides/${id}/edit`)}>편집</Button>
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
          {tab === "influencers" && <InfluencersTab key={addRequest} guideId={id} canEdit={canEdit} published={published} openAdd={addRequest > 0} />}
          {tab === "links" && <GuideLinksTab guideId={id} />}
          {tab === "reviews" && <ReviewList guideId={id} />}
          {tab === "performance" && <GuidePerformanceTab guideId={id} />}
          {tab === "leads" && <GuideLeadsTab guideId={id} />}
        </div>
      </div>
      {sendOpen && <SendGuideModal data={data} onEmail={startEmail} onClose={closeSend} />}
    </>
  );
}
