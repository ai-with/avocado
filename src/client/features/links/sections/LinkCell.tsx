import { Button, useToast } from "../../../ui";
import type { LinkRow } from "../common";

type CellProps = { base: LinkRow | undefined; contents: LinkRow[]; title: string; onOpen: (l: LinkRow) => void; onAddContent: (base: LinkRow) => void };

// 단축 주소를 누르면 복사한다. 기본 링크와 콘텐츠 링크가 같이 쓴다
function SlugCopy({ l, suffix = "" }: { l: LinkRow; suffix?: string }) {
  const toast = useToast();
  return (
    <button type="button" className="lt-link" aria-label={`/l/${l.slug} 링크 복사`} onClick={() => void navigator.clipboard.writeText(l.url).then(() => toast("링크를 복사했어요."))}>
      /l/{l.slug}{suffix}
    </button>
  );
}

// 콘텐츠 이름을 누르면 상세(이름 바꾸기, 삭제)가 열린다
function ContentLine({ l, onOpen }: { l: LinkRow; onOpen: (l: LinkRow) => void }) {
  return (
    <li className="lt-content-line text-caption">
      <button type="button" className="link-button" onClick={() => onOpen(l)}>{l.contentLabel}</button>
      <span aria-hidden="true">·</span>
      <SlugCopy l={l} />
      <span aria-hidden="true">·</span>
      <span className="nowrap">클릭 {l.stats.clicks}</span>
    </li>
  );
}

// 링크 표 한 칸: 기본 링크, 그 아래 콘텐츠별 링크, 콘텐츠별 링크 추가 버튼
export function LinkCell({ base, contents, title, onOpen, onAddContent }: CellProps) {
  if (!base) return <span className="text-caption">없음</span>;
  return (
    <div className="lt-cell" title={title}>
      <SlugCopy l={base} suffix=" 복사" />
      <span className="text-caption">클릭 {base.stats.clicks} · 리드 {base.stats.leads}</span>
      <button type="button" className="lt-link" onClick={() => onOpen(base)}>QR · 카드 · UTM</button>
      {contents.length > 0 && (
        <ul className="list-plain lt-content-list" aria-label="콘텐츠별 링크">
          {contents.map((l) => <ContentLine key={l.id} l={l} onOpen={onOpen} />)}
        </ul>
      )}
      <div><Button size="sm" variant="ghost" onClick={() => onAddContent(base)}>콘텐츠별 링크 추가</Button></div>
    </div>
  );
}
