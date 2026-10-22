import { fmtTimecode } from "../../../../shared/review";
import type { Frame } from "../types";

// 프레임 썸네일 버튼 (프레임 목록, 위반 후보 근거)
export function FrameThumb({ f, active, onClick, role }: { f: Frame; active?: boolean; onClick: () => void; role?: "listitem" }) {
  return (
    <button type="button" role={role} className={`frame-thumb${active ? " is-active" : ""}`} onClick={onClick} aria-pressed={active}>
      <img src={f.url} alt="" loading="lazy" />
      <span>{fmtTimecode(f.tMs)}</span>
    </button>
  );
}
