import { Button } from "../../ui";
import type { GateQuestion } from "../../../shared/leads";
import { VisitorForm, type VisitorValues } from "../forms/VisitorForm";

type Gate = { scrollPct: number; fields: { name: boolean; company: boolean; phone: boolean }; questions: GateQuestion[]; companyEmailOnly: boolean };

type Props = {
  brandName: string;
  title: string;
  gate: Gate;
  preview: boolean;
  onSubmit?: (v: VisitorValues) => Promise<void>;
  onPreviewPass: () => void;
  onClose: () => void;
};

const BASE_KEYS = ["name", "company", "phone"] as const;

// 본문 위에 뜨는 정보 입력 다이얼로그. 0% 게이트는 닫을 수 없다(미리보기 제외)
export function GateDialog({ brandName, title, gate, preview, onSubmit, onPreviewPass, onClose }: Props) {
  const unlockable = preview || gate.scrollPct > 0;
  return (
    <div className="dv-overlay" role="dialog" aria-modal="true" aria-label="정보 입력">
      <div className="dv-dialog">
        <VisitorForm
          brandName={brandName}
          title={title}
          description={gate.scrollPct === 0 ? "이메일을 남기면 바로 볼 수 있어요." : "이어서 읽으려면 이메일을 남겨 주세요."}
          base={BASE_KEYS.filter((k) => gate.fields[k]).map((key) => ({ key, required: true }))}
          questions={gate.questions.map((q) => ({ id: q.id, type: "short", label: q.label, required: q.required, options: [] }))}
          companyEmailOnly={gate.companyEmailOnly}
          submitLabel="이어서 읽기"
          preview={preview}
          onSubmit={onSubmit}
        />
        {unlockable && (
          <div className="dv-dialog-foot">
            {preview ? (
              <Button variant="secondary" onClick={onPreviewPass}>미리보기라 제출 없이 닫기</Button>
            ) : (
              <Button variant="secondary" onClick={onClose}>앞부분 다시 보기</Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
