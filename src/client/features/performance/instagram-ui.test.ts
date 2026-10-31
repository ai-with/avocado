// @vitest-environment happy-dom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../ui";
import { GuidePublicPage } from "../public-guide/GuidePublicPage";
import type { GuideData, PersonalData } from "../public-guide/guideTypes";
import { ConnectPublicPage } from "./ConnectPublicPage";
import { InstagramCard } from "./InstagramCard";
import { KdmConnectionNotice } from "./sections/KdmConnectionNotice";

vi.mock("../../lib/me", () => ({ useMe: () => ({ me: { user: { id: "u1" }, workspace: { id: "w1" }, role: "owner" }, loading: false }) }));
type RequestLog = { path: string; query: URLSearchParams; method: string; body: Record<string, unknown>; credentials: RequestCredentials | undefined };
let root: Root, container: HTMLDivElement, requests: RequestLog[];
let guide: GuideData, info: Record<string, unknown>, connections: Record<string, unknown>[];
let authorizationUrl: string, startError: string | null, connectMissing: boolean;
let assign: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  requests = []; connections = []; startError = null; connectMissing = false;
  authorizationUrl = "https://www.instagram.com/oauth/authorize?state=opaque-db-state";
  guide = {
    mode: "personal", lang: "ko", influencer: { displayName: "Creator", email: null, country: null },
    guide: { brandName: "Brand", name: "Campaign", product: { name: "Product", benefits: [], usage: "", photos: [] }, purpose: "", lengthS: null, deadlineAt: null, deliverables: { final: true, clean: false, note: "" }, secondaryUseScope: { ads: false, media: [], regions: [], months: 0 }, videoGuide: null, rules: [], checklist: [] },
    consent: null, leadLinks: [], tabs: { guide: "/g/guide-token", upload: null, feedback: null, unreadFeedback: 0, deadlineAt: null },
    instagram: { configured: true, status: "not_connected", connected: false, username: null, connectUrl: "/connect/connect-token?returnMode=guide&lang=ko" },
  } satisfies PersonalData;
  info = { target: "influencer", name: "Creator", lang: "en", agencyName: null, brandName: "Brand", configured: true, connected: false, expired: false, disconnected: false, reason: null, username: null, returnMode: "guide", returnUrl: "/g/guide-token?lang=en" };
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost:3000");
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
    requests.push({ path: url.pathname, query: url.searchParams, method: init?.method ?? "GET", body, credentials: init?.credentials });
    if (url.pathname === "/api/public/guide/guide-token") return Response.json(guide);
    if (url.pathname === "/api/ig/connect/connect-token") return connectMissing ? Response.json({ error: { code: "expired", message: "expired" } }, { status: 410 }) : Response.json(info);
    if (url.pathname === "/api/ig/connections") return Response.json({ configured: true, fake: false, connections });
    if (url.pathname === "/api/ig/oauth/start") return startError ? Response.json({ error: { code: startError, message: "Could not connect" } }, { status: 400 }) : Response.json({ authorizationUrl });
    throw new Error(`Unexpected UI request: ${url.pathname}`);
  }));
  assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function show(element: ReactNode, path: string, route = "/connect/:token") {
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [path] }, h(ToastProvider, null, h(Routes, null, h(Route, { path: route, element }))))));
}
function button(text: string) {
  const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}
const click = async (text: string) => { await act(async () => button(text).click()); };
const starts = () => requests.filter((request) => request.path === "/api/ig/oauth/start");

