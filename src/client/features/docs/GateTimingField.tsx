import { Checkbox } from "../../ui";
import type { DocumentGate } from "../../../shared/leads";
import "./docs.css";

const timingText = (pct: number) => (pct === 0 ? "열자마자 물어요" : pct === 100 ? "끝까지 읽은 뒤에 물어요" : `본문을 ${pct}% 읽으면 물어요`);

// 정보 입력 다이얼로그를 언제 띄울지. 0%: 열자마자, 100%: 끝까지 읽은 뒤
export function GateTimingField({ gate, onChange }: { gate: DocumentGate; onChange: (patch: Partial<DocumentGate>) => void }) {
  const on = gate.position === "scroll";
  return (
    <div className="stack-tight gate-timing">
      <Checkbox
        label="읽는 사람에게 정보 입력 받기"
        checked={on}
        onChange={(e) => onChange({ position: e.target.checked ? "scroll" : "none" })}
      />
      {on && (
        <>
          <label className="field-label" htmlFor="gate-pct">정보 입력 다이얼로그 노출 시점: {timingText(gate.scrollPct)}</label>
          <input
            id="gate-pct"
            type="range"
            min={0}
            max={100}
            step={5}
            value={gate.scrollPct}
            onChange={(e) => onChange({ scrollPct: Number(e.target.value) })}
          />
          <div className="gate-timing-scale"><span>0% 열자마자</span><span>50%</span><span>100% 다 읽은 뒤</span></div>
          <p className="text-caption">다이얼로그가 뜨면 남긴 정보를 받기 전까지 그 아래 내용은 볼 수 없어요. 한 번 남긴 사람에게는 같은 브라우저에서 다시 묻지 않아요. PDF와 홈페이지 주소 자료는 나눠 보낼 수 없어서 100%가 아니면 열자마자 물어요.</p>
        </>
      )}
    </div>
  );
}
