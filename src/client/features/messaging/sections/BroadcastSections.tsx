import { Button, Checkbox, Input, LoadingState, Modal, SectionCard, Stat, StatGrid } from "../../../ui";
import { dateTime } from "../../links/common";
import { CHANNEL_LABELS, DELAY_NOTICE, KIND_LABELS, type Audience, type Check } from "../../../../shared/messaging";
import { reasonText, type Count, type Draft, type Group, type Named } from "../broadcast-model";
import { AlimtalkNotice, channelPatch, ChannelChoice, ChecksList, KindChoice, TemplateEditor } from "../common";

type DraftProps = { d: Draft; set: (patch: Partial<Draft>) => void };

export function ChannelSection({ d, set, connected }: DraftProps & { connected: boolean }) {
  return (
    <SectionCard title="1. 채널">
      <Input label="발송 이름" value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="예: 10월 신제품 출시 안내" />
      <ChannelChoice value={d.channel} connected={connected} requireConnection onChange={(ch) => set(channelPatch(ch, d.kind))} />
      {!connected && <AlimtalkNotice />}
    </SectionCard>
  );
}

function PickList({ title, empty, items, selected, onToggle }: { title: string; empty: string; items: { id: string; label: string }[]; selected: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="stack-tight">
      <b>{title}</b>
      <div className="msg-picks">
        {items.length === 0 && <span className="text-secondary">{empty}</span>}
        {items.map((it) => <Checkbox key={it.id} label={it.label} checked={selected.includes(it.id)} disabled={!selected.includes(it.id) && selected.length >= 50} onChange={() => onToggle(it.id)} />)}
        {selected.filter((id) => !items.some((it) => it.id === id)).map((id, index) => <Checkbox key={id} label={`찾을 수 없는 ${title} ${index + 1} · 선택 해제`} checked onChange={() => onToggle(id)} />)}
      </div>
    </div>
  );
}

type AudienceProps = { audience: Audience; groups: Group[]; tags: Named[]; count: Count | null; onToggle: (key: keyof Audience, id: string) => void; loading?: boolean; unavailable?: boolean };

export function AudienceSection({ audience, groups, tags, count, onToggle, loading, unavailable }: AudienceProps) {
  return (
    <SectionCard title="2. 받는 사람">
      {loading ? <LoadingState lines={2} label="받는 사람 선택값 확인 중" /> : unavailable ? <p className="text-secondary">받는 사람 선택값을 다시 확인해 주세요.</p> : <div className="msg-two">
        <PickList title="그룹" empty="리드 화면에서 그룹을 만들어 주세요." items={groups.map((g) => ({ id: g.id, label: `${g.name} (${g.count}명)` }))} selected={audience.groupIds} onToggle={(id) => onToggle("groupIds", id)} />
        <PickList title="태그" empty="아직 태그가 없어요." items={tags.map((t) => ({ id: t.id, label: t.name }))} selected={audience.tagIds} onToggle={(id) => onToggle("tagIds", id)} />
      </div>}
      {count && (
        <StatGrid>
          <Stat label="발송 가능" value={`${count.eligible}명`} />
          <Stat label="전체" value={`${count.total}명`} />
          <Stat label="발송 불가" value={`${count.total - count.eligible}명`} hint={count.total > count.eligible ? reasonText(count.reasons) : undefined} />
        </StatGrid>
      )}
    </SectionCard>
  );
}

export function KindSection({ d, set }: DraftProps) {
  return (
    <SectionCard title="3. 메시지 성격">
      <KindChoice value={d.kind} channel={d.channel} onChange={(kind) => set({ kind })} />
      {d.kind === "ad" && <Checkbox label="마케팅 수신 동의자만 (광고성은 끌 수 없어요)" checked disabled readOnly />}
      <p className="text-caption">{d.kind === "ad" ? "제목 앞 (광고), 전송자 정보, 수신 거부 링크가 자동으로 들어가요. 오후 9시부터 오전 8시 사이에는 오전 8시로 미뤄 보내요." : "수신 거부·반송한 사람에게는 보내지 않아요."}</p>
    </SectionCard>
  );
}

export function ContentSection({ d, set }: DraftProps) {
  return (
    <SectionCard title="4. 내용">
      <TemplateEditor channel={d.channel} kind={d.kind} template={d.template} onChange={(template) => set({ template })} />
    </SectionCard>
  );
}

type ReviewProps = { checks: Check[]; count: Count | null; hasAudience: boolean; scheduleAt: string; onScheduleAt: (v: string) => void };

export function ReviewSection({ checks, count, hasAudience, scheduleAt, onScheduleAt }: ReviewProps) {
  return (
    <SectionCard title="5. 점검과 보내기">
      <ChecksList checks={checks} failLabel="보낼 수 없음" />
      {count && count.eligible === 0 && <p className="field-error">발송 가능한 받는 사람이 없어요. {hasAudience ? reasonText(count.reasons) : "그룹이나 태그를 골라 주세요."}</p>}
      <Input label="예약 (비우면 지금)" type="datetime-local" value={scheduleAt} onChange={(e) => onScheduleAt(e.target.value)} />
      <p className="text-caption">{DELAY_NOTICE} 예약 발송은 예약 시각에 수신 동의 상태를 다시 확인해요.</p>
    </SectionCard>
  );
}

type ConfirmProps = { open: boolean; d: Draft; count: Count | null; scheduleAt: string; onClose: () => void; onSend: () => void };

export function SendConfirmModal({ open, d, count, scheduleAt, onClose, onSend }: ConfirmProps) {
  return (
    <Modal open={open} title="발송 확인" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>취소</Button><Button onClick={onSend}>{scheduleAt ? "예약하기" : "지금 보내기"}</Button></>}>
      <p>
        <b>{count?.eligible ?? 0}명</b>에게 {CHANNEL_LABELS[d.channel]}({KIND_LABELS[d.kind]})을 {scheduleAt ? `${dateTime(new Date(scheduleAt).getTime())}에` : "지금"} 보내요.
      </p>
      {count && count.total > count.eligible && <p className="text-secondary">제외: {reasonText(count.reasons)}</p>}
      {d.channel === "alimtalk" && <p className="text-secondary">알림톡 예상 차감 크레딧은 채널 연결 후 표시돼요.</p>}
    </Modal>
  );
}
