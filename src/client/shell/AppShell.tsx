import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { IconButton, LoadingState } from "../ui";
import { useMe } from "../lib/me";
import { Sidebar } from "./Sidebar";
import { MOBILE_QUERY, useMediaQuery } from "./useMediaQuery";
import "./AppShell.css";

export function AppShell() {
  const { me, loading } = useMe();
  const location = useLocation();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [location.pathname, isMobile]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  if (loading) return <div className="shell-loading"><LoadingState /></div>;
  const next = encodeURIComponent(location.pathname + location.search);
  if (!me) return <Navigate to={`/login?next=${next}`} replace />;
  // 휴대폰 인증 전이거나(필수) 구글 가입 직후 워크스페이스가 없으면 인증 화면에서 마저 진행한다
  if (!me.phoneVerified || me.workspaces.length === 0) return <Navigate to={`/verify-phone?next=${next}`} replace />;
  const workspaceName = me.workspace?.name ?? "워크스페이스 없음";
  return (
    <div className="shell">
      <a href="#main" className="skip-link">본문으로 건너뛰기</a>
      {isMobile && (
        <header className="topbar">
          <IconButton icon="menu" label="메뉴 열기" aria-expanded={menuOpen} aria-controls="app-sidebar" onClick={() => setMenuOpen(true)} />
          <span className="topbar-title">{workspaceName}</span>
        </header>
      )}
      <Sidebar me={me} isMobile={isMobile} mobileOpen={menuOpen} onNavigate={() => setMenuOpen(false)} />
      {isMobile && menuOpen && <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
      <main className="shell-content" id="main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
