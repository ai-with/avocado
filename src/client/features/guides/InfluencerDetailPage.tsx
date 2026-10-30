import { Fragment, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge, Button, EmptyState, LoadingState, PageHeader, SectionCard, Table, useToast } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import { useMe } from "../../lib/me";
import { countryName } from "../../lib/countries";
import { STATUS_LABEL, type ParticipationStatus, type ParticipationTerms } from "../../../shared/participation";
import { handlesText, langLabel } from "./InfluencersPage";
import { STATUS_TONE, periodText, termsSummary } from "./participation";
import { ContactTimeline } from "./sections/ContactTimeline";
import type { Influencer } from "./types";
import "./guides.css";

type Participation = {
  id: string;
  guideId: string;
  campaignName: string;
  brandId: string;
  brandName: string;
  status: ParticipationStatus;
  terms: ParticipationTerms | null;
  round: number;
  contractStartAt: number | null;
  contractEndAt: number | null;
};
type Detail = { influencer: Influencer; participations: Participation[] };
type BrandGroup = { brandId: string; brandName: string; items: Participation[] };

const BACK = { to: "/dashboard/influencers", label: "인플루언서" };
const COLUMNS = [{ label: "회차" }, { label: "캠페인" }, { label: "진행 상태" }, { label: "조건" }, { label: "계약 기간" }, { label: "소통 이력" }];

function groupByBrand(list: Participation[]): BrandGroup[] {
  const groups = new Map<string, BrandGroup>();
  for (const p of list) {
    const g = groups.get(p.brandId) ?? { brandId: p.brandId, brandName: p.brandName, items: [] };
    g.items.push(p);
    groups.set(p.brandId, g);
  }
  return [...groups.values()];
}

function useInfluencerDetail(id: string) {
  const toast = useToast();
  const [data, setData] = useState<Detail | null>(null);
  useEffect(() => {
    api.get<Detail>(`/influencers/${id}`).then(setData, (e: unknown) => toast(errorMessage(e), "danger"));
  }, [id, toast]);
  return data;
}

function ParticipationRows({ p, canEdit, open, onToggle }: { p: Participation; canEdit: boolean; open: boolean; onToggle: () => void }) {
  return (
    <Fragment>
      <tr>
        <td className="nowrap"><Badge tone={p.round > 1 ? "accent" : "neutral"}>{p.round}회차</Badge></td>
        <td><Link to={`/dashboard/campaigns/${p.guideId}`}>{p.campaignName}</Link></td>
        <td className="nowrap"><Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge></td>
        <td>{termsSummary(p.terms) || <span className="text-caption">없음</span>}</td>
        <td className="nowrap">{periodText(p.contractStartAt, p.contractEndAt) || <span className="text-caption">미정</span>}</td>
        <td className="text-right"><Button size="sm" variant="ghost" aria-expanded={open} onClick={onToggle}>{open ? "접기" : "펼치기"}</Button></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={COLUMNS.length}>
            <ContactTimeline path={`/guides/${p.guideId}/influencers/${p.id}`} canEdit={canEdit} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function BrandSection({ group, canEdit }: { group: BrandGroup; canEdit: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <SectionCard title={group.brandName} description={`이 브랜드 캠페인에 ${group.items.length}번 참여했어요.`}>
      <Table columns={COLUMNS}>
        <tbody>
          {group.items.map((p) => (
            <ParticipationRows key={p.id} p={p} canEdit={canEdit} open={openId === p.id} onToggle={() => setOpenId(openId === p.id ? null : p.id)} />
          ))}
        </tbody>
      </Table>
    </SectionCard>
  );
}

// /influencers/:id 인플루언서 상세: 기본 정보 + 브랜드별 캠페인 참여(회차, 상태, 조건, 기간)와 소통 이력 (TASK-072)
export function InfluencerDetailPage() {
  const { id = "" } = useParams();
  const { me } = useMe();
  const canEdit = me?.role === "owner" || me?.role === "editor";
  const data = useInfluencerDetail(id);
  if (!data) return <LoadingState pattern="detail" label="인플루언서를 불러오는 중" />;
  const { influencer: i, participations } = data;
  return (
    <>
      <PageHeader title={i.displayName} description={handlesText(i)} back={BACK} />
      <div className="stack-loose">
        <SectionCard title="기본 정보">
          <dl className="kv">
            <dt>이메일</dt><dd>{i.email || "없음"}</dd>
            <dt>언어</dt><dd>{langLabel(i.lang)}</dd>
            <dt>국가</dt><dd>{countryName(i.country) || "없음"}</dd>
          </dl>
        </SectionCard>
        {participations.length === 0 ? (
          <EmptyState title="아직 참여한 캠페인이 없어요" description="캠페인 상세에서 이 인플루언서를 추가하면 여기에 참여 이력이 쌓여요." />
        ) : (
          groupByBrand(participations).map((g) => <BrandSection key={g.brandId} group={g} canEdit={canEdit} />)
        )}
      </div>
    </>
  );
}
