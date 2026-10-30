import { Navigate, useLocation, type RouteObject } from "react-router-dom";

// /dashboard 로 옮기기 전 앱 경로. 북마크·발송된 메일 링크가 계속 열리도록 남긴다
const LEGACY_PREFIXES = [
  "guides", "influencers", "reviews", "links", "forms", "keyword-dm", "leads", "automations",
  "broadcasts", "performance", "sites", "settings", "documents", "referral", "help",
];

function LegacyRedirect() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={`/dashboard${pathname}${search}${hash}`} replace />;
}

// TASK-070: 가이드 목록·상세는 캠페인으로 옮겼다. 알림 link_path·북마크의 /dashboard/guides/* 를 같은 뒷주소로 보낸다
function GuidesToCampaigns() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={`${pathname.replace(/^\/dashboard\/guides/, "/dashboard/campaigns")}${search}${hash}`} replace />;
}

export const guidesToCampaigns: RouteObject[] = [
  { path: "guides", element: <GuidesToCampaigns /> },
  { path: "guides/*", element: <GuidesToCampaigns /> },
];

export const legacyRoutes: RouteObject[] = LEGACY_PREFIXES.flatMap((p) => [
  { path: `/${p}`, element: <LegacyRedirect /> },
  { path: `/${p}/*`, element: <LegacyRedirect /> },
]);
