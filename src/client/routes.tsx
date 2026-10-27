import type { ComponentType } from "react";
import { createBrowserRouter, type RouteObject } from "react-router-dom";
import { AppShell } from "./shell/AppShell";
import { Placeholder } from "./pages/Placeholder";
import { HomePage } from "./pages/Home";
import { LoginPage } from "./pages/Login";
import { SignupPage } from "./pages/Signup";
import { NotFoundPage } from "./pages/NotFound";
import { LandingPage } from "./pages/landing/LandingPage";
import { legacyRoutes } from "./LegacyRedirect";
import { LoadingState } from "./ui";
import "./pages/Auth.css";

type PageModule<K extends string> = Record<K, ComponentType>;

// 화면 단위로 청크를 나눈다. 처음 여는 동안은 LoadingState, 이후 이동은 이전 화면이 남아 있다가 바뀐다
function page<K extends string>(load: () => Promise<PageModule<K>>, name: K): Pick<RouteObject, "lazy" | "HydrateFallback"> {
  return { lazy: async () => ({ Component: (await load())[name] }), HydrateFallback: LoadingState };
}

// 로그인 후 앱 셸(LNB) 안의 화면. /dashboard 아래 상대 경로
export const appRoutes: RouteObject[] = [
  { index: true, element: <HomePage /> },
  { path: "guides", ...page(() => import("./features/guides/GuidesListPage"), "GuidesListPage") },
  { path: "guides/new", ...page(() => import("./features/guides/GuideEditPage"), "GuideEditPage") },
  { path: "guides/:id", ...page(() => import("./features/guides/GuideDetailPage"), "GuideDetailPage") },
  { path: "guides/:id/edit", ...page(() => import("./features/guides/GuideEditPage"), "GuideEditPage") },
  { path: "settings/guidelines", ...page(() => import("./features/guides/GuidelinesPage"), "GuidelinesPage") },
  { path: "influencers", ...page(() => import("./features/guides/InfluencersPage"), "InfluencersPage") },
  { path: "reviews", ...page(() => import("./features/reviews/ReviewsPage"), "ReviewsPage") },
  { path: "reviews/:submissionId", ...page(() => import("./features/reviews/ReviewDetailPage"), "ReviewDetailPage") },
  { path: "links", ...page(() => import("./features/links/LinksPage"), "LinksPage") },
  { path: "forms", ...page(() => import("./features/forms/FormsPage"), "FormsPage") },
  { path: "forms/:id", ...page(() => import("./features/forms/FormsPage"), "FormEditorPage") },
  { path: "keyword-dm", ...page(() => import("./features/performance/KeywordDmPage"), "KeywordDmPage") },
  { path: "leads", ...page(() => import("./features/leads/LeadsPage"), "LeadsPage") },
  { path: "automations", ...page(() => import("./features/messaging/AutomationsPage"), "AutomationsPage") },
  { path: "broadcasts", ...page(() => import("./features/messaging/BroadcastsPage"), "BroadcastsPage") },
  { path: "performance", ...page(() => import("./features/performance/PerformancePage"), "PerformancePage") },
  { path: "sites", ...page(() => import("./features/sites/Page"), "SitesPage") },
  { path: "settings/workspace", ...page(() => import("./pages/settings/Workspace"), "WorkspaceSettingsPage") },
  { path: "settings/plan", ...page(() => import("./pages/settings/Plan"), "PlanPage") },
  { path: "settings/integrations", ...page(() => import("./pages/settings/Integrations"), "IntegrationsPage") },
  { path: "referral", element: <Placeholder title="추천 프로그램" /> },
  { path: "help", ...page(() => import("./features/support/HelpPage"), "HelpPage") },
  { path: "documents/new", ...page(() => import("./features/docs/DocumentPages"), "DocumentNewPage") },
  { path: "documents/:id", ...page(() => import("./features/docs/DocumentPages"), "DocumentEditPage") },
];

// 로그인 없이 여는 화면 (팀 초대, 인플루언서·방문자용 토큰 링크)
export const publicRoutes: RouteObject[] = [
  { path: "/", element: <LandingPage /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/signup", element: <SignupPage /> },
  { path: "/invite/:token", ...page(() => import("./pages/InviteAccept"), "InviteAcceptPage") },
  { path: "/g/:token", ...page(() => import("./features/public-guide/GuidePublicPage"), "GuidePublicPage") },
  { path: "/u/:token", ...page(() => import("./features/public-guide/UploadPublicPage"), "UploadPublicPage") },
  { path: "/f/:token", ...page(() => import("./features/reviews/FeedbackPublicPage"), "FeedbackPublicPage") },
  { path: "/d/:token", ...page(() => import("./features/docs/PublicDocPage"), "PublicDocPage") },
  { path: "/form/:token", ...page(() => import("./features/forms/PublicFormPage"), "PublicFormPage") },
  { path: "/connect/:token", ...page(() => import("./features/performance/ConnectPublicPage"), "ConnectPublicPage") },
  { path: "/unsubscribe/:token", ...page(() => import("./features/messaging/UnsubscribePage"), "UnsubscribePage") },
  { path: "/verify-phone", ...page(() => import("./pages/VerifyPhone"), "VerifyPhonePage") },
  { path: "/onboarding", ...page(() => import("./features/onboarding/OnboardingPage"), "OnboardingPage") },
  { path: "/forgot-password", ...page(() => import("./pages/PasswordReset"), "ForgotPasswordPage") },
  { path: "/reset-password/:token", ...page(() => import("./pages/PasswordReset"), "ResetPasswordPage") },
];

// 개발 서버에서만 등록한다. 운영 빌드에서는 DEV가 false라 동적 import까지 번들에서 빠진다
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      { path: "/dev/ui", HydrateFallback: () => null, lazy: async () => ({ Component: (await import("./pages/dev-ui/Page")).DevUiPage }) },
      { path: "/dev/ui/sample", HydrateFallback: () => null, lazy: async () => ({ Component: (await import("./pages/dev-ui/sample/Page")).SampleCandidatesPage }) },
    ]
  : [];

export const router = createBrowserRouter([
  ...publicRoutes,
  ...devRoutes,
  { path: "/dashboard", element: <AppShell />, children: appRoutes },
  ...legacyRoutes,
  { path: "*", element: <NotFoundPage /> },
]);