describe("Instagram connection actual React DOM", () => {
  it("개인가이드 연결 CTA는 서버의 링크와 현재 언어를 쓰고 참여 CTA를 유지한다", async () => {
    await show(h(GuidePublicPage), "/g/guide-token?lang=en", "/g/:token");
    expect(container.textContent).toContain("Connecting is optional");
    const link = container.querySelector<HTMLAnchorElement>('a[href^="/connect/"]')!;
    const url = new URL(link.getAttribute("href")!, "https://app.example.com");
    expect(url.pathname).toBe("/connect/connect-token");
    expect(Object.fromEntries(url.searchParams)).toEqual({ returnMode: "guide", lang: "en" });
    expect(button("Join")).toBeDefined();
    expect(starts()).toHaveLength(0);
    await click("한국어");
    expect(container.querySelector('a[href^="/connect/"]')?.getAttribute("href")).toContain("lang=ko");
  });

  it("공용가이드에는 개인계정 연결 CTA를 노출하지 않는다", async () => {
    guide = { mode: "shared", lang: "ko", guide: guide.guide };
    await show(h(GuidePublicPage), "/g/guide-token", "/g/:token");
    expect(container.querySelector('a[href^="/connect/"]')).toBeNull();
    expect(container.textContent).not.toContain("Instagram account");
    expect(starts()).toHaveLength(0);
  });

  it("공개 OAuth는 POST와 같은 출처 쿠키를 쓰며 guide/lang 복귀 모드를 보낸다", async () => {
    await show(h(ConnectPublicPage), "/connect/connect-token?returnMode=guide&lang=en");
    const lookup = requests.find((request) => request.path === "/api/ig/connect/connect-token")!;
    expect(Object.fromEntries(lookup.query)).toEqual({ returnMode: "guide", lang: "en" });
    expect(container.querySelector('a[href="/g/guide-token?lang=en"]')).not.toBeNull();
    await click("Connect with Instagram");
    expect(starts()).toHaveLength(1);
    expect(starts()[0]).toMatchObject({ method: "POST", credentials: "same-origin", body: { target: "influencer", token: "connect-token", returnMode: "guide", lang: "en" } });
    expect(assign).toHaveBeenCalledWith(authorizationUrl);
  });

  it("언어를 바꾼 뒤 재연결도 현재 언어와 끊김 상태를 유지한다", async () => {
    info = { ...info, expired: true, disconnected: true, reason: "expired" };
    await show(h(ConnectPublicPage), "/connect/connect-token?returnMode=guide&lang=en");
    expect(container.textContent).toContain("Your account is disconnected");
    await click("한국어"); await click("인스타그램 다시 연결하기");
    expect(starts()[0]?.body.lang).toBe("ko");
    expect(container.querySelector('a[href="/g/guide-token?lang=ko"]')).not.toBeNull();
  });

  it("취소·권한실패 복귀를 알리고 URL 파라미터만으로 연결 성공을 표시하지 않는다", async () => {
    info = { ...info, reason: "grant_unverified" };
    await show(h(ConnectPublicPage), "/connect/connect-token?ig=cancelled&done=1&error=permissions_missing");
    expect(container.textContent).toContain("You cancelled");
    expect(container.textContent).toContain("Required permissions are missing");
    expect(container.textContent).toContain("Please confirm your account");
    expect(container.textContent).not.toContain("Connected. You can close");
    expect(starts()).toHaveLength(0);
  });

  it("실제 연결된 성공 복귀는 계정을 표시하고 OAuth를 다시 시작하지 않는다", async () => {
    info = { ...info, connected: true, username: "actual_creator" };
    await show(h(ConnectPublicPage), "/connect/connect-token?ig=connected&done=1");
    expect(container.textContent).toContain("Connected. You can close");
    expect(container.textContent).toContain("@actual_creator is connected");
    expect(starts()).toHaveLength(0);
  });

  it("준비되지 않은 키와 만료된 링크에서 성공·OAuth 시작을 노출하지 않는다", async () => {
    info = { ...info, configured: false };
    await show(h(ConnectPublicPage), "/connect/connect-token?ig=connected&done=1");
    expect(container.textContent).toContain("Connection is not available yet");
    expect(container.textContent).not.toContain("Connected. You can close");
    expect([...container.querySelectorAll("button")].some((item) => item.textContent === "Connect with Instagram")).toBe(false);
    expect(starts()).toHaveLength(0);
  });

  it("만료된 공개 링크는 가이드·OAuth capability를 새로 추정하지 않는다", async () => {
    connectMissing = true;
    await show(h(ConnectPublicPage), "/connect/connect-token?returnMode=guide&lang=en");
    expect(container.textContent).toContain("Link not found");
    expect(container.querySelector('a[href^="/g/"]')).toBeNull();
    expect(starts()).toHaveLength(0);
    expect(assign).not.toHaveBeenCalled();
  });

  it("서버 시작 오류와 허용되지 않은 외부 URL은 이동하지 않고 재시도 안내한다", async () => {
    startError = "permissions_missing";
    await show(h(ConnectPublicPage), "/connect/connect-token");
    await click("Connect with Instagram");
    expect(container.textContent).toContain("Required permissions are missing");
    startError = null; authorizationUrl = "https://evil.example/oauth/authorize";
    await click("Connect with Instagram");
    expect(container.textContent).toContain("Could not connect. Please try again later");
    expect(assign).not.toHaveBeenCalled();
  });

  it("브랜드 화면도 공통 끊김 상태와 POST 연결을 쓰며 거짓 성공 복귀를 표시하지 않는다", async () => {
    connections = [{ id: "brand", target: "brand_sender", label: null, username: "brand", scopes: [], connected: false, expired: false, disconnected: true, reason: "provider_auth_invalid", connectedAt: 123, revokedAt: null, connectUrl: null }];
    await show(h(InstagramCard), "/dashboard/settings/integrations?ig=connected&done=1", "/dashboard/settings/integrations");
    expect(container.textContent).toContain("연결 끊김");
    expect(container.textContent).not.toContain("인스타그램 계정을 연결했어요");
    await click("다시 연결");
    expect(starts()[0]).toMatchObject({ method: "POST", credentials: "same-origin", body: { target: "brand_sender", returnMode: "settings", lang: "ko" } });
    expect(assign).toHaveBeenCalledWith(authorizationUrl);
  });

  it("자동 DM도 유효기간이 남은 190·수동 해제 계정을 연결됨으로 표시하지 않는다", async () => {
    await show(h(KdmConnectionNotice, { data: { configured: true, connection: { username: "brand", connected: false, expired: false, disconnected: true, reason: "provider_auth_invalid" }, defaultPublicReplies: [], rules: [] } }), "/dashboard/keyword-dm", "/dashboard/keyword-dm");
    expect(container.textContent).toContain("연결이 끊겼어요");
    expect(container.textContent).not.toContain("연결된 계정:");
    expect(container.querySelector('a[href="/dashboard/settings/integrations"]')).not.toBeNull();
  });

  it("최신 브랜드 연결의 수동 해제 뒤 과거 연결을 다시 연결됨으로 표시하지 않는다", async () => {
    const disconnected = { id: "newest", target: "brand_sender", label: null, username: "brand", scopes: [], connected: false, expired: false, disconnected: true, reason: "manual", connectedAt: 200, revokedAt: 300, connectUrl: null };
    connections = [disconnected, { ...disconnected, id: "old", connected: true, disconnected: false, reason: null, connectedAt: 100, revokedAt: null }];
    await show(h(InstagramCard), "/dashboard/settings/integrations?ig=connected&done=1", "/dashboard/settings/integrations");
    expect(container.textContent).toContain("연결 끊김");
    expect(container.querySelector("dl.kv")).toBeNull();
    expect(container.textContent).not.toContain("인스타그램 계정을 연결했어요");
    expect(button("다시 연결")).toBeDefined();
  });
});
