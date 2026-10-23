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

export const legacyRoutes: RouteObject[] = LEGACY_PREFIXES.flatMap((p) => [
  { path: `/${p}`, element: <LegacyRedirect /> },
  { path: `/${p}/*`, element: <LegacyRedirect /> },
]);
