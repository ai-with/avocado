import { Link } from "react-router-dom";
import { Button, CopyButton, EmptyState, Table, ButtonLink } from "../../../ui";
import { channelLabel } from "../../../../shared/leads";
import type { Channel, DocumentRow, LinkRow } from "../common";
import { HelpHeader } from "../HelpHeader";

type Props = { links: LinkRow[]; channels: Channel[]; docs: DocumentRow[]; onOpen: (l: LinkRow) => void };

const destName = (l: LinkRow, docs: DocumentRow[]) =>
  l.destinationType === "url" ? l.destinationUrl : l.destinationType === "document" ? (docs.find((d) => d.id === l.destinationId)?.title ?? "자료") : "신청 폼";

function LinkTableRow({ l, channels, docs, onOpen }: { l: LinkRow } & Omit<Props, "links">) {
  const dest = destName(l, docs);
  return (
    <tr>
      <td>{l.guideId ? <Link to={`/dashboard/campaigns/${l.guideId}`}>{l.guideName}</Link> : "공용"}</td>
      <td>{l.influencerName ?? "캠페인 공용"}</td>
      <td>{channelLabel(l.channelKey, channels)}{l.contentLabel && <div className="text-caption">{l.contentLabel}</div>}</td>
      <td className="truncate lt-dest-cell" title={dest ?? undefined}>{dest}</td>
      <td className="num">{l.stats.clicks}</td><td className="num">{l.stats.unique}</td><td className="num">{l.stats.views}</td><td className="num">{l.stats.leads}</td>
      <td className="num">{l.stats.siteSessions}</td><td className="num">{l.stats.siteConversions}</td>
      <td>
        <div className="row row-end">
          <CopyButton text={l.url} />
          <Button size="sm" variant="ghost" onClick={() => onOpen(l)}>상세</Button>
        </div>
      </td>
    </tr>
  );
}

// 워크스페이스 전체 링크 표
export function LinksTable({ links, channels, docs, onOpen }: Props) {
  if (links.length === 0) {
    return <EmptyState icon="link" title="아직 만든 링크가 없어요" description="캠페인을 열고 '리드 링크' 탭에서 목적지를 고른 뒤 '인플루언서 전체 발급'을 눌러 보세요." action={<ButtonLink to="/dashboard/campaigns">캠페인으로 가기</ButtonLink>} />;
  }
  return (
    <Table>
      <thead>
        <tr>
          <th>캠페인</th><th>인플루언서</th><th>채널</th><th>목적지</th>
          <th className="num">클릭</th><th className="num">고유</th><th className="num">열람</th><th className="num">리드</th>
          <th className="num"><HelpHeader label="사이트 세션" help="스크립트를 설치한 사이트의 방문 세션이에요(구성원 제외)." /></th><th className="num">사이트 전환</th>
          <th><span className="sr-only">동작</span></th>
        </tr>
      </thead>
      <tbody>
        {links.map((l) => <LinkTableRow key={l.id} l={l} channels={channels} docs={docs} onOpen={onOpen} />)}
      </tbody>
    </Table>
  );
}
