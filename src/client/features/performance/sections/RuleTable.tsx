import { Badge, Button, Table } from "../../../ui";
import { api } from "../../../lib/api";
import { STATUS, type Act, type Rule } from "../kdmTypes";

type RowProps = { r: Rule; canEdit: boolean; canSend: boolean; act: Act; onEdit: (r: Rule) => void; onLog: (r: Rule) => void };

function RuleActions({ r, canEdit, canSend, act, onEdit, onLog }: RowProps) {
  const remove = () => confirm("규칙을 지울까요? 발송 기록도 함께 지워져요.") && void act(() => api.del(`/keyword-dm/${r.id}`), "규칙을 지웠어요.");
  return (
    <td className="text-right nowrap">
      <Button size="sm" variant="ghost" onClick={() => onLog(r)}>발송 기록</Button>
      {canEdit && (
        <>
          <Button size="sm" variant="ghost" onClick={() => onEdit(r)}>편집</Button>
          {r.status === "on" ? (
            <Button size="sm" variant="secondary" onClick={() => void act(() => api.post(`/keyword-dm/${r.id}/toggle`, { on: false }), "규칙을 껐어요.")}>끄기</Button>
          ) : (
            <Button size="sm" disabled={!canSend} onClick={() => void act(() => api.post(`/keyword-dm/${r.id}/toggle`, { on: true }), "규칙을 켰어요. 이제 키워드 댓글에 DM이 나가요.")}>켜기</Button>
          )}
          <Button size="sm" variant="ghost" onClick={remove}>삭제</Button>
        </>
      )}
    </td>
  );
}

function RuleRow(props: RowProps) {
  const { r, canSend } = props;
  return (
    <tr>
      <td>
        {r.mediaThumbUrl ? <img className="kdm-thumb" src={r.mediaThumbUrl} alt="게시물 미리보기" /> : <span className="kdm-thumb" aria-hidden="true" />}
        {r.mediaPermalink && <div><a className="text-caption" href={r.mediaPermalink} target="_blank" rel="noreferrer">게시물 보기</a></div>}
      </td>
      <td>{r.guideName}<div className="text-caption">{r.influencerName}</div></td>
      <td className="wrap">{r.keywords.join(", ")}</td>
      <td><Badge tone={!canSend && r.status === "on" ? "warn" : STATUS[r.status][1]}>{!canSend && r.status === "on" ? "발송 기준 준비 중" : STATUS[r.status][0]}</Badge>{r.pausedReason && <div className="text-caption">연결 끊김</div>}</td>
      <td className="num">{r.todaySent}</td>
      <td className="num">{r.clicks}</td>
      <td className="num">{r.leads}</td>
      <RuleActions {...props} />
    </tr>
  );
}

export function RuleTable({ rules, ...rest }: Omit<RowProps, "r"> & { rules: Rule[] }) {
  return (
    <Table>
      <thead><tr><th>게시물</th><th>가이드 · 인플루언서</th><th>키워드</th><th>상태</th><th className="num">오늘 발송</th><th className="num">클릭</th><th className="num">리드</th><th><span className="sr-only">동작</span></th></tr></thead>
      <tbody>{rules.map((r) => <RuleRow key={r.id} r={r} {...rest} />)}</tbody>
    </Table>
  );
}
