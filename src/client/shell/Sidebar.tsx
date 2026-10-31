import { useState } from "react";
import { NavLink } from "react-router-dom";
import { Icon } from "../ui";
import type { Me } from "../lib/me";
import { AccountMenu, WorkspaceSwitcher } from "./AccountMenu";
import { NotificationBell } from "./NotificationBell";
import { NAV } from "./nav";
import "./Sidebar.css";

const STORAGE_KEY = "sidebar-collapsed";
// 홈은 하위 경로에서 활성으로 보이면 안 된다
const HOME_PATH = NAV[0]?.items[0]?.to;

function readCollapsed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function useCollapsed() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () => {
    setCollapsed((v) => {
      try {
        localStorage.setItem(STORAGE_KEY, v ? "0" : "1");
      } catch {
        /* 저장 불가 환경은 무시 */
      }
      return !v;
    });
  };
  return { collapsed, toggle };
}

type Props = { me: Me; isMobile: boolean; mobileOpen: boolean; onNavigate: () => void };

// 휴대폰에서는 접힘 기능 대신 상단 메뉴 버튼으로 여닫는 서랍이 된다
export function Sidebar({ me, isMobile, mobileOpen, onNavigate }: Props) {
  const stored = useCollapsed();
  const collapsed = stored.collapsed && !isMobile;
  const className = ["sidebar", collapsed && "is-collapsed", mobileOpen && "is-mobile-open"].filter(Boolean).join(" ");

  return (
    <aside className={className} id="app-sidebar" aria-label="주 메뉴">
      <div className="sidebar-head">
        <WorkspaceSwitcher me={me} collapsed={collapsed} mobile={isMobile} onNavigate={onNavigate} />
        {/* 휴대폰은 상단 바에 따로 있다 */}
        {!isMobile && <NotificationBell collapsed={collapsed} />}
        <button className="sidebar-toggle" onClick={isMobile ? onNavigate : stored.toggle} aria-label={isMobile ? "메뉴 닫기" : collapsed ? "사이드바 펼치기" : "사이드바 접기"} aria-expanded={isMobile ? mobileOpen : !collapsed} data-tip={collapsed ? "펼치기" : undefined}>
          <Icon name={isMobile ? "x" : "panel-left"} size={16} />
        </button>
      </div>
      <SidebarNav collapsed={collapsed} onNavigate={onNavigate} />
      <AccountMenu me={me} collapsed={collapsed} onNavigate={onNavigate} />
    </aside>
  );
}

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate: () => void }) {
  return (
    <nav className="sidebar-nav">
      {NAV.map((group, i) => (
        <div className="sidebar-group" key={group.title ?? i}>
          {group.title && !collapsed && <div className="sidebar-group-title">{group.title}</div>}
          {group.items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === HOME_PATH} className="sidebar-item" aria-label={collapsed ? item.label : undefined} data-tip={collapsed ? item.label : undefined} onClick={onNavigate}>
              <Icon name={item.icon} size={16} />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}
