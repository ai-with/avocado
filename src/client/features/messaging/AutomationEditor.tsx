import { ActionBar, Button, PageHeader, SectionCard } from "../../ui";
import { DELAY_NOTICE } from "../../../shared/messaging";
import { sentence, targetOptions, type Automation, type Lookups } from "./automation-model";
import { ChecksList } from "./common";
import { ChannelStep, ContentStep, StepTabs, WhenStep } from "./sections/AutomationSteps";
import { useAutomationEditor } from "./useAutomationEditor";

type Props = { initial: Automation | null; lk: Lookups; connected: boolean; onDone: () => void };

export function AutomationEditor({ initial, lk, connected, onDone }: Props) {
  const { d, set, step, setStep, checks, availability, blockedAlimtalk, save, test, remove } = useAutomationEditor(initial, lk, connected, onDone);
  return (
    <>
      <PageHeader title={initial ? "자동 발송 규칙" : "자동 발송 규칙 만들기"} actions={<Button variant="ghost" onClick={onDone}>목록으로</Button>} />
      {!availability.available && <p role="status" className="msg-notice">{availability.message}</p>}
      <div className="stack-loose content-narrow">
        <div className="msg-sentence">{sentence(d, lk)}</div>
        <StepTabs step={step} onChange={setStep} />
        {step === 1 && <WhenStep d={d} set={set} targets={targetOptions(d.trigger, lk)} onNext={() => setStep(2)} />}
        {step === 2 && <ChannelStep d={d} set={set} connected={connected} blocked={blockedAlimtalk} onNext={() => setStep(3)} />}
        {step === 3 && <ContentStep d={d} set={set} />}
        <SectionCard title="발송 전 점검">
          <ChecksList checks={checks} />
          <p className="text-caption">{DELAY_NOTICE}</p>
        </SectionCard>
      </div>
      <ActionBar>
        {initial && <Button variant="danger" onClick={() => void remove()}>규칙 삭제</Button>}
        {initial && d.channel === "email" && <Button variant="secondary" disabled={!availability.available} onClick={() => void test()}>나에게 테스트 보내기</Button>}
        <Button disabled={blockedAlimtalk} title={blockedAlimtalk ? "카카오톡 채널 연결이 필요해요" : undefined} onClick={() => void save()}>저장</Button>
      </ActionBar>
    </>
  );
}
