import type { ReactNode } from "react";
import { Badge, Button, SelectMenu } from "../../../ui";
import { STATUS_LABEL, type ParticipationStatus } from "../../../../shared/participation";
import { STATUS_OPTIONS, STATUS_TONE, periodText, termsSummary } from "../participation";
import { LangCopyButton } from "./LangCopyButton";
import { fmtDateTime, type GuideInfluencerRow, type StageSummary } from "../types";
import { handlesText, langLabel } from "../InfluencersPage";
import { PostUrlCell } from "../../reviews/PostUrlCell";
import { countryName } from "../../../lib/countries";

export type RowActions = Record<"email" | "reissue" | "remove", (r: GuideInfluencerRow) => Promise<void>> & { setStatus: (r: GuideInfluencerRow, s: ParticipationStatus) => Promise<void> };
type Props = { row: GuideInfluencerRow; base: string; canEdit: boolean; published: boolean; actions: RowActions; onConsent: (r: GuideInfluencerRow) => void; onOpen: (r: GuideInfluencerRow) => void; onMessage: (r: GuideInfluencerRow) => void; onSaved: () => Promise<void> };

function stageItems(s: StageSummary): [string, ReactNode][] {
  const pending = <span className="text-caption">준비 중</span>;
  return [
    ["열람", s.viewedAt ? <Badge tone="success">열람함</Badge> : <Badge>미열람</Badge>],
    ["동의", s.consentWithdrawnAt ? <Badge tone="danger">철회</Badge> : s.consentedAt ? <Badge tone="success">동의</Badge> : <Badge>대기</Badge>],
    ["업로드", s.uploadVersion ? <Badge tone="info">v{s.uploadVersion}</Badge> : <Badge>없음</Badge>],
    ["검수 라운드", s.reviewRounds ?? pending],
    ["승인", s.approved === null ? pending : s.approved ? <Badge tone="success">승인</Badge> : <Badge>대기</Badge>],
    ["게시물", s.postUrl ? <a href={s.postUrl} target="_blank" rel="noreferrer">보기</a> : pending],
    ["연결", s.connected === null ? pending : s.connected ? "연결" : "미연결"],
    ["스냅샷", s.snapshots ?? pending],
    ["리드", s.leads ?? pending],
  ];
}

// 9개 단계를 5칸씩 두 줄로, 칸마다 이름 아래 값을 놓아 한눈에 읽히게 한다
function StageStatus({ status }: { status: StageSummary }) {
  return (
    <dl className="stage-grid">
      {stageItems(status).map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  );
}

function LinkCell({ row, canEdit, published, actions, onMessage }: Pick<Props, "row" | "canEdit" | "published" | "actions" | "onMessage">) {
  return (
    <td>
      <div className="row row-tight nowrap">
        <LangCopyButton url={row.links.guide} defaultLang={row.influencer.lang} disabled={!published} />
        {canEdit && row.influencer.email && <Button size="sm" variant="ghost" onClick={() => void actions.email(row)} disabled={!published}>이메일</Button>}
        {canEdit && <Button size="sm" variant="ghost" onClick={() => onMessage(row)}>메시지</Button>}
      </div>
      {row.tokenExpiresAt < Date.now() && <span className="text-caption">만료됨</span>}
    </td>
  );
}

function ManageCell({ row, actions, onConsent }: Pick<Props, "row" | "actions" | "onConsent">) {
  const reissue = () => confirm("링크를 다시 만들까요? 이전 링크는 더 이상 열리지 않아요.") && void actions.reissue(row);
  const remove = () => confirm(`${row.influencer.displayName}님을 이 캠페인에서 뺄까요?`) && void actions.remove(row);
  return (
    <td className="text-right">
      <div className="row row-end row-tight">
        {row.status.consentedAt && <Button size="sm" variant="ghost" onClick={() => onConsent(row)}>동의 보기</Button>}
        <Button size="sm" variant="ghost" onClick={reissue}>재발급</Button>
        <Button size="sm" variant="ghost" onClick={remove}>빼기</Button>
      </div>
    </td>
  );
}

// 이름을 누르면 조건·이력 패널. 회차는 같은 브랜드 안 참여 순서 (TASK-072)
function NameCell({ row, onOpen }: Pick<Props, "row" | "onOpen">) {
  return (
    <td className="nowrap">
      <div className="row row-tight">
        <button type="button" className="link-button" onClick={() => onOpen(row)}>{row.influencer.displayName}</button>
        <Badge tone={row.round > 1 ? "accent" : "neutral"}>{row.round}회차</Badge>
      </div>
    </td>
  );
}

function StatusCell({ row, canEdit, actions }: Pick<Props, "row" | "canEdit" | "actions">) {
  if (!canEdit) return <td className="nowrap"><Badge tone={STATUS_TONE[row.participationStatus]}>{STATUS_LABEL[row.participationStatus]}</Badge></td>;
  return (
    <td className="nowrap">
      <SelectMenu size="sm" aria-label={`${row.influencer.displayName} 진행 상태`} options={STATUS_OPTIONS} value={row.participationStatus} onChange={(v) => v && void actions.setStatus(row, v as ParticipationStatus)} />
    </td>
  );
}

function TermsCell({ row, onOpen }: Pick<Props, "row" | "onOpen">) {
  const summary = termsSummary(row.terms);
  const period = periodText(row.contractStartAt, row.contractEndAt);
  return (
    <td>
      <div className="stack-tight">
        {summary || period ? <span>{summary}</span> : <button type="button" className="link-button text-caption" onClick={() => onOpen(row)}>조건 넣기</button>}
        {period && <span className="text-caption nowrap">{period}</span>}
      </div>
    </td>
  );
}

export function InfluencerTableRow({ row: r, base, canEdit, published, actions, onConsent, onOpen, onMessage, onSaved }: Props) {
  return (
    <tr>
      <NameCell row={r} onOpen={onOpen} />
      <StatusCell row={r} canEdit={canEdit} actions={actions} />
      <TermsCell row={r} onOpen={onOpen} />
      <td>{handlesText(r.influencer)}</td>
      <td>{r.influencer.email}</td>
      <td className="nowrap">{langLabel(r.influencer.lang)}</td>
      <td className="nowrap">{countryName(r.influencer.country)}</td>
      <LinkCell row={r} canEdit={canEdit} published={published} actions={actions} onMessage={onMessage} />
      <td className="nowrap">{r.status.viewedAt ? fmtDateTime(r.status.viewedAt) : <span className="text-caption">미열람</span>}</td>
      <td><StageStatus status={r.status} /></td>
      <td><PostUrlCell base={base} row={r} canEdit={canEdit} onSaved={onSaved} /></td>
      {canEdit && <ManageCell row={r} actions={actions} onConsent={onConsent} />}
    </tr>
  );
}
