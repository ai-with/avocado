import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Card, Input, PageHeader, useToast } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import { useMe } from "../../lib/me";
import { MyAccountSection } from "./MyAccount";
import { InviteModal } from "./InviteModal";
import { InvitesTable, MembersTable } from "./WorkspaceTables";
import type { Invite, Member } from "./workspaceTypes";
import "./settings.css";

function useWorkspaceMembers() {
  const toast = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const load = useCallback(async () => {
    const data = await api.get<{ members: Member[]; invites: Invite[] }>("/workspace/members");
    setMembers(data.members);
    setInvites(data.invites);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast(done, "success");
      await load();
    } catch (e) {
      toast(errorMessage(e), "danger");
    }
  };
  return { members, invites, load, act };
}

export function WorkspaceSettingsPage() {
  const { me, refresh } = useMe();
  const isOwner = me?.role === "owner";
  const { members, invites, load, act } = useWorkspaceMembers();
  const [name, setName] = useState(me?.workspace?.name ?? "");
  const [inviteOpen, setInviteOpen] = useState(false);
  const rename = async (e: FormEvent) => {
    e.preventDefault();
    await act(() => api.patch("/workspace", { name }), "이름을 바꿨어요.");
    await refresh();
  };

  return (
    <>
      <PageHeader title="워크스페이스 · 팀" actions={isOwner && <Button onClick={() => setInviteOpen(true)}>팀원 초대</Button>} />
      <div className="stack-section">
        <MyAccountSection />
        {isOwner && (
          <Card>
            <form className="row row-bottom row-wrap" onSubmit={rename}>
              <div className="grow settings-name-field">
                <Input label="워크스페이스 이름" autoComplete="organization" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <Button type="submit" variant="secondary">이름 저장</Button>
            </form>
          </Card>
        )}
        <MembersTable members={members} isOwner={isOwner} act={act} />
        {isOwner && <InvitesTable invites={invites} act={act} />}
      </div>
      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} onCreated={load} />
    </>
  );
}
