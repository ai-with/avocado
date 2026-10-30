import type { RenderResult } from "../../../../shared/message-render";
import "../messages.css";

const VAR_CLASS = { ok: "msg-var", empty: "msg-var msg-var-empty", unknown: "msg-var msg-var-unknown" } as const;
const VAR_TITLE = { ok: undefined, empty: "값이 비었어요", unknown: "없는 변수예요" } as const;

// 채운 미리보기. 값이 빈 변수는 주의색, 없는 변수는 오류색으로 강조한다 (TASK-073)
export function MessagePreview({ result, label = "미리보기" }: { result: RenderResult; label?: string }) {
  return (
    <div className="stack-tight">
      <span className="text-caption">{label}</span>
      <div className="msg-preview" aria-label={label}>
        {result.parts.map((p, i) =>
          "key" in p ? (
            <mark key={i} className={VAR_CLASS[p.state]} title={VAR_TITLE[p.state]}>{p.value}</mark>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </div>
      {result.empty.length > 0 && <p className="text-caption" role="status">값이 빈 변수: {result.empty.join(", ")}. 조건 패널에서 넣거나 보낼 내용에서 직접 고쳐 주세요.</p>}
      {result.unknown.length > 0 && <p className="text-caption text-danger" role="status">없는 변수: {result.unknown.join(", ")}. 변수 탭에서 추가하거나 본문에서 지워 주세요.</p>}
    </div>
  );
}
