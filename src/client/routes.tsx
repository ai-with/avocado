import { createBrowserRouter, type RouteObject } from "react-router-dom";
import { AppShell } from "./shell/AppShell";
import { Placeholder } from "./pages/Placeholder";
import { HomePage } from "./pages/Home";
import { LoginPage } from "./pages/Login";
import { SignupPage } from "./pages/Signup";
import { InviteAcceptPage } from "./pages/InviteAccept";
import { NotFoundPage } from "./pages/NotFound";
import { LandingPage } from "./pages/landing/LandingPage";
import { legacyRoutes } from "./LegacyRedirect";
import { WorkspaceSettingsPage } from "./pages/settings/Workspace";
import { PlanPage } from "./pages/settings/Plan";
import "./pages/Auth.css";
import { GuidesListPage } from "./features/guides/GuidesListPage";
import { GuideEditPage } from "./features/guides/GuideEditPage";
import { GuideDetailPage } from "./features/guides/GuideDetailPage";
import { InfluencersPage } from "./features/guides/InfluencersPage";
import { GuidelinesPage } from "./features/guides/GuidelinesPage";
import { GuidePublicPage } from "./features/public-guide/GuidePublicPage";
import { UploadPublicPage } from "./features/public-guide/UploadPublicPage";
import { LinksPage } from "./features/links/LinksPage";
import { FormsPage, FormEditorPage } from "./features/forms/FormsPage";
import { LeadsPage } from "./features/leads/LeadsPage";
import { PublicDocPage } from "./features/docs/PublicDocPage";
import { PublicFormPage } from "./features/forms/PublicFormPage";
import { VerifyPhonePage } from "./pages/VerifyPhone";
import { ForgotPasswordPage, ResetPasswordPage } from "./pages/PasswordReset";
import { AutomationsPage } from "./features/messaging/AutomationsPage";
import { BroadcastsPage } from "./features/messaging/BroadcastsPage";
import { UnsubscribePage } from "./features/messaging/UnsubscribePage";
import { IntegrationsPage } from "./pages/settings/Integrations";
import { PerformancePage } from "./features/performance/PerformancePage";
import { KeywordDmPage } from "./features/performance/KeywordDmPage";
import { ConnectPublicPage } from "./features/performance/ConnectPublicPage";
import { DocumentEditPage, DocumentNewPage } from "./features/docs/DocumentPages";
import { ReviewsPage } from "./features/reviews/ReviewsPage";
import { ReviewDetailPage } from "./features/reviews/ReviewDetailPage";
import { FeedbackPublicPage } from "./features/reviews/FeedbackPublicPage";
import { SitesPage } from "./features/sites/Page";
import { OnboardingPage } from "./features/onboarding/OnboardingPage";

// 로그인 후 앱 셸(LNB) 안의 화면. /dashboard 아래 상대 경로
export const appRoutes: RouteObject[] = [
  { index: true, element: <HomePage /> },
  { path: "guides", element: <GuidesListPage /> },
  { path: "guides/new", element: <GuideEditPage /> },
  { path: "guides/:id", element: <GuideDetailPage /> },
  { path: "guides/:id/edit", element: <GuideEditPage /> },
  { path: "settings/guidelines", element: <GuidelinesPage /> },
  { path: "influencers", element: <InfluencersPage /> },
  { path: "reviews", element: <ReviewsPage /> },
  { path: "reviews/:submissionId", element: <ReviewDetailPage /> },
  { path: "links", element: <LinksPage /> },
  { path: "forms", element: <FormsPage /> },
  { path: "forms/:id", element: <FormEditorPage /> },
  { path: "keyword-dm", element: <KeywordDmPage /> },
  { path: "leads", element: <LeadsPage /> },
  { path: "automations", element: <AutomationsPage /> },
  { path: "broadcasts", element: <BroadcastsPage /> },
  { path: "performance", element: <PerformancePage /> },
  { path: "sites", element: <SitesPage /> },
  { path: "settings/workspace", element: <WorkspaceSettingsPage /> },
  { path: "settings/plan", element: <PlanPage /> },
  { path: "settings/integrations", element: <IntegrationsPage /> },
  { path: "referral", element: <Placeholder title="추천 프로그램" /> },
  { path: "help", element: <Placeholder title="도움 받기" /> },
  { path: "documents/new", element: <DocumentNewPage /> },
  { path: "documents/:id", element: <DocumentEditPage /> },
];

// 로그인 없이 여는 화면 (팀 초대, 인플루언서·방문자용 토큰 링크)
export const publicRoutes: RouteObject[] = [
  { path: "/", element: <LandingPage /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/signup", element: <SignupPage /> },
  { path: "/invite/:token", element: <InviteAcceptPage /> },
  { path: "/g/:token", element: <GuidePublicPage /> },
  { path: "/u/:token", element: <UploadPublicPage /> },
  { path: "/f/:token", element: <FeedbackPublicPage /> },
  { path: "/d/:token", element: <PublicDocPage /> },
  { path: "/form/:token", element: <PublicFormPage /> },
  { path: "/connect/:token", element: <ConnectPublicPage /> },
  { path: "/unsubscribe/:token", element: <UnsubscribePage /> },
  { path: "/verify-phone", element: <VerifyPhonePage /> },
  { path: "/onboarding", element: <OnboardingPage /> },
  { path: "/forgot-password", element: <ForgotPasswordPage /> },
  { path: "/reset-password/:token", element: <ResetPasswordPage /> },
];

export const router = createBrowserRouter([
  ...publicRoutes,
  { path: "/dashboard", element: <AppShell />, children: appRoutes },
  ...legacyRoutes,
  { path: "*", element: <NotFoundPage /> },
]);
