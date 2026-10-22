import { Button, Input, SectionCard, Select, ButtonLink } from "../../../ui";
import type { DestinationType } from "../../../../shared/leads";
import { FilePickButton } from "../FilePickButton";
import { hasUtm, type GuideLinksState } from "../useGuideLinks";

function DestinationPicker({ s }: { s: GuideLinksState }) {
  const d = s.dest;
  return (
    <div className="lt-grid2">
      <Select label="링크를 누르면 갈 곳" value={d.destType} onChange={(e) => d.setDestType(e.target.value as DestinationType)}>
        <option value="document">우리 자료</option>
        <option value="form">신청 폼</option>
        <option value="url">외부 주소</option>
      </Select>
      {d.destType === "url" ? (
        <Input label="주소" placeholder="https://" value={d.destUrl} onChange={(e) => d.setDestUrl(e.target.value)} hint={hasUtm(d.destUrl) ? "이미 UTM이 있어요. 발급하면 링크별 값으로 덮어써요." : undefined} />
      ) : (
        <Select label={d.destType === "document" ? "자료" : "폼"} value={d.destId} onChange={(e) => d.setDestId(e.target.value)}>
          {d.choices.length === 0 && <option value="">{d.destType === "document" ? "자료를 먼저 올려 주세요" : "폼을 먼저 만들어 주세요"}</option>}
          {d.choices.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </Select>
      )}
    </div>
  );
}

function CreateDestinationActions({ s, guideId }: { s: GuideLinksState; guideId: string }) {
  if (s.dest.destType === "url") return null;
  return (
    <div className="row row-wrap">
      {s.dest.destType === "document" ? (
        <>
          <FilePickButton label={s.busy ? "올리는 중" : "PDF 올리기 (50MB까지)"} accept="application/pdf" disabled={s.busy} onFile={(f) => void s.upload(f)} />
          <ButtonLink variant="ghost" size="sm" to={`/documents/new?guideId=${guideId}`}>직접 쓰기·홈페이지 주소로 만들기</ButtonLink>
        </>
      ) : (
        <ButtonLink size="sm" to={`/forms/new?guideId=${guideId}`}>폼 만들기</ButtonLink>
      )}
    </div>
  );
}

// 1. 목적지 고르기, 2. 링크 만들기
export function DestinationSection({ s, guideId }: { s: GuideLinksState; guideId: string }) {
  const n = s.data?.influencers.length ?? 0;
  const ch = s.data?.channels.length ?? 0;
  const disabled = s.busy || !s.dest.canIssue;
  return (
    <SectionCard title="1. 목적지 고르기">
      <div className="stack">
        <DestinationPicker s={s} />
        <CreateDestinationActions s={s} guideId={guideId} />
        <h4>2. 링크 만들기</h4>
        <p className="text-secondary">
          {n
            ? `인플루언서 ${n}명 × 채널 ${ch}개 = 링크 ${n * ch}개를 한 번에 만들어요. 이미 있는 칸은 건너뛰어요.`
            : "아직 인플루언서가 없어요. 가이드 공용 링크를 만들고, 인플루언서를 추가한 뒤 다시 발급하면 행이 생겨요."}
        </p>
        <div className="row row-wrap">
          <Button disabled={disabled} onClick={() => void s.issue("all")}>인플루언서 전체 발급</Button>
          <Button variant="secondary" disabled={disabled} onClick={() => void s.issue("shared")}>가이드 공용 링크 만들기</Button>
        </div>
      </div>
    </SectionCard>
  );
}
