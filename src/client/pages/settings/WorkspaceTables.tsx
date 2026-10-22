import { Badge, Button, CopyButton, EmptyState, Select, Table } from "../../ui";
import { api } from "../../lib/api";
import { ROLE_LABELS } from "../../../shared/roles";
import { ASSIGNABLE, INVITE_COPIED, type Act, type Invite, type Member } from "./workspaceTypes";

function MemberRow({ m, isOwner, act }: { m: Member; isOwner: boolean; act: Act }) {
  const editable = isOwner && m.role !== "owner";
  const remove = () => confirm(`${m.name}님을 팀에서 제거할까요?`) && void act(() => api.del(`/workspace/members/${m.userId}`), "팀에서 제거했습니다.");
  return (
    <tr>
      <td>{m.name}</td>
      <td>{m.email}</td>
      <td>
        {editable ? (
          <Select aria-label={`${m.name} 역할`} value={m.role} onChange={(e) => void act(() => api.patch(`/workspace/members/${m.userId}`, { role: e.target.value }), "역할을 바꿨습니다.")}>
            {ASSIGNABLE.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Select>
        ) : (
          <Badge tone={m.role === "owner" ? "accent" : "neutral"}>{ROLE_LABELS[m.role]}</Badge>
        )}
      </td>
      {isOwner && (
        <td className="text-right">
          {editable && <Button size="sm" variant="ghost" onClick={remove} aria-label={`${m.name} 팀에서 제거`}>제거</Button>}
        </td>
      )}
    </tr>
  );
}

export function MembersTable({ members, isOwner, act }: { members: Member[]; isOwner: boolean; act: Act }) {
  return (
    <section className="stack">
      <h4>팀원</h4>
      <Table>
        <thead>
          <tr><th>이름</th><th>이메일</th><th>역할</th>{isOwner && <th><span className="sr-only">관리</span></th>}</tr>
        </thead>
        <tbody>
          {members.map((m) => <MemberRow key={m.userId} m={m} isOwner={isOwner} act={act} />)}
        </tbody>
      </Table>
    </section>
  );
}

function InviteRow({ i, act }: { i: Invite; act: Act }) {
  return (
    <tr>
      <td>{i.email}</td>
      <td>{ROLE_LABELS[i.role]}</td>
      <td className="nowrap">{new Date(i.expiresAt).toLocaleDateString("ko-KR")}</td>
      <td className="text-right">
        <div className="row row-end">
          <CopyButton text={i.url} label="링크 복사" doneMessage={INVITE_COPIED} />
          <Button size="sm" variant="ghost" onClick={() => void act(() => api.del(`/workspace/invites/${i.id}`), "초대를 취소했습니다.")} aria-label={`${i.email} 초대 취소`}>
            취소
          </Button>
        </div>
      </td>
    </tr>
  );
}

export function InvitesTable({ invites, act }: { invites: Invite[]; act: Act }) {
  return (
    <section className="stack">
      <h4>대기 중인 초대</h4>
      {invites.length === 0 ? (
        <EmptyState title="대기 중인 초대가 없습니다" description="팀원 초대를 누르면 초대 링크가 만들어지고 이메일로도 보내 드립니다." />
      ) : (
        <Table>
          <thead>
            <tr><th>이메일</th><th>역할</th><th>만료</th><th><span className="sr-only">관리</span></th></tr>
          </thead>
          <tbody>
            {invites.map((i) => <InviteRow key={i.id} i={i} act={act} />)}
          </tbody>
        </Table>
      )}
    </section>
  );
}
