import { useNavigate } from "react-router-dom";
import { Dropdown, Icon, type DropdownItem } from "../ui";
import { api } from "../lib/api";
import { useMe, type Me } from "../lib/me";
import { ACCOUNT_LINKS } from "./nav";

const PLAN_LABELS: Record<string, string> = { starter: "Starter" };
const REFERRAL = { to: "/dashboard/referral", label: "추천 프로그램" } as const;

type Props = { me: Me; collapsed: boolean; onNavigate: () => void };

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
    navigate("/dashboard");
  };
  return { logout, switchTo };
}

const Avatar = ({ name, size }: { name: string; size?: "sm" }) => <span className={`avatar ${size ? "avatar-sm" : ""}`} aria-hidden="true">{name.slice(0, 1)}</span>;

// 사이드바 맨 위: 지금 워크스페이스 이름. 누르면 다른 워크스페이스로 전환하거나 설정으로 간다
export function WorkspaceSwitcher({ me, collapsed, onNavigate }: Props) {
  const navigate = useNavigate();
  const { switchTo } = useAccountActions(onNavigate);
  const name = me.workspace?.name ?? "워크스페이스 없음";
  const plan = PLAN_LABELS[me.workspace?.plan ?? "starter"] ?? me.workspace?.plan;
  const settings = ACCOUNT_LINKS[0];
  const others: DropdownItem[] = me.workspaces
    .filter((w) => w.id !== me.workspace?.id)
    .map((w) => ({ label: w.name, leading: <Avatar name={w.name} size="sm" />, onSelect: () => void switchTo(w.id) }));
  const items: DropdownItem[] = [...others];
  if (settings) items.push({ label: settings.label, icon: settings.icon, divider: others.length > 0, onSelect: () => {
    navigate(settings.to);
    onNavigate();
  } });

  return (
    <Dropdown items={items} label={`워크스페이스: ${name}`} header={plan ? `${plan} 요금제` : undefined} triggerClassName="workspace-button" tip={collapsed ? name : undefined}>
      <Avatar name={name} />
      {!collapsed && (
        <>
          <span className="workspace-name">{name}</span>
          <Icon name="chevron-down" size={16} />
        </>
      )}
    </Dropdown>
  );
}

// 사이드바 맨 아래: 내 계정(이름, 이메일). 설정·요금제·연동·도움·로그아웃
export function AccountMenu({ me, collapsed, onNavigate }: Props) {
  const navigate = useNavigate();
  const { logout } = useAccountActions(onNavigate);
  const go = (to: string) => () => {
    navigate(to);
    onNavigate();
  };
  const items: DropdownItem[] = [
    ...ACCOUNT_LINKS.map((l) => ({ label: l.label, icon: l.icon, onSelect: go(l.to) })),
    { label: REFERRAL.label, icon: "gift", divider: true, onSelect: go(REFERRAL.to) },
    { label: "로그아웃", icon: "log-out", divider: true, onSelect: () => void logout() },
  ];

  return (
    <div className="account">
      <Dropdown items={items} label="계정 메뉴" side="top" header={me.user.phone ?? undefined} triggerClassName="account-button" tip={collapsed ? me.user.name : undefined}>
        <Avatar name={me.user.name || me.user.email} />
        {!collapsed && (
          <span className="account-text">
            <span className="account-name">{me.user.name}</span>
            <span className="account-email">{me.user.email}</span>
          </span>
        )}
      </Dropdown>
    </div>
  );
}
