import { Badge } from "../../../ui";
import { fmtTimecode } from "../../../../shared/review";
import type { Frame } from "../types";

type Props = { f: Frame; active?: boolean; flagged?: boolean; onClick: () => void; role?: "listitem" };

// 프레임 썸네일 버튼 (프레임 목록, 위반 후보 근거). flagged 면 이 장면에 판단이 엇갈렸다
export function FrameThumb({ f, active, flagged, onClick, role }: Props) {
  return (
    <button type="button" role={role} className={`frame-thumb${active ? " is-active" : ""}`} onClick={onClick} aria-pressed={active}>
      <img src={f.url} alt="" loading="lazy" />
      <span>{fmtTimecode(f.tMs)}</span>
      {flagged && <Badge tone="warn">확인 필요</Badge>}
    </button>
  );
}
