import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge, ButtonLink, EmptyState, FilterBar, LoadingState, PageHeader, Table, SelectMenu } from "../../ui";
import { fmtDate } from "../guides/types";
import { CAMPAIGN_STATUS_LABEL, campaignPath, useBrands, useCampaigns, type CampaignRow } from "./api";

function CampaignTableRow({ c }: { c: CampaignRow }) {
  const published = c.guideStatus === "published";
  return (
    <tr>
      <td><Link to={campaignPath(c.id)}>{c.name}</Link></td>
      <td>{c.brandName}</td>
      <td className="nowrap"><Badge tone={c.status === "active" ? "accent" : "neutral"}>{CAMPAIGN_STATUS_LABEL[c.status]}</Badge></td>
      <td className="nowrap"><Badge tone={published ? "success" : "neutral"}>{published ? "공개" : "작성 중"}</Badge></td>
      <td className="num">{c.influencerCount}</td>
      <td className="nowrap">{fmtDate(c.createdAt)}</td>
    </tr>
  );
}

// /dashboard/campaigns: 브랜드별 캠페인 목록 (TASK-070, 브랜드:캠페인:인플루언서 = 1:N:M)
export function CampaignsListPage() {
  // 브랜드 설정의 '캠페인 보기'가 ?brand=<id> 로 연다
  const [params] = useSearchParams();
  const [brandId, setBrandId] = useState(params.get("brand") ?? "");
  const { brands } = useBrands();
  const rows = useCampaigns(brandId);
  const create = <ButtonLink variant="primary" to="/dashboard/campaigns/new">새 캠페인 만들기</ButtonLink>;
  const filter = brandId !== "" || (rows?.length ?? 0) > 0;

  return (
    <>
      <PageHeader title="캠페인" description="브랜드마다 캠페인을 만들고 인플루언서를 배정해요. 캠페인마다 브랜드 가이드가 하나씩 있어요." actions={create} />
      <div className="stack">
        {filter && (
          <FilterBar label="캠페인 필터">
            <SelectMenu aria-label="브랜드" options={[{ value: "", label: "모든 브랜드" }, ...(brands ?? []).map((b) => ({ value: b.id, label: b.name }))]} value={brandId} onChange={(v) => setBrandId(v ?? "")} />
          </FilterBar>
        )}
        {rows === null ? <LoadingState /> : rows.length === 0 ? (
          <EmptyState title="아직 캠페인이 없어요" description="브랜드를 고르고 캠페인을 만들면 브랜드 가이드를 바로 쓸 수 있어요." action={create} />
        ) : (
          <Table>
            <thead>
              <tr><th>캠페인</th><th>브랜드</th><th>상태</th><th>브랜드 가이드</th><th className="num">인플루언서</th><th>만든 날짜</th></tr>
            </thead>
            <tbody>{rows.map((c) => <CampaignTableRow key={c.id} c={c} />)}</tbody>
          </Table>
        )}
      </div>
    </>
  );
}
