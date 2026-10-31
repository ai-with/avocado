import { Stat, StatGrid, Table } from "../../../ui";
import { channelLabel } from "../../../../shared/leads";
import { countText, documentViewRate, pct, VIEW_METRICS_HELP, type Channel, type DocumentSourceStats, type DocumentViewStats } from "../common";
import { HelpHeader } from "../HelpHeader";

type Summary = DocumentViewStats & { completionRate: number; avgScrollPct: number };

export function DocumentViewSummary({ stats }: { stats: Summary }) {
  const measured = stats.measuredClicks > 0 ? `측정 가능 클릭 ${countText(stats.measuredClicks)}` : "측정 기록 없음";
  return (
    <StatGrid>
      <Stat label="고유 열람(클릭)" value={countText(stats.uniqueViews)} hint={VIEW_METRICS_HELP.uniqueViews} />
      <Stat label="재열람(브라우저 추정)" value={countText(stats.reViews)} hint={VIEW_METRICS_HELP.reViews} />
      <Stat label="열람률" value={documentViewRate(stats)} hint={`${measured} · 전체 클릭 ${countText(stats.clicks)}`} />
      <Stat label="미연결 열람" value={countText(stats.unattributedViews)} hint={VIEW_METRICS_HELP.unattributedViews} />
      <Stat label="전체 열람" value={countText(stats.views)} hint={VIEW_METRICS_HELP.views} />
      <Stat label="완독률" value={pct(stats.completionRate)} />
      <Stat label="평균 스크롤 깊이" value={`${stats.avgScrollPct}%`} />
    </StatGrid>
  );
}

const sourceName = (source: DocumentSourceStats, channels: Channel[]) => source.linkId
  ? `${source.influencerName ?? "가이드 공용"} · ${source.channelKey ? channelLabel(source.channelKey, channels) : "채널 없음"}`
  : "직접 유입·연결 정보 없음";

export function DocumentSourceTable({ rows, channels }: { rows: DocumentSourceStats[]; channels: Channel[] }) {
  return (
    <Table>
      <thead><tr>
        <th scope="col">인플루언서 · 채널</th>
        <th scope="col" className="num"><HelpHeader label="전체 클릭" help={VIEW_METRICS_HELP.clicks} /></th>
        <th scope="col" className="num"><HelpHeader label="측정 가능 클릭" help={VIEW_METRICS_HELP.measuredClicks} /></th>
        <th scope="col" className="num"><HelpHeader label="고유 열람(클릭)" help={VIEW_METRICS_HELP.uniqueViews} /></th>
        <th scope="col" className="num"><HelpHeader label="열람률" help={VIEW_METRICS_HELP.rate} /></th>
        <th scope="col" className="num"><HelpHeader label="재열람" help={VIEW_METRICS_HELP.reViews} /></th>
        <th scope="col" className="num"><HelpHeader label="미연결 열람" help={VIEW_METRICS_HELP.unattributedViews} /></th>
        <th scope="col" className="num">전체 열람</th><th scope="col" className="num">완독</th>
      </tr></thead>
      <tbody>{rows.map((source) => <tr key={source.linkId ?? "unattributed"}>
        <td>{sourceName(source, channels)}</td>
        <td className="num">{countText(source.clicks)}</td><td className="num">{countText(source.measuredClicks)}</td>
        <td className="num">{countText(source.uniqueViews)}</td><td className="num">{documentViewRate(source)}</td>
        <td className="num">{countText(source.reViews)}</td><td className="num">{countText(source.unattributedViews)}</td>
        <td className="num">{countText(source.views)}</td><td className="num">{countText(source.completed)}</td>
      </tr>)}</tbody>
    </Table>
  );
}
