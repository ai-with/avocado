import { useEffect, useState } from "react";
import { Card, EmptyState, LoadingState, SegmentedControl, Stat, StatGrid } from "../../ui";
import { api } from "../../lib/api";
import { channelLabel } from "../../../shared/leads";
import { ZERO_HINT, type Channel } from "./common";

type Bucket = { key: string; clicks: number; unique: number };
type Analytics = {
  days: number;
  total: { clicks: number; unique: number };
  byChannel: Bucket[];
  byInfluencer: (Bucket & { name: string })[];
  byContent: (Bucket & { name: string })[];
  daily: { key: string; clicks: number }[];
  referrers: Bucket[];
  devices: Bucket[];
  countries: Bucket[];
};

const DEVICE: Record<string, string> = { mobile: "모바일", desktop: "PC", other: "기타" };
const PERIOD_OPTIONS = [7, 30, 90].map((d) => ({ value: String(d), label: `${d}일` }));
const DEFAULT_DAYS = 30;

export function Bars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="lt-bars">
      {rows.map((r) => (
        <div className="lt-bar" key={r.label}>
          <span title={r.label}>{r.label}</span>
          <div className="lt-bar-track"><div className="lt-bar-fill" style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <span className="num">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function BarCard({ title, rows }: { title: string; rows: { label: string; value: number }[] }) {
  return <Card className="stack"><span className="text-caption">{title}</span><Bars rows={rows} /></Card>;
}

function DailyChart({ daily }: { daily: Analytics["daily"] }) {
  const maxDay = Math.max(1, ...daily.map((d) => d.clicks));
  return (
    <Card>
      <span className="text-caption">일별 클릭</span>
      <div className="lt-daily" role="img" aria-label={`일별 클릭 막대 그래프, ${daily[0]?.key ?? ""}부터 ${daily.at(-1)?.key ?? ""}까지`}>
        {daily.map((d) => <div key={d.key} title={`${d.key}: ${d.clicks}`} style={{ height: `${(d.clicks / maxDay) * 100}%` }} />)}
      </div>
      <div className="row row-between text-caption"><span>{daily[0]?.key}</span><span>{daily.at(-1)?.key}</span></div>
    </Card>
  );
}

function AnalyticsBody({ data, channels }: { data: Analytics; channels: Channel[] }) {
  return (
    <>
      <StatGrid>
        <Stat label="클릭" value={data.total.clicks} />
        <Stat label="고유 방문자 추정" value={data.total.unique} />
      </StatGrid>
      <DailyChart daily={data.daily} />
      <div className="lt-grid2">
        <BarCard title="채널별" rows={data.byChannel.map((b) => ({ label: channelLabel(b.key, channels), value: b.clicks }))} />
        <BarCard title="인플루언서별" rows={data.byInfluencer.map((b) => ({ label: b.name, value: b.clicks }))} />
        <BarCard title="콘텐츠별" rows={data.byContent.map((b) => ({ label: b.name, value: b.clicks }))} />
        <BarCard title="유입 경로(리퍼러)" rows={data.referrers.map((b) => ({ label: b.key ? hostOf(b.key) : "직접 입력·앱 안", value: b.clicks }))} />
        <BarCard
          title="기기 · 국가"
          rows={[...data.devices.map((b) => ({ label: DEVICE[b.key] ?? b.key, value: b.clicks })), ...data.countries.map((b) => ({ label: b.key || "알 수 없음", value: b.clicks }))]}
        />
      </div>
    </>
  );
}

// 클릭 분석. 봇·미리보기 크롤러와 로그인한 팀원의 클릭은 서버에서 뺀 값이다
export function LinkAnalytics({ guideId, channels }: { guideId?: string; channels: Channel[] }) {
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [data, setData] = useState<Analytics | null>(null);
  useEffect(() => {
    const q = new URLSearchParams({ days: String(days) });
    if (guideId) q.set("guideId", guideId);
    void api.get<Analytics>(`/links/analytics?${q}`).then(setData);
  }, [guideId, days]);

  return (
    <section className="stack">
      <div className="row row-between row-wrap">
        <h4>클릭 분석</h4>
        <SegmentedControl label="분석 기간" size="sm" options={PERIOD_OPTIONS} value={String(days)} onChange={(v) => setDays(Number(v))} />
      </div>
      {!data ? (
        <LoadingState />
      ) : data.total.clicks === 0 ? (
        <EmptyState title="아직 클릭이 없어요" description={`${ZERO_HINT}. 팀원이 로그인한 채로 누른 클릭과 미리보기 봇은 세지 않아요.`} />
      ) : (
        <AnalyticsBody data={data} channels={channels} />
      )}
    </section>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
