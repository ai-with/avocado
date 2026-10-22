import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "../ui";
import { api } from "../lib/api";
import { useMe, type Me } from "../lib/me";
import { ACCOUNT_LINKS } from "./nav";

const PLAN_LABELS: Record<string, string> = { starter: "Starter" };

type Props = { me: Me; collapsed: boolean; workspaceName: string; onNavigate: () => void };

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

export function AccountMenu({ me, collapsed, workspaceName, onNavigate }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const plan = PLAN_LABELS[me.workspace?.plan ?? "starter"] ?? me.workspace?.plan;
  const close = () => {
    setOpen(false);
    onNavigate();
  };

  return (
    <div className="account" ref={ref}>
      {open && <AccountMenuList me={me} onClose={close} />}
      <button className="account-button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu" aria-label="계정 메뉴" data-tip={collapsed ? workspaceName : undefined}>
        <span className="avatar" aria-hidden="true">{workspaceName.slice(0, 1)}</span>
        {!collapsed && (
          <>
            <span className="account-text">
              <span className="account-name">{workspaceName}</span>
              <span className="account-plan">{plan}</span>
            </span>
            <Icon name="chevron-down" size={16} />
          </>
        )}
      </button>
    </div>
  );
}

function useAccountActions(onClose: () => void) {
  const navigate = useNavigate();
  const { refresh } = useMe();
  const logout = async () => {
    await api.post("/auth/logout");
    await refresh();
    navigate("/login");
  };
  const switchTo = async (workspaceId: string) => {
    await api.post("/workspaces/switch", { workspaceId });
    onClose();
    await refresh();
    navigate("/");
  };
  return { logout, switchTo };
}

function AccountMenuList({ me, onClose }: { me: Me; onClose: () => void }) {
  const { logout, switchTo } = useAccountActions(onClose);
  const otherWorkspaces = me.workspaces.length > 1 ? me.workspaces.filter((w) => w.id !== me.workspace?.id) : [];

  return (
    <div className="account-menu" role="menu">
      <div className="account-email">{me.user.email}</div>
      {me.user.phone && <div className="account-email account-phone">{me.user.phone}</div>}
      {otherWorkspaces.map((w) => (
        <button key={w.id} className="account-item" role="menuitem" onClick={() => void switchTo(w.id)}>
          <span className="avatar avatar-sm" aria-hidden="true">{w.name.slice(0, 1)}</span>
          <span>{w.name}</span>
        </button>
      ))}
      {ACCOUNT_LINKS.map((l) => (
        <Link key={l.to} to={l.to} className="account-item" role="menuitem" onClick={onClose}>
          <Icon name={l.icon} />
          <span>{l.label}</span>
        </Link>
      ))}
      <hr />
      <Link to="/referral" className="account-item" role="menuitem" onClick={onClose}>
        <Icon name="gift" />
        <span>추천 프로그램</span>
      </Link>
      <hr />
      <button className="account-item" role="menuitem" onClick={() => void logout()}>
        <Icon name="log-out" />
        <span>로그아웃</span>
      </button>
    </div>
  );
}
