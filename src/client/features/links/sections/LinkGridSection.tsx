import { Button, EmptyState, Input, Table } from "../../../ui";
import type { Channel, DocumentRow, FormRow, LinkRow } from "../common";
import type { GuideLinks, GuideLinksState } from "../useGuideLinks";
import { LinkCell } from "./LinkCell";

type Row = { id: string | null; name: string; handle: string | null };

const gridRows = (data: GuideLinks): Row[] => [
  ...data.influencers.map((i) => ({ id: i.id, name: i.name, handle: i.igHandle ?? i.threadsHandle })),
  ...(data.links.some((l) => !l.influencerId) ? [{ id: null, name: "가이드 공용", handle: null }] : []),
];

const destName = (l: LinkRow, docs: DocumentRow[], forms: FormRow[]) =>
  l.destinationType === "url" ? l.destinationUrl : l.destinationType === "document" ? docs.find((d) => d.id === l.destinationId)?.title : forms.find((f) => f.id === l.destinationId)?.title;

function LinkGrid({ data, channels, s }: { data: GuideLinks; channels: Channel[]; s: GuideLinksState }) {
  const inCell = (inf: string | null, ch: string) => data.links.filter((l) => l.influencerId === inf && l.channelKey === ch);
  return (
    <Table>
      <thead>
        <tr><th>인플루언서</th>{channels.map((ch) => <th key={ch.key}>{ch.name}</th>)}</tr>
      </thead>
      <tbody>
        {gridRows(data).map((r) => (
          <tr key={r.id ?? "shared"}>
            <td><b>{r.name}</b>{r.handle && <div className="text-caption">@{r.handle}</div>}</td>
            {channels.map((ch) => {
              const links = inCell(r.id, ch.key);
              const base = links.find((l) => !l.contentKey);
              const contents = links.filter((l) => l.contentKey);
              const title = base ? `목적지: ${destName(base, s.docs, s.forms) ?? ""}` : "";
              return <td key={ch.key}><LinkCell base={base} contents={contents} title={title} onOpen={s.setOpen} onAddContent={s.setContentBase} /></td>;
            })}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

// 인플루언서 × 채널 링크 표와 채널 추가
export function LinkGridSection({ data, s }: { data: GuideLinks; s: GuideLinksState }) {
  return (
    <section className="stack">
      <div className="row row-between row-wrap">
        <h4>링크 표</h4>
        <div className="row">
          <Input aria-label="새 채널 이름" placeholder="새 채널 이름 (예: 유튜브 설명란)" value={s.newChannel} onChange={(e) => s.setNewChannel(e.target.value)} />
          <Button size="sm" variant="secondary" onClick={() => void s.addChannel()}>채널 추가</Button>
        </div>
      </div>
      {data.links.length === 0 ? (
        <EmptyState icon="link" title="아직 만든 링크가 없어요" description="목적지를 고르고 '인플루언서 전체 발급'을 누르면 인플루언서마다, 채널마다 다른 링크가 생겨요." />
      ) : (
        <LinkGrid data={data} channels={data.channels} s={s} />
      )}
      <p className="text-caption">인스타그램 피드 캡션의 링크는 눌리지 않아요. 바이오, 스토리 링크 스티커, DM으로 보내 주세요. 팀원이 로그인한 채로 누른 클릭은 세지 않아요.</p>
    </section>
  );
}
