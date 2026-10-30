import { Button, Card, Input, Select, SelectMenu } from "../../../ui";
import { DELAY_LABELS, DELAYS, TRIGGER_LABELS, type DelayMinutes, type Trigger } from "../../../../shared/messaging";
import { targetFromKey, targetKey, TRIGGERS, type Draft, type TargetOption } from "../automation-model";
import { channelPatch, ChannelChoice, KindChoice, AlimtalkNotice, TemplateEditor } from "../common";

type StepProps = { d: Draft; set: (patch: Partial<Draft>) => void };
const STEP_LABELS = ["언제", "채널", "내용"];

export function StepTabs({ step, onChange }: { step: number; onChange: (step: number) => void }) {
  return (
    <div className="msg-steps">
      {STEP_LABELS.map((label, i) => (
        <Button key={label} size="sm" variant={step === i + 1 ? "primary" : "secondary"} aria-current={step === i + 1 ? "step" : undefined} onClick={() => onChange(i + 1)}>
          {i + 1}. {label}
        </Button>
      ))}
    </div>
  );
}

export function WhenStep({ d, set, targets, onNext }: StepProps & { targets: TargetOption[]; onNext: () => void }) {
  return (
    <Card className="stack">
      <Select label="트리거" value={d.trigger} onChange={(e) => set({ trigger: e.target.value as Trigger, target: {} })}>
        {TRIGGERS.map((t) => <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>)}
      </Select>
      <SelectMenu
        label="대상"
        placeholder="대상을 고르세요"
        options={targets.map((t) => ({ value: t.key, label: t.label }))}
        value={targetKey(d.target) || null}
        onChange={(v) => set({ target: targetFromKey(v ?? "") })}
        hint={targets.length === 0 ? "먼저 폼이나 자료를 만들어 주세요." : undefined}
      />
      <Select label="시점" value={d.delayMinutes} onChange={(e) => set({ delayMinutes: Number(e.target.value) as DelayMinutes })}>
        {DELAYS.map((m) => <option key={m} value={m}>{DELAY_LABELS[m]}</option>)}
      </Select>
      <div><Button onClick={onNext}>다음</Button></div>
    </Card>
  );
}

export function ChannelStep({ d, set, connected, blocked, onNext }: StepProps & { connected: boolean; blocked: boolean; onNext: () => void }) {
  return (
    <Card className="stack">
      <ChannelChoice value={d.channel} connected={connected} onChange={(ch) => set(channelPatch(ch, d.kind))} />
      {blocked && <AlimtalkNotice />}
      <KindChoice value={d.kind} channel={d.channel} onChange={(kind) => set({ kind })} />
      <p className="text-caption">
        {d.kind === "ad"
          ? "광고성: 해당 채널 수신 동의자에게만 가고, 제목 앞 (광고)와 전송자 정보·수신 거부 링크가 붙어요. 오후 9시부터 오전 8시까지는 보류했다가 오전 8시에 보내요."
          : "정보성: 신청 확인, 요청한 자료 전달처럼 받는 사람이 요청한 내용이에요. 수신 거부한 사람에게는 보내지 않아요."}
      </p>
      <div><Button disabled={blocked} onClick={onNext}>다음</Button></div>
    </Card>
  );
}

export function ContentStep({ d, set }: StepProps) {
  return (
    <Card className="stack">
      <Input label="규칙 이름" value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="비우면 설정 문장으로 저장돼요" />
      <TemplateEditor channel={d.channel} kind={d.kind} template={d.template} onChange={(template) => set({ template })} />
    </Card>
  );
}
