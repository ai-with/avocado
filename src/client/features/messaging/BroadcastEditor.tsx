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
      {!e.availability.available && <p role="status" className="msg-notice">{e.availability.message}</p>}
      <fieldset disabled={locked} className="stack-loose content-narrow fieldset-plain">
        {locked && initial?.stats && <Card>결과: {resultText(initial.stats)}</Card>}
        <ChannelSection d={d} set={set} connected={connected} />
        <AudienceSection audience={d.audience} groups={e.groups} tags={e.tags} count={count} onToggle={e.toggleAudience} loading={e.optionsLoading} unavailable={!!e.optionsError} />
        <div className="row row-wrap">{e.groupCursor && <Button variant="secondary" size="sm" onClick={() => void e.more("groups")}>그룹 더 보기</Button>}{e.tagCursor && <Button variant="secondary" size="sm" onClick={() => void e.more("tags")}>태그 더 보기</Button>}</div>
        {e.optionsLoading && <p className="text-secondary">받는 사람 선택값을 불러오고 있어요.</p>}
        {e.optionsIncomplete && !e.optionsLoading && <p className="text-secondary">찾을 수 없는 선택 항목은 해제하거나 다시 확인해 주세요.</p>}
        {e.optionsError && <div className="stack-tight"><p className="field-error" role="alert">{e.optionsError}</p><Button variant="secondary" size="sm" onClick={() => void e.refreshOptions()}>선택값 다시 확인</Button></div>}
        {e.countError && <div className="stack-tight"><p className="field-error" role="alert">{e.countError}</p><Button variant="secondary" size="sm" onClick={e.retryCount}>인원 다시 확인</Button></div>}
        <KindSection d={d} set={set} />
        <ContentSection d={d} set={set} />
        <ReviewSection checks={e.checks} count={count} hasAudience={e.hasAudience} scheduleAt={e.scheduleAt} onScheduleAt={e.setScheduleAt} />
      </fieldset>
      <ActionBar status={e.savedAt && !locked ? `${dateTime(e.savedAt)} 자동 임시저장` : undefined}>
        {initial && ["scheduled", "sending"].includes(initial.status) && <Button variant="secondary" onClick={() => void e.cancel()}>남은 발송 취소</Button>}
        {e.pendingSend && <Button variant="secondary" onClick={() => void e.send()}>같은 발송 요청 다시 확인</Button>}
        <Button variant="secondary" disabled={!e.availability.available || locked || d.channel !== "email" || e.blockedAlimtalk} onClick={() => void e.test()}>나에게 테스트 보내기</Button>
        <Button disabled={!e.canSend} onClick={() => e.setConfirmOpen(true)}>{count ? `${count.eligible}명에게 발송` : "받는 사람 확인 필요"}</Button>
      </ActionBar>
      <SendConfirmModal open={e.confirmOpen} d={d} count={count} scheduleAt={e.scheduleAt} onClose={() => e.setConfirmOpen(false)} onSend={() => void e.send()} />
    </>
  );
}
