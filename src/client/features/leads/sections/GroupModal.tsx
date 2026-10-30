import { useEffect, useState } from "react";
import { Button, Input, Modal, Select, TextField, useToast, SelectMenu } from "../../../ui";
import { api, errorMessage } from "../../../lib/api";
import type { GroupCondition, GroupField } from "../../../../shared/leads";
import { FIELD_LABELS, valueOptions } from "../groupRules";
import type { Group } from "../useLeads";
import type { Lookups } from "../types";
import "../../links/lead-tools.css";

type Props = { group: Partial<Group>; lk: Lookups; onClose: () => void; onSaved: () => void };
const NEW_RULE: GroupCondition = { field: "marketing_opt_in", op: "eq", value: "true" };

// 그룹 규칙 편집기. 저장 전에 현재 인원 수를 보여 준다
export function GroupModal({ group, lk, onClose, onSaved }: Props) {
  const toast = useToast();
  const [name, setName] = useState(group.name ?? "");
  const [rules, setRules] = useState<GroupCondition[]>(group.rules?.all ?? []);
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    void api.post<{ count: number }>("/leads/groups/preview", { rules: { all: rules } }).then((r) => setCount(r.count), () => setCount(null));
  }, [rules]);
  const update = (i: number, patch: Partial<GroupCondition>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = async () => {
    try {
      const body = { name, rules: { all: rules } };
      if (group.id) await api.patch(`/leads/groups/${group.id}`, body);
      else await api.post("/leads/groups", body);
      onSaved();
      onClose();
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };
  const footer = <><span className="text-secondary">지금 {count ?? "?"}명</span><Button onClick={() => void save()}>저장</Button></>;
  return (
    <Modal open title={group.id ? "그룹 수정" : "그룹 만들기"} onClose={onClose} footer={footer}>
      <div className="stack">
        <Input label="그룹 이름" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 인플루언서 A 유입 + 마케팅 동의" />
        <span className="field-label">모든 조건을 만족하는 사람</span>
        {rules.map((r, i) => <RuleRow key={i} rule={r} lk={lk} onChange={(patch) => update(i, patch)} onRemove={() => setRules(rules.filter((_, j) => j !== i))} />)}
        <div><Button size="sm" variant="secondary" onClick={() => setRules([...rules, NEW_RULE])}>조건 추가</Button></div>
      </div>
    </Modal>
  );
}

type RuleRowProps = { rule: GroupCondition; lk: Lookups; onChange: (patch: Partial<GroupCondition>) => void; onRemove: () => void };

function RuleRow({ rule, lk, onChange, onRemove }: RuleRowProps) {
  const opts = valueOptions(rule.field, lk);
  return (
    <div className="lt-rule">
      <Select aria-label="항목" value={rule.field} onChange={(e) => onChange({ field: e.target.value as GroupField, value: e.target.value === "created_after" ? Date.now() : "" })}>
        {Object.entries(FIELD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </Select>
      <Select aria-label="조건" value={rule.op} onChange={(e) => onChange({ op: e.target.value as GroupCondition["op"] })}>
        <option value="eq">이다</option>
        <option value="neq">아니다</option>
      </Select>
      {opts ? (
        <SelectMenu aria-label="값" placeholder="고르기" options={opts} value={String(rule.value) || null} onChange={(v) => onChange({ value: v ?? "" })} />
      ) : (
        <TextField aria-label="날짜" type="date" value={new Date(Number(rule.value)).toISOString().slice(0, 10)} onChange={(e) => onChange({ value: new Date(`${e.target.value}T00:00:00+09:00`).getTime() })} />
      )}
      <Button size="sm" variant="ghost" onClick={onRemove}>조건 빼기</Button>
    </div>
  );
}
