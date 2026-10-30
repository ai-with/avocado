import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Button, LoadingState, PageHeader, Tabs, useToast } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import { useMe } from "../../lib/me";
import type { GuideResponse } from "./types";
import { GuideUrlSection } from "./sections/GuideUrlSection";
import { InfluencersTab } from "./sections/InfluencersTab";
import { EditCampaignModal } from "./sections/EditCampaignModal";
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
const BACK = { to: "/dashboard/campaigns", label: "캠페인" };

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
  // 캠페인 보관·다시 열기. 브랜드 가이드 링크는 그대로 열린다
  const toggleArchive = async () => {
    if (!data?.campaign) return;
    try {
      await api.patch(`/campaigns/${data.campaign.id}`, { status: data.campaign.status === "active" ? "archived" : "active" });
      await load();
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };
  return { data, load, publish, toggleArchive, sendOpen, closeSend: () => setSendOpen(false) };
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

// /campaigns/:id 캠페인 상세 = 브랜드 가이드 1:1 (D10 기본 단위, US-25, TASK-070)
export function GuideDetailPage() {
  const { id = "" } = useParams();
  const { me } = useMe();
  const canEdit = me?.role === "owner" || me?.role === "editor";
  const { data, load, publish, toggleArchive, sendOpen, closeSend } = useGuideDetail(id);
  const [editOpen, setEditOpen] = useState(false);
  const { tab, setTab, addRequest, startEmail } = useDetailTabs(closeSend);
  if (!data) return <LoadingState />;
  const { guide, campaign } = data;
  const published = guide.status === "published";
  const archived = campaign?.status === "archived";
  const actions = canEdit && (
    <>
      {campaign && <Button variant="secondary" onClick={() => setEditOpen(true)}>캠페인 정보 수정</Button>}
      {campaign && <Button variant="secondary" onClick={() => void toggleArchive()}>{archived ? "다시 열기" : "보관하기"}</Button>}
      {!published && <Button onClick={() => void publish()}>공개하기</Button>}
    </>
  );
  const description = [archived && "보관한 캠페인", campaign?.brandName, guide.product.name, guide.purpose].filter(Boolean).join(" · ");

  return (
    <>
      <PageHeader title={campaign?.name ?? guide.name} description={description} actions={actions} back={BACK} />
      <div className="stack-loose">
        <GuideUrlSection data={data} editTo={canEdit ? `/dashboard/campaigns/${id}/edit` : undefined} />
        <div>
          <Tabs tabs={TABS} value={tab} onChange={setTab} />
          {tab === "influencers" && <InfluencersTab key={addRequest} guideId={id} canEdit={canEdit} published={published} openAdd={addRequest > 0} />}
          {tab === "links" && <GuideLinksTab guideId={id} />}
          {tab === "reviews" && <ReviewList guideId={id} />}
          {tab === "performance" && <GuidePerformanceTab guideId={id} />}
          {tab === "leads" && <GuideLeadsTab guideId={id} />}
        </div>
      </div>
      {editOpen && campaign && <EditCampaignModal campaign={campaign} onSaved={load} onClose={() => setEditOpen(false)} />}
      {sendOpen && <SendGuideModal data={data} onEmail={startEmail} onClose={closeSend} />}
    </>
  );
}
