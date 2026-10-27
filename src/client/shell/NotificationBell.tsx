import { useNavigate } from "react-router-dom";
import { Badge, Dropdown, Icon, type DropdownItem } from "../ui";
import { relativeTime, type NotificationItem } from "../../shared/notifications";
import { useNotifications } from "./useNotifications";
import "./NotificationBell.css";

// 배지에는 두 자리까지만. 그 이상은 99+
const MAX_BADGE = 99;

type Props = { align?: "start" | "end"; collapsed?: boolean };

// 셸 상단 종 아이콘: 인플루언서 수락·철회·업로드·피드백 반영 소식 (AIWITH-290)
export function NotificationBell({ align = "start", collapsed = false }: Props) {
  const navigate = useNavigate();
  const { items, unread, markRead, markAllRead } = useNotifications();
  const nowMs = Date.now();
  const open = (n: NotificationItem) => {
    void markRead(n);
    navigate(n.linkPath);
  };
  const rows: DropdownItem[] = items.map((n, i) => ({
    id: n.id,
    label: n.title,
    description: n.read ? relativeTime(n.createdAt, nowMs) : `안 읽음, ${relativeTime(n.createdAt, nowMs)}`,
    leading: <span className={`notif-dot ${n.read ? "" : "is-unread"}`} aria-hidden="true" />,
    divider: i === 0,
    onSelect: () => open(n),
  }));
  const menu: DropdownItem[] = [{ id: "read-all", label: "모두 읽음", icon: "check", disabled: unread === 0, onSelect: () => void markAllRead() }, ...rows];
  const label = unread ? `알림, 안 읽은 알림 ${unread}개` : "알림";
  const header = items.length ? "최근 알림" : "아직 알림이 없어요. 인플루언서가 참여하거나 영상을 올리면 여기에 보여요.";

  return (
    <Dropdown items={menu} label={label} align={align} header={header} menuClassName="notif-menu" triggerClassName="btn btn-ghost btn-md btn-icon notif-button" tip={collapsed ? "알림" : undefined}>
      <Icon name="bell" />
      {unread > 0 && (
        <span className="notif-count">
          <Badge tone="danger">{unread > MAX_BADGE ? `${MAX_BADGE}+` : unread}</Badge>
        </span>
      )}
    </Dropdown>
  );
}
