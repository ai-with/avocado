import { ActionBar, Button, Card, PageHeader } from "../../ui";
import { dateTime } from "../links/common";
import { resultText, type Broadcast } from "./broadcast-model";
import { AudienceSection, ChannelSection, ContentSection, KindSection, ReviewSection, SendConfirmModal } from "./sections/BroadcastSections";
import { useBroadcastEditor } from "./useBroadcastEditor";

type Props = { initial: Broadcast | null; connected: boolean; onDone: () => void };

export function BroadcastEditor({ initial, connected, onDone }: Props) {
  const e = useBroadcastEditor(initial, connected, onDone);
  const { d, set, count, locked } = e;
  return (
    <>
      <PageHeader title={initial ? d.name || "1회성 발송" : "새 1회성 발송"} actions={<Button variant="ghost" onClick={e.leave}>목록으로</Button>} />
      <fieldset disabled={locked} className="stack-loose content-narrow fieldset-plain">
        {locked && initial?.stats && <Card>결과: {resultText(initial.stats)}</Card>}
        <ChannelSection d={d} set={set} connected={connected} />
        <AudienceSection audience={d.audience} groups={e.groups} tags={e.tags} count={count} onToggle={e.toggleAudience} />
        <KindSection d={d} set={set} />
        <ContentSection d={d} set={set} />
        <ReviewSection checks={e.checks} count={count} hasAudience={e.hasAudience} scheduleAt={e.scheduleAt} onScheduleAt={e.setScheduleAt} />
      </fieldset>
      <ActionBar status={e.savedAt && !locked ? `${dateTime(e.savedAt)} 자동 임시저장` : undefined}>
        {initial?.status === "scheduled" && <Button variant="secondary" onClick={() => void e.cancel()}>예약 취소</Button>}
        <Button variant="secondary" disabled={locked || d.channel !== "email" || e.blockedAlimtalk} onClick={() => void e.test()}>나에게 테스트 보내기</Button>
        <Button disabled={!e.canSend} onClick={() => e.setConfirmOpen(true)}>{count?.eligible ?? 0}명에게 발송</Button>
      </ActionBar>
      <SendConfirmModal open={e.confirmOpen} d={d} count={count} scheduleAt={e.scheduleAt} onClose={() => e.setConfirmOpen(false)} onSend={() => void e.send()} />
    </>
  );
}
