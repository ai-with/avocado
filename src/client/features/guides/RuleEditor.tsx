import { useState } from "react";
import { Badge, Button, Checkbox, Input, Modal, Select } from "../../ui";
import { RULE_TARGETS, RULE_TARGET_LABELS, RULE_TYPES, RULE_TYPE_LABELS, SEVERITY_LABELS, type GuideRule, type RuleSeverity, type RuleTarget, type RuleType } from "../../../shared/guides";

export type RuleInput = Omit<GuideRule, "id" | "version">;

const PLACEHOLDER: Record<RuleType, string> = {
  required_phrase: "예: 제품명 '글로우 세럼' 1회 이상 말하기",
  forbidden_phrase: "예: 치료, 완치 (쉼표로 여러 개)",
  required_scene: "예: 제품 패키지가 화면에 보이기",
  forbidden_scene: "예: 다른 브랜드 로고",
  ad_disclosure: "예: 영상 시작에 '광고' 표기와 음성 고지",
  format: "예: 세로 9:16, 15~30초, 첫 3초 안에 제품 노출",
  language: "예: 영어로 말하기",
};
const DEFAULT_TARGETS: Record<RuleType, RuleTarget[]> = {
  required_phrase: ["speech", "caption"],
  forbidden_phrase: ["speech", "screen_text", "caption"],
  required_scene: ["scene"],
  forbidden_scene: ["scene"],
  ad_disclosure: ["speech", "screen_text"],
  format: ["scene"],
  language: ["speech"],
};

type Props = {
  rules: GuideRule[];
  onAdd: (r: RuleInput) => Promise<void> | void;
  onUpdate: (id: string, patch: Partial<RuleInput>) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
  readOnly?: boolean;
};

const typeTone = (t: RuleType) => (t === "forbidden_phrase" || t === "forbidden_scene" ? "danger" : t === "ad_disclosure" ? "warn" : "accent");

// 규칙 목록 + 추가 폼. 규정 세트 화면과 가이드 전용 규칙에서 같이 쓴다
export function RuleEditor({ rules, onAdd, onUpdate, onDelete, readOnly }: Props) {
  const [confirmOff, setConfirmOff] = useState<string | null>(null);
  const toggle = (r: GuideRule) => {
    // 광고 표기 규칙을 끌 때는 경고를 띄운다 (F-55 정책)
    if (r.enabled && r.type === "ad_disclosure") setConfirmOff(r.id);
    else void onUpdate(r.id, { enabled: !r.enabled });
  };

  return (
    <div className="stack">
      {rules.length === 0 ? (
        <p className="text-secondary">아직 규칙이 없어요. 아래에서 추가해 주세요.</p>
      ) : (
        <ul className="rule-list">
          {rules.map((r) => <RuleItem key={r.id} rule={r} readOnly={readOnly} onToggle={() => toggle(r)} onDelete={() => confirm("이 규칙을 지울까요?") && void onDelete(r.id)} />)}
        </ul>
      )}
      {!readOnly && <RuleAddForm onAdd={onAdd} />}
      <AdOffConfirm open={confirmOff !== null} onClose={() => setConfirmOff(null)} onConfirm={() => { if (confirmOff) void onUpdate(confirmOff, { enabled: false }); setConfirmOff(null); }} />
    </div>
  );
}

function RuleItem({ rule: r, readOnly, onToggle, onDelete }: { rule: GuideRule; readOnly?: boolean; onToggle: () => void; onDelete: () => void }) {
  return (
    <li className={`rule-item ${r.enabled ? "" : "is-off"}`}>
      <div className="row row-wrap">
        <Badge tone={typeTone(r.type)}>{RULE_TYPE_LABELS[r.type]}</Badge>
        <Badge tone={r.severity === "must" ? "neutral" : "info"}>{SEVERITY_LABELS[r.severity]}</Badge>
        <span className="text-caption">{r.targets.map((t) => RULE_TARGET_LABELS[t]).join(", ")}</span>
        {!r.enabled && <Badge>꺼짐</Badge>}
      </div>
      <p>{r.content}</p>
      {!readOnly && (
        <div className="row">
          <Button size="sm" variant="ghost" onClick={onToggle}>{r.enabled ? "끄기" : "켜기"}</Button>
          <Button size="sm" variant="ghost" onClick={onDelete}>삭제</Button>
        </div>
      )}
    </li>
  );
}

function RuleAddForm({ onAdd }: { onAdd: Props["onAdd"] }) {
  const [type, setType] = useState<RuleType>("required_phrase");
  const [content, setContent] = useState("");
  const [severity, setSeverity] = useState<RuleSeverity>("must");
  const [targets, setTargets] = useState<RuleTarget[]>(DEFAULT_TARGETS.required_phrase);
  const invalid = !content.trim() || targets.length === 0;
  // 가이드 편집 화면의 <form> 안에 들어가므로 form 이 아니라 버튼으로 추가한다
  const submit = async () => {
    if (invalid) return;
    await onAdd({ type, content: content.trim(), severity, targets, enabled: true });
    setContent("");
  };
  return (
    <div className="rule-form stack">
      <div className="grid-3">
        <Select label="유형" value={type} onChange={(e) => { const t = e.target.value as RuleType; setType(t); setTargets(DEFAULT_TARGETS[t]); }}>
          {RULE_TYPES.map((t) => <option key={t} value={t}>{RULE_TYPE_LABELS[t]}</option>)}
        </Select>
        <Select label="중요도" value={severity} onChange={(e) => setSeverity(e.target.value as RuleSeverity)}>
          <option value="must">필수</option>
          <option value="should">권장</option>
        </Select>
      </div>
      <Input label="내용" value={content} onChange={(e) => setContent(e.target.value)} placeholder={PLACEHOLDER[type]} maxLength={300} />
      <fieldset className="fieldset-plain row row-wrap">
        <legend className="field-label">검사 대상</legend>
        {RULE_TARGETS.map((t) => (
          <Checkbox key={t} label={RULE_TARGET_LABELS[t]} checked={targets.includes(t)} onChange={(e) => setTargets(e.target.checked ? [...targets, t] : targets.filter((x) => x !== t))} />
        ))}
      </fieldset>
      <div><Button variant="secondary" onClick={() => void submit()} disabled={invalid}>규칙 추가</Button></div>
    </div>
  );
}

function AdOffConfirm({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: () => void }) {
  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>취소</Button>
      <Button variant="danger" onClick={onConfirm}>끄기</Button>
    </>
  );
  return (
    <Modal open={open} title="광고 표기 규칙을 끌까요?" onClose={onClose} footer={footer}>
      <p>광고 표기가 빠지면 인플루언서와 브랜드 모두 표시광고 규정(국내 공정위 지침, 미국 FTC 등)을 어길 수 있어요. 국가별 표기 의무를 확인한 뒤 끄세요.</p>
    </Modal>
  );
}
