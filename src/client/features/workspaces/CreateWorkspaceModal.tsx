import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Button, Input, Modal, useToast } from "../../ui";
import { api, ApiError, errorMessage } from "../../lib/api";
import { useMe } from "../../lib/me";
import { FormError } from "../../pages/AuthCard";

type Intent = { requestId: string; nameHash: string; expectedWorkspaceId: string | null };
type Result = { workspaceId: string; replayed: boolean; selected: boolean };
const keyFor = (userId: string) => `workspace-create:${userId}`;
function readIntent(userId: string): Intent | null {
  try {
    const data = JSON.parse(sessionStorage.getItem(keyFor(userId)) ?? "null") as Partial<Intent> | null;
    return data && typeof data.requestId === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(data.requestId) && typeof data.nameHash === "string" && /^[a-f0-9]{64}$/.test(data.nameHash) && (data.expectedWorkspaceId === null || typeof data.expectedWorkspaceId === "string") ? data as Intent : null;
  } catch { return null; }
}
async function nameHash(name: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(name));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function CreateWorkspaceModal({ onClose }: { onClose: () => void }) {
  const { me, refresh } = useMe(), navigate = useNavigate(), toast = useToast();
  const [context] = useState(() => ({ userId: me!.user.id, workspaceId: me!.workspace?.id ?? null }));
  const [name, setName] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [started, setStarted] = useState(false), [nameError, setNameError] = useState("");
  const pending = useRef(false), live = useRef(true), intent = useRef<Intent | null>(null);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const close = () => { if (!pending.current) onClose(); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNameError("");
    try {
      const workspaceName = name.trim();
      if (!workspaceName || workspaceName.length > 60) { setNameError("워크스페이스 이름을 60자 이내로 입력해 주세요."); return; }
      const hash = await nameHash(workspaceName);
      const previous = intent.current ?? readIntent(context.userId);
      if (previous && previous.nameHash !== hash) throw new Error("이전 생성 요청이 남아 있어요. 같은 이름으로 다시 확인해 주세요.");
      const request = previous ?? { requestId: crypto.randomUUID(), nameHash: hash, expectedWorkspaceId: context.workspaceId };
      intent.current = request;
      // Persist only opaque intent/context and a hash, never the entered name.
      try { sessionStorage.setItem(keyFor(context.userId), JSON.stringify(request)); }
      catch { throw new Error("요청을 보관할 수 없어요. 브라우저 저장소 설정을 확인해 주세요."); }
      setStarted(true);
      const result = await api.post<Result>("/workspaces", { expectedUserId: context.userId, requestId: request.requestId, workspaceName, expectedWorkspaceId: request.expectedWorkspaceId });
      if (!result || typeof result.workspaceId !== "string" || typeof result.selected !== "boolean" || typeof result.replayed !== "boolean") throw new Error("요청 결과를 확인하지 못했어요. 같은 이름으로 다시 시도해 주세요.");
      const current = await refresh();
      if (current?.user.id === context.userId && readIntent(context.userId)?.requestId === request.requestId) sessionStorage.removeItem(keyFor(context.userId));
      if (!live.current) return;
      onClose();
      if (!current || current.user.id !== context.userId) return;
      if (result.selected && current.workspace?.id === result.workspaceId) navigate("/onboarding", { replace: true });
      else toast("워크스페이스를 만들었어요. 메뉴에서 전환할 수 있어요.", "success");
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409 && ["request_cancelled", "workspace_unavailable"].includes(cause.code)) {
        if (readIntent(context.userId)?.requestId === intent.current?.requestId) sessionStorage.removeItem(keyFor(context.userId));
        const current = await refresh();
        if (live.current) { onClose(); if (current?.user.id === context.userId) toast(errorMessage(cause), "neutral"); }
        return;
      }
      if (cause instanceof ApiError && (cause.code === "workspace_changed" || cause.code === "session_changed")) await refresh();
      if (live.current) {
        if (cause instanceof ApiError && cause.fields.workspaceName) setNameError(cause.fields.workspaceName);
        else setError(cause instanceof TypeError ? "요청 결과를 확인하지 못했어요. 같은 이름으로 다시 시도해 주세요." : errorMessage(cause));
      }
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  };
  return createPortal(<Modal open title="새 워크스페이스 만들기" onClose={close}>
    <form className="stack" noValidate onSubmit={(event) => void submit(event)}>
      <Input label="워크스페이스 이름" autoComplete="organization" maxLength={60} value={name} error={nameError} onChange={(event) => setName(event.target.value)} disabled={busy || started} data-autofocus required />
      <FormError message={error} />
      <div className="row row-end"><Button variant="ghost" onClick={close} disabled={busy}>취소</Button><Button type="submit" loading={busy}>만들기</Button></div>
    </form>
  </Modal>, document.body);
}
