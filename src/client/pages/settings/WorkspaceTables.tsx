import { Avatar, Badge, Button, CopyButton, EmptyState, Table, SelectMenu } from "../../ui";
import { api } from "../../lib/api";
import { ROLE_LABELS } from "../../../shared/roles";
import { INVITE_COPIED, ROLE_OPTIONS, type Act, type Invite, type Member } from "./workspaceTypes";

function MemberRow({ m, isOwner, workspaceId, act }: { m: Member; isOwner: boolean; workspaceId: string; act: Act }) {
  const editable = isOwner && m.role !== "owner";
  const remove = () => confirm(`${m.name}님을 팀에서 제거할까요?`) && void act(() => api.del(`/workspace/members/${m.userId}?expectedWorkspaceId=${encodeURIComponent(workspaceId)}`), "팀에서 제거했어요.");
  return (
    <tr>
      <td><span className="row"><Avatar name={m.name || m.email} size="sm" />{m.name}</span></td>
      <td>{m.email}</td>
      <td>
        {editable ? (
          <SelectMenu
            size="sm"
            aria-label={`${m.name} 역할`}
            options={ROLE_OPTIONS}
            value={m.role}
            onChange={(v) => v && v !== m.role && void act(() => api.patch(`/workspace/members/${m.userId}`, { role: v, expectedWorkspaceId: workspaceId }), "역할을 바꿨어요.")}
          />
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

export function MembersTable({ members, isOwner, workspaceId, act }: { members: Member[]; isOwner: boolean; workspaceId: string; act: Act }) {
  return (
    <section className="stack">
      <h4>팀원</h4>
      <Table>
        <thead>
          <tr><th>이름</th><th>이메일</th><th>역할</th>{isOwner && <th><span className="sr-only">관리</span></th>}</tr>
        </thead>
        <tbody>
          {members.map((m) => <MemberRow key={m.userId} m={m} isOwner={isOwner} workspaceId={workspaceId} act={act} />)}
        </tbody>
      </Table>
    </section>
  );
}

function InviteRow({ i, workspaceId, act }: { i: Invite; workspaceId: string; act: Act }) {
  return (
    <tr>
      <td>{i.email}</td>
      <td>{ROLE_LABELS[i.role]}</td>
      <td className="nowrap">{new Date(i.expiresAt).toLocaleDateString("ko-KR")}</td>
      <td className="text-right">
        <div className="row row-end">
          <CopyButton text={i.url} label="링크 복사" doneMessage={INVITE_COPIED} />
          <Button size="sm" variant="ghost" onClick={() => void act(() => api.del(`/workspace/invites/${i.id}?expectedWorkspaceId=${encodeURIComponent(workspaceId)}`), "초대를 취소했어요.")} aria-label={`${i.email} 초대 취소`}>
            취소
          </Button>
        </div>
      </td>
    </tr>
  );
}

export function InvitesTable({ invites, workspaceId, act }: { invites: Invite[]; workspaceId: string; act: Act }) {
  return (
    <section className="stack">
      <h4>대기 중인 초대</h4>
      {invites.length === 0 ? (
        <EmptyState title="대기 중인 초대가 없어요" description="팀원 초대를 누르면 초대 링크가 만들어지고 이메일로도 보내 드려요." />
      ) : (
        <Table>
          <thead>
            <tr><th>이메일</th><th>역할</th><th>만료</th><th><span className="sr-only">관리</span></th></tr>
          </thead>
          <tbody>
            {invites.map((i) => <InviteRow key={i.id} i={i} workspaceId={workspaceId} act={act} />)}
          </tbody>
        </Table>
      )}
    </section>
  );
}
