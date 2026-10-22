import { useCallback, useEffect, useState } from "react";
import { EmptyState, LoadingState, Table } from "../../ui";
import { api } from "../../lib/api";
import { pct, ZERO_HINT } from "../links/common";
import { LeadDrawer, LeadsTable } from "./common";
import { EMPTY_LOOKUPS, type LeadRow, type Lookups } from "./types";
import "./leads.css";

type FunnelRow = {
  influencerId: string | null;
  name: string;
  dmSent: number;
  clicks: number;
  views: number;
  leads: number;
  siteVisited: number;
  siteScroll50: number;
  siteConverted: number;
  siteConversionValue: number;
};

const rate = (a: number, b: number) => (b ? pct(a / b) : "");

// 가이드 상세 '리드' 탭: 묶어 보기(F-53) + 이 가이드로 들어온 리드
export function GuideLeadsTab({ guideId }: { guideId: string }) {
  const [funnel, setFunnel] = useState<FunnelRow[]>([]);
  const [leads, setLeads] = useState<LeadRow[] | null>(null);
  const [lk, setLk] = useState<Lookups>(EMPTY_LOOKUPS);
  const [drawer, setDrawer] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [f, l] = await Promise.all([api.get<{ rows: FunnelRow[] }>(`/guides/${guideId}/funnel`), api.get<{ leads: LeadRow[]; lookups: Lookups }>(`/leads?guideId=${guideId}`)]);
    setFunnel(f.rows);
    setLeads(l.leads);
    setLk(l.lookups);
  }, [guideId]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="stack-section">
      <section className="stack">
        <h4>묶어 보기</h4>
        <p className="text-caption">같은 리드 링크로 이어진 수만 셉니다. 사람 단위 추적은 게이트·폼 제출 뒤부터예요. 어느 콘텐츠 하나 때문이라고 단정하지 않아요. 사이트 열은 사이트 분석에서 스크립트를 설치한 사이트로 간 클릭만 세고, 스크롤·전환 비율은 방문이 생긴 클릭 수 기준이에요.</p>
        {funnel.length === 0 ? (
          <EmptyState title="아직 인플루언서가 없어요" description="가이드에 인플루언서를 추가하고 리드 링크를 보내면 단계별 수가 보여요." />
        ) : (
          <FunnelTable rows={funnel} />
        )}
      </section>
      <section className="stack">
        <h4>이 가이드로 들어온 리드</h4>
        <GuideLeadList leads={leads} lk={lk} onOpen={setDrawer} />
      </section>
      {drawer && <LeadDrawer id={drawer} lk={lk} onClose={() => setDrawer(null)} onChanged={() => void load()} />}
    </div>
  );
}

function GuideLeadList({ leads, lk, onOpen }: { leads: LeadRow[] | null; lk: Lookups; onOpen: (id: string) => void }) {
  if (!leads) return <LoadingState />;
  if (leads.length === 0) return <EmptyState title="아직 리드가 없어요" description={`${ZERO_HINT}. 자료 게이트나 신청 폼을 목적지로 쓰면 이메일이 모여요.`} />;
  return <LeadsTable leads={leads} lk={lk} onOpen={onOpen} />;
}

// 수와 비율을 한 칸에. 사이트 단계 비율의 분모는 '방문이 생긴 클릭 ID 수'
function CountRate({ n, of }: { n: number; of: number }) {
  return <td className="num">{n}{of > 0 && <span className="text-caption"> {rate(n, of)}</span>}</td>;
}

function FunnelTable({ rows }: { rows: FunnelRow[] }) {
  return (
    <Table>
      <thead><tr><th>인플루언서</th><th className="num">댓글 DM</th><th className="num">클릭</th><th className="num">자료 열람</th><th className="num">클릭 → 열람</th><th className="num">리드</th><th className="num">클릭 → 리드</th><th className="num" title="클릭 대비 사이트 방문이 생긴 클릭 수">사이트 방문</th><th className="num">스크롤 50%</th><th className="num">전환</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.influencerId ?? "shared"}>
            <td>{r.name}</td>
            <td className="num text-secondary">{r.dmSent || "준비 중"}</td>
            <td className="num">{r.clicks || <span className="text-caption">{ZERO_HINT}</span>}</td>
            <td className="num">{r.views}</td>
            <td className="num">{rate(r.views, r.clicks)}</td>
            <td className="num">{r.leads}</td>
            <td className="num">{rate(r.leads, r.clicks)}</td>
            <CountRate n={r.siteVisited} of={r.clicks} />
            <CountRate n={r.siteScroll50} of={r.siteVisited} />
            <CountRate n={r.siteConverted} of={r.siteVisited} />
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
