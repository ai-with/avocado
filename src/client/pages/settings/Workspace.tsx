import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Card, Input, LoadingState, PageHeader, useToast } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import { useMe } from "../../lib/me";
import { MyAccountSection } from "./MyAccount";
import { InviteModal } from "./InviteModal";
import { InvitesTable, MembersTable } from "./WorkspaceTables";
import { canInviteMembers, workspaceAllowed } from "../../../shared/roles";
import type { Invite, Member } from "./workspaceTypes";
import "./settings.css";

function useWorkspaceMembers(workspaceId: string, contextKey: string) {
  const { refresh } = useMe();
  const generation = useRef(0);
  const toast = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loadedKey, setLoadedKey] = useState("");
  const load = useCallback(async () => {
    const request = ++generation.current;
    const data = await api.get<{ workspaceId: string; members: Member[]; invites: Invite[] }>("/workspace/members");
    if (request !== generation.current) return;
    if (data.workspaceId !== workspaceId) {
      setMembers([]); setInvites([]); await refresh(); return;
    }
    setMembers(data.members);
    setInvites(data.invites);
    setLoadedKey(contextKey);
  }, [workspaceId, contextKey, refresh]);
  useEffect(() => {
    setMembers([]); setInvites([]);
    void load().catch((error) => toast(errorMessage(error), "danger"));
    return () => { generation.current++; };
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
  return { members: loadedKey === contextKey ? members : [], invites: loadedKey === contextKey ? invites : [], load, act, loading: loadedKey !== contextKey };
}

export function WorkspaceSettingsPage() {
  const { me, refresh } = useMe();
  const isOwner = workspaceAllowed(me?.role, "manage");
  const canInvite = canInviteMembers(me?.role);
  const { members, invites, load, act, loading } = useWorkspaceMembers(me?.workspace?.id ?? "", `${me?.user.id}:${me?.workspace?.id}:${me?.role}`);
  const [name, setName] = useState(me?.workspace?.name ?? "");
  const [inviteOpen, setInviteOpen] = useState(false);
  useEffect(() => { setName(me?.workspace?.name ?? ""); setInviteOpen(false); }, [me?.workspace?.id, me?.user.id]);
  const rename = async (e: FormEvent) => {
    e.preventDefault();
    await act(() => api.patch("/workspace", { name, expectedWorkspaceId: me?.workspace?.id }), "이름을 바꿨어요.");
    await refresh();
  };

  return (
    <>
      <PageHeader title="워크스페이스 · 팀" actions={canInvite && <Button onClick={() => setInviteOpen(true)}>팀원 초대</Button>} />
      <div className="stack-section">
        <MyAccountSection />
        {isOwner && (
          <Card>
            <form className="row row-bottom row-wrap" onSubmit={rename}>
              <div className="grow settings-name-field">
                <Input label="워크스페이스 이름" autoComplete="organization" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <Button type="submit" size="xl" variant="secondary">이름 저장</Button>
            </form>
          </Card>
        )}
        {loading ? <LoadingState label="팀 정보를 불러오는 중이에요" /> : <>
          <MembersTable members={members} isOwner={isOwner} workspaceId={me?.workspace?.id ?? ""} act={act} />
          {canInvite && <InvitesTable invites={invites} workspaceId={me?.workspace?.id ?? ""} act={act} />}
        </>}
      </div>
      {canInvite && <InviteModal key={`${me?.user.id}:${me?.workspace?.id}`} expectedWorkspaceId={me?.workspace?.id ?? ""} open={inviteOpen} onClose={() => setInviteOpen(false)} onCreated={load} />}
    </>
  );
}
