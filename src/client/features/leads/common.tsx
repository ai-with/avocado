import { useEffect, useState } from "react";
import { Badge, Button, Drawer, LoadingState, Stat, StatGrid, Table, useToast } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import { channelLabel, SOURCE_TYPE_LABELS } from "../../../shared/leads";
import { dateTime } from "../links/common";
import "../links/lead-tools.css";
import "./leads.css";
import { LeadMessageLog } from "../messaging/LeadMessageLog";
import { AnswerList, LeadTags, SourceList, ViewList } from "./sections/LeadDrawerParts";
import { nameOf, type LeadDetail, type LeadRow, type Lookups } from "./types";

export { nameOf, type LeadRow, type Lookups } from "./types";

type TableProps = { leads: LeadRow[]; lk: Lookups; selected?: Set<string>; onSelect?: (ids: Set<string>) => void; onOpen: (id: string) => void };

// 리드 표. 리드 화면과 가이드 상세 '리드' 탭이 같이 쓴다
export function LeadsTable({ leads, lk, selected, onSelect, onOpen }: TableProps) {
  const selectable = !!(onSelect && selected);
  const toggle = (id: string) => {
    if (!selected || !onSelect) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelect(next);
  };
  return (
    <Table className="lt-nowrap">
      <thead>
        <tr>
          {selectable && (
            <th><input type="checkbox" aria-label="모두 선택" checked={leads.length > 0 && selected?.size === leads.length} onChange={(e) => onSelect?.(new Set(e.target.checked ? leads.map((l) => l.id) : []))} /></th>
          )}
          <th>이메일</th><th>이름</th><th>출처</th><th>가이드</th><th>인플루언서</th><th>채널</th><th>마케팅 동의</th><th>알림톡 동의</th><th>첫 방문</th><th>마지막 방문</th><th>태그</th>
        </tr>
      </thead>
      <tbody>
        {leads.map((l) => <LeadTableRow key={l.id} lead={l} lk={lk} checked={selectable ? !!selected?.has(l.id) : null} onToggle={() => toggle(l.id)} onOpen={() => onOpen(l.id)} />)}
      </tbody>
    </Table>
  );
}

type RowProps = { lead: LeadRow; lk: Lookups; checked: boolean | null; onToggle: () => void; onOpen: () => void };

// checked 가 null 이면 고르기 칸이 없는 표다
function LeadTableRow({ lead: l, lk, checked, onToggle, onOpen }: RowProps) {
  return (
    <tr>
      {checked !== null && <td><input type="checkbox" aria-label={`${l.email} 선택`} checked={checked} onChange={onToggle} /></td>}
      <td><button type="button" className="link-button" onClick={onOpen}>{l.email}</button></td>
      <td>{l.name}</td>
      <td>{l.sourceTypes.map((t) => SOURCE_TYPE_LABELS[t]).join(", ")}</td>
      <td>{nameOf(lk.guides, l.lastSource.guideId)}</td>
      <td>{nameOf(lk.influencers, l.lastSource.influencerId) || (l.lastSource.linkId ? "가이드 공용" : "")}</td>
      <td>{l.lastSource.channelKey ? channelLabel(l.lastSource.channelKey, lk.channels) : ""}</td>
      <td><ConsentBadge on={l.marketingOptIn} off={!!l.unsubscribedAt} /></td>
      <td><ConsentBadge on={l.alimtalkOptIn} off={!!l.unsubscribedAt} /></td>
      <td>{dateTime(l.firstSource.at)}</td>
      <td>{dateTime(l.lastSource.at)}</td>
      <td><div className="lt-chips">{l.tagIds.map((t) => <Badge key={t}>{nameOf(lk.tags, t)}</Badge>)}</div></td>
    </tr>
  );
}

const ConsentBadge = ({ on, off }: { on: boolean; off: boolean }) =>
  off ? <Badge tone="danger">수신 거부</Badge> : on ? <Badge tone="success">동의</Badge> : <Badge>없음</Badge>;

type DrawerProps = { id: string; lk: Lookups; onClose: () => void; onChanged: () => void };

// 리드 상세 드로어: 동의 상태, 태그, 출처 누적, 열람 기록, 제출 답변, 발송 기록 자리
export function LeadDrawer({ id, lk, onClose, onChanged }: DrawerProps) {
  const toast = useToast();
  const [d, setD] = useState<LeadDetail | null>(null);
  const load = () => void api.get<LeadDetail>(`/leads/${id}`).then(setD);
  useEffect(load, [id]);
  if (!d) return <Drawer title="리드 상세" onClose={onClose}><LoadingState /></Drawer>;
  const l = d.lead;
  const status = (on: boolean) => (l.unsubscribedAt ? "수신 거부" : l.bouncedAt ? "반송" : on ? "동의" : "동의 없음");
  const remove = async () => {
    if (!confirm(`${l.email} 리드를 삭제할까요? 개인정보는 7일 안에 지워져요.`)) return;
    try {
      await api.del(`/leads/${id}`);
      onChanged();
      onClose();
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };
  const removeTag = (tagId: string) => void api.del(`/leads/${id}/tags/${tagId}`).then(() => (load(), onChanged()));
  return (
    <Drawer title={l.name || l.email} description={[l.email, l.company, l.phone].filter(Boolean).join(" · ")} onClose={onClose}>
      <StatGrid>
        <Stat label="이메일 수신" value={status(l.marketingOptIn)} />
        <Stat label="알림톡 수신" value={status(l.alimtalkOptIn)} />
      </StatGrid>
      <LeadTags tagIds={d.tagIds} lk={lk} onRemove={removeTag} />
      <SourceList sources={d.sources} lk={lk} />
      <ViewList views={d.views} />
      <AnswerList submissions={d.submissions} answers={l.answers} />
      <LeadMessageLog leadId={id} />
      <div><Button size="sm" variant="danger" onClick={() => void remove()}>리드 삭제</Button></div>
    </Drawer>
  );
}
