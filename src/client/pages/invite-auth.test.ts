// @vitest-environment happy-dom
import { act, createElement as h, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeProvider, type Me } from "../lib/me";
import { OnboardingPage } from "../features/onboarding/OnboardingPage";
import { InviteAcceptPage } from "./InviteAccept";
import { LoginPage } from "./Login";
import { VerifyPhonePage } from "./VerifyPhone";

const INVITE = "/invite/invite-token";
const account = (verified = false, email = "invited@example.com"): Me => ({
  user: { id: "u1", email, name: "초대받은 사람", phone: null }, phoneVerified: verified,
  workspace: null, role: null, workspaces: [],
});
let me: Me | null;
let google: boolean;
let inviteError: string;
let accepted: number;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  me = null;
  google = true;
  inviteError = "";
  accepted = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const path = new URL(String(input), "https://app.example.com").pathname;
    if (path === "/api/auth/me") return Response.json(me);
    if (path === "/api/auth/config") return Response.json({ google });
    if (path === "/api/invites/invite-token") return inviteError
      ? Response.json({ error: { code: "invite_expired", message: inviteError } }, { status: 410 })
      : Response.json({ workspaceName: "초대한 팀", email: "invited@example.com", role: "editor", expiresAt: Date.now() + 60_000 });
    if (path === "/api/auth/logout") { me = null; return Response.json({ ok: true }); }
    if (path === "/api/auth/phone/send") return Response.json({ phone: "010-****-0001", expiresAt: Date.now() + 300_000, resendAfterSec: 60 });
    if (path === "/api/auth/phone/verify") { me = { ...me!, phoneVerified: true }; return Response.json({ phoneVerified: true }); }
    if (path === "/api/invites/invite-token/accept") {
      accepted++;
      me = { ...me!, workspace: { id: "w1", name: "초대한 팀", plan: "starter", onboardedAt: 1 }, role: "editor", workspaces: [{ id: "w1", name: "초대한 팀", plan: "starter", role: "editor" }] };
      return Response.json({ workspaceId: "w1" });
    }
    throw new Error(`예상하지 않은 API 요청: ${path}`);
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function LocationProbe() {
  const location = useLocation();
  return h("output", { id: "current-route" }, location.pathname + location.search);
}
async function open(path = INVITE) {
  await act(async () => root.render(h(MeProvider, null, h(MemoryRouter, { initialEntries: [path] }, h(Fragment, null,
    h(LocationProbe), h(Routes, null,
      h(Route, { path: "/invite/:token", element: h(InviteAcceptPage) }),
      h(Route, { path: "/login", element: h(LoginPage) }),
      h(Route, { path: "/verify-phone", element: h(VerifyPhonePage) }),
      h(Route, { path: "/onboarding", element: h(OnboardingPage) }),
      h(Route, { path: "/dashboard", element: h("p", null, "팀 홈") }),
    ),
  )))));
}
const route = () => container.querySelector("#current-route")?.textContent;
const button = (label: string) => [...container.querySelectorAll("button")].find((el) => el.textContent?.includes(label))!;
const click = async (label: string) => { await act(async () => button(label).click()); };
async function fill(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
const submit = async () => { await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); };

describe("초대 화면의 Google 로그인", () => {
  it("기존 Google 버튼을 이메일 폼 앞에 표시하고 초대 경로로 로그인을 시작한다", async () => {
    const assign = vi.spyOn(location, "assign").mockImplementation(() => {});
    await open();
    const googleButton = button("Google로 계속하기");
    expect(googleButton.disabled).toBe(false);
    expect(googleButton.classList.contains("btn-secondary")).toBe(true);
    expect(googleButton.classList.contains("btn-lg")).toBe(true);
    expect(googleButton.closest("form")).toBeNull();
    await click("Google로 계속하기");
    expect(assign).toHaveBeenCalledWith(`/api/auth/google/start?next=${encodeURIComponent(INVITE)}`);
    expect(accepted).toBe(0);
  });

  it("번호 인증 뒤 원래 초대로 복귀하며 명시적으로 수락한 뒤에만 팀으로 간다", async () => {
    me = account();
    await open();
    expect(route()).toBe(`/verify-phone?next=${encodeURIComponent(INVITE)}`);
    expect(accepted).toBe(0);
    await fill('input[type="tel"]', "01000000001");
    await submit();
    await fill('input[autocomplete="one-time-code"]', "123456");
    await submit();
    expect(route()).toBe(INVITE);
    expect(button("초대 수락하기")).toBeDefined();
    expect(accepted).toBe(0);
    await click("초대 수락하기");
    expect(accepted).toBe(1);
    expect(route()).toBe("/dashboard");
  });

  it("다른 이메일의 미인증 계정은 먼저 로그아웃하고 같은 초대에서 다시 로그인할 수 있다", async () => {
    me = account(false, "other@example.com");
    await open();
    expect(route()).toBe(INVITE);
    expect(container.textContent).toContain("초대받은 이메일로 다시 로그인해 주세요.");
    expect(container.querySelector('input[type="tel"]')).toBeNull();
    await click("로그아웃");
    expect(route()).toBe(INVITE);
    expect(button("Google로 계속하기").disabled).toBe(false);
    expect(accepted).toBe(0);
  });

  it("취소 후 기존 로그인 화면이 오류를 보여 주고 Google 재시도에 초대를 유지한다", async () => {
    const assign = vi.spyOn(location, "assign").mockImplementation(() => {});
    await open(`/login?error=google_cancelled&next=${encodeURIComponent(INVITE)}`);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("구글 로그인을 취소했어요.");
    await click("Google로 계속하기");
    expect(assign).toHaveBeenCalledWith(`/api/auth/google/start?next=${encodeURIComponent(INVITE)}`);
  });

  it("만료된 초대는 Google 로그인이나 수락을 시작하지 않는다", async () => {
    inviteError = "만료된 초대 링크예요. 관리자에게 다시 요청해 주세요.";
    await open();
    expect(container.textContent).toContain("초대를 열 수 없어요");
    expect(container.textContent).toContain(inviteError);
    expect(button("Google로 계속하기")).toBeUndefined();
    expect(accepted).toBe(0);
  });

  it("Google 설정이 없으면 기존 비활성 안내를 유지한다", async () => {
    google = false;
    await open();
    expect(button("Google로 계속하기").disabled).toBe(true);
    expect(container.textContent).toContain("구글 로그인은 준비 중이에요.");
  });

  it("직접 전달된 unsafe next도 로그인 재시도에서 차단한다", async () => {
    const assign = vi.spyOn(location, "assign").mockImplementation(() => {});
    await open(`/login?next=${encodeURIComponent("/\\evil.example")}`);
    await click("Google로 계속하기");
    expect(assign).toHaveBeenCalledWith("/api/auth/google/start?next=%2Fdashboard");
  });

  it("번호 인증과 온보딩의 next도 같은 사이트의 경로로 제한한다", async () => {
    me = { ...account(true), workspace: { id: "w1", name: "기존 팀", plan: "starter", onboardedAt: 1 }, workspaces: [{ id: "w1", name: "기존 팀", plan: "starter", role: "editor" }] };
    await open(`/verify-phone?next=${encodeURIComponent("/.//evil.example")}`);
    expect(route()).toBe("/dashboard");
  });
});
