// @vitest-environment happy-dom
import { act, createElement as h, Fragment, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeProvider, useMe, type Me } from "../lib/me";
import { ToastProvider } from "../ui";
import { AppShell } from "../shell/AppShell";
import { OnboardingPage } from "../features/onboarding/OnboardingPage";
import { WorkspaceSettingsPage } from "./settings/Workspace";
import type { Role } from "../../shared/roles";

let me: Me, root: Root, container: HTMLDivElement, mode: "normal" | "retry" | "switched", createBodies: Record<string, unknown>[], surveyBodies: Record<string, unknown>[], skipBodies: Record<string, unknown>[], inviteBodies: Record<string, unknown>[];
let delayedSurvey: ((response: Response) => void) | undefined, holdSurvey: boolean, attempted: boolean;
function persona(role: Role = "owner", onboardedAt: number | null = 1, id = "w1"): Me {
  return { user: { id: "user", name: "팀원", email: "member@example.com", phone: null }, phoneVerified: true,
    workspace: { id, name: id === "w1" ? "One" : "Two", plan: "starter", onboardedAt, onboardingSkippedAt: null }, role,
    workspaces: [{ id: "w1", name: "One", plan: "starter", role }, { id: "w2", name: "Two", plan: "starter", role: "owner" }] };
}
beforeEach(() => {
  me = persona(); mode = "normal"; createBodies = []; surveyBodies = []; skipBodies = []; inviteBodies = []; delayedSurvey = undefined; holdSurvey = false; attempted = false;
  sessionStorage.clear(); localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input), "https://app.test").pathname, body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    if (path === "/api/auth/me") return Response.json(me);
    if (path === "/api/notifications") return Response.json({ items: [], unread: 0 });
    if (path === "/api/workspace/members") return Response.json({ workspaceId: me.workspace!.id, members: [{ userId: "owner", name: "소유자", email: "owner@example.com", role: "owner", joinedAt: 1 }, { userId: "user", name: "팀원", email: "member@example.com", role: me.role, joinedAt: 2 }],
      invites: me.role === "owner" ? [{ id: "owner-invite", email: "owner-pending@example.com", role: "viewer", expiresAt: Date.now() + 60_000, url: "https://app.test/invite/owner-token" }] : me.role === "editor" ? [{ id: "own-invite", email: "own-pending@example.com", role: "viewer", expiresAt: Date.now() + 60_000, url: "https://app.test/invite/own-token" }] : [] });
    if (path === "/api/workspace/invites" && init?.method === "POST") {
      inviteBodies.push(body); return Response.json({ invite: { id: "new", email: body.email, role: body.role, expiresAt: Date.now() + 60_000, url: "https://app.test/invite/new" }, email: { delivered: false, reason: "no_provider" } }, { status: 201 });
    }
    if (path === "/api/workspaces" && init?.method === "POST") {
      createBodies.push(body);
      if (mode === "retry" && !attempted) { attempted = true; throw new TypeError("network outcome unknown"); }
      const fresh = { ...persona("owner", null, "created"), workspace: { id: "created", name: String(body.workspaceName), plan: "starter", onboardedAt: null, onboardingSkippedAt: null } };
      me = mode === "switched" ? persona("owner", 1, "w2") : fresh;
      return Response.json({ workspaceId: "created", selected: true, replayed: attempted }, { status: attempted ? 200 : 201 });
    }
    if (path === "/api/workspace/onboarding/skip") {
      skipBodies.push(body); me = { ...me, workspace: { ...me.workspace!, onboardingSkippedAt: 2 } }; return Response.json({ skippedAt: 2 });
    }
    if (path === "/api/workspace/onboarding") {
      surveyBodies.push(body);
      if (holdSurvey) return new Promise<Response>((resolve) => { delayedSurvey = resolve; });
      me = { ...me, workspace: { ...me.workspace!, onboardedAt: 3 } }; return Response.json({ onboardedAt: 3 });
    }
    throw new Error(`Unexpected local API: ${path}`);
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Probe() { const location = useLocation(); const { refresh } = useMe(); return h(Fragment, null, h("output", { id: "route" }, location.pathname + location.search), h("button", { id: "refresh", onClick: () => void refresh() }, "test refresh")); }
async function open(path = "/dashboard", strict = false) {
  const tree = h(MeProvider, null, h(ToastProvider, null, h(MemoryRouter, { initialEntries: [path] }, h(Fragment, null,
    h(Probe), h(Routes, null,
      h(Route, { path: "/onboarding", element: h(OnboardingPage) }),
      h(Route, { path: "/dashboard", element: h(AppShell) }, h(Route, { index: true, element: h("p", null, "팀 홈") }), h(Route, { path: "settings/workspace", element: h(WorkspaceSettingsPage) })),
      h(Route, { path: "/login", element: h("p", null, "로그인") }),
    ),
  ))));
  await act(async () => root.render(strict ? h(StrictMode, null, tree) : tree));
}
const route = () => container.querySelector("#route")?.textContent;
const buttons = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].filter((button) => button.textContent?.trim() === text);
const click = async (text: string) => { await act(async () => { const button = buttons(text)[0]; expect(button).toBeDefined(); button!.click(); }); };
async function fill(selector: string, value: string) { await act(async () => { const input = document.querySelector<HTMLInputElement>(selector)!; expect(input).not.toBeNull(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); }); }
async function submit(twice = false) { await act(async () => { const form = document.querySelector('[role="dialog"] form') ?? container.querySelector("form"); expect(form).not.toBeNull(); form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); if (twice) form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); }
async function wait(check: () => void) {
  // Flush each poll: holding one act open while waiting for its own React
  // commit can deadlock when native crypto/fetch settles after submit's act.
  await vi.waitFor(async () => { await act(async () => {}); check(); });
}
async function newModal() { await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="워크스페이스: One"]')!.click()); await click("새 워크스페이스 만들기"); }

describe("워크스페이스 생성 DOM", () => {
  it("앱의 StrictMode effect 재시작 후에도 생성 응답을 처리하고 모달을 닫는다", async () => {
    mode = "switched"; await open("/dashboard", true); await newModal(); await fill('[role="dialog"] input', "Strict Team"); await submit();
    await wait(() => expect(document.querySelector('[role="dialog"]')).toBeNull()); expect(createBodies).toHaveLength(1); expect(route()).toBe("/dashboard");
  });
  it("기존 Dropdown과 Modal로 한 번 생성하고 현재 새 WS의 owner 설문을 연다", async () => {
    await open(); await newModal(); expect(document.querySelector('[role="dialog"] input')?.getAttribute("maxlength")).toBe("60");
    await fill('[role="dialog"] input', "New Team"); await submit(true);
    await wait(() => expect(route()).toBe("/onboarding?next=%2Fdashboard")); expect(createBodies).toHaveLength(1); expect(createBodies[0]).toMatchObject({ workspaceName: "New Team", expectedWorkspaceId: "w1" });
    expect(container.textContent).toContain("조금 더 알려 주세요"); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("불명확한 응답은 같은 requestId/payload로만 재시도한다", async () => {
    mode = "retry"; await open(); await newModal(); await fill('[role="dialog"] input', "Retry Team"); await submit();
    await wait(() => expect(document.querySelector('[role="dialog"] [role="alert"]')).not.toBeNull());
    const persisted = sessionStorage.getItem("workspace-create:user")!; expect(persisted).not.toContain("Retry Team");
    await submit(); await wait(() => expect(route()).toBe("/onboarding?next=%2Fdashboard")); expect(createBodies).toHaveLength(2); expect(createBodies[0]).toEqual(createBodies[1]);
  });
  it("다른 탭이 선택을 바꾼 뒤 온 옛 생성 응답은 다른 WS 설문을 열지 않는다", async () => {
    mode = "switched"; await open(); await newModal(); await fill('[role="dialog"] input', "Old Result"); await submit();
    await wait(() => expect(document.querySelector('[role="dialog"]')).toBeNull()); expect(route()).toBe("/dashboard"); expect(container.textContent).not.toContain("조금 더 알려 주세요"); expect(container.textContent).toContain("Two");
  });
  it("Modal Escape는 닫고 기존 Dropdown으로 focus를 돌린다", async () => {
    await open(); await newModal(); await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement?.getAttribute("aria-label")).toBe("워크스페이스: One");
  });
});

describe("역할별 팀 DOM", () => {
  it.each(["owner", "editor", "approver", "viewer"] as Role[])("%s 에게 허용된 초대/관리 동작만 표시한다", async (role) => {
    me = persona(role); await open("/dashboard/settings/workspace");
    const allowed = role === "owner" || role === "editor"; expect(buttons("팀원 초대").length).toBe(allowed ? 1 : 0); expect(buttons("이름 저장").length).toBe(role === "owner" ? 1 : 0);
    if (role === "editor") { expect(container.textContent).toContain("own-pending@example.com"); expect(container.textContent).not.toContain("owner-pending@example.com"); }
    if (allowed) { await click("팀원 초대"); await fill('[role="dialog"] input[type="email"]', "new@example.com"); await submit(); await wait(() => expect(inviteBodies).toHaveLength(1)); expect(inviteBodies[0]).toMatchObject({ expectedWorkspaceId: "w1", role: "editor" }); }
  });
});

describe("owner 설문과 member skip DOM", () => {
  it.each(["editor", "approver", "viewer"] as Role[])("%s 는 skip만 보고 owner 완료 없이 다시 묻지 않는다", async (role) => {
    me = persona(role, null); await open("/dashboard"); expect(route()).toContain("/onboarding"); expect(container.textContent).not.toContain("팀 규모"); expect(buttons("시작하기")).toHaveLength(0);
    await click("건너뛰고 시작하기"); expect(route()).toBe("/dashboard"); expect(skipBodies).toEqual([{ expectedWorkspaceId: "w1", expectedUserId: "user" }]); expect(surveyBodies).toEqual([]); expect(me.workspace!.onboardedAt).toBeNull();
    await act(async () => root.unmount()); root = createRoot(container); await open("/dashboard"); expect(route()).toBe("/dashboard");
  });
  it("owner 설문은 원래 WS에 묶고 늦은 응답 뒤 다른 WS에 답을 재사용하지 않는다", async () => {
    me = persona("owner", null); holdSurvey = true; await open("/onboarding?next=%2Fdashboard");
    await fill('input[placeholder="예: 지인 추천, 검색, 인스타그램"]', "One private answer"); await submit(); expect(surveyBodies).toMatchObject([{ expectedWorkspaceId: "w1", source: "One private answer" }]);
    me = persona("owner", null, "w2"); await act(async () => { delayedSurvey!(Response.json({ onboardedAt: 3 })); });
    expect(route()).toContain("/onboarding"); expect(container.querySelector<HTMLInputElement>('input[placeholder="예: 지인 추천, 검색, 인스타그램"]')!.value).toBe(""); expect(surveyBodies).toHaveLength(1);
  });
});


describe("1440/390 viewport 상태", () => {
  it.each([1440, 390])("폭 %i에서 메뉴를 닫고 공통 모달을 열며 Escape focus를 보존한다", async (width) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({ matches: query.includes("599") && width < 600, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => true }));
    await open();
    if (width === 390) {
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="메뉴 열기"]')!.click());
      expect(container.querySelector("#app-sidebar")!.classList.contains("is-mobile-open")).toBe(true);
    }
    await newModal();
    expect(document.querySelector('[role="dialog"]')?.closest("#app-sidebar")).toBeNull();
    expect(container.querySelector("#app-sidebar")!.classList.contains("is-mobile-open")).toBe(false);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(width === 390 ? "메뉴 열기" : "워크스페이스: One");
  });
});

describe("늦은 상태 응답 경계", () => {
  it("오래된 me 응답이 최신 workspace 선택을 덮어쓰지 않는다", async () => {
    await open(); const original = vi.mocked(fetch).getMockImplementation()!; const old = structuredClone(me); let resolve!: (response: Response) => void, first = true;
    vi.mocked(fetch).mockImplementation((input, init) => {
      if (new URL(String(input), "https://app.test").pathname === "/api/auth/me" && first) { first = false; return new Promise<Response>((done) => { resolve = done; }); }
      return original(input, init);
    });
    await click("test refresh"); me = persona("owner", 1, "w2"); await click("test refresh");
    await act(async () => resolve(Response.json(old)));
    expect(container.textContent).toContain("Two"); expect(container.querySelector('[aria-label="워크스페이스: One"]')).toBeNull();
  });
  it("다른 사용자/역할로 갱신하면 이전 owner pending capability를 표시하지 않는다", async () => {
    await open("/dashboard/settings/workspace"); expect(container.textContent).toContain("owner-pending@example.com");
    me = { ...persona("editor"), user: { ...me.user, id: "another" } }; await click("test refresh");
    expect(container.textContent).not.toContain("owner-pending@example.com"); expect(container.textContent).toContain("own-pending@example.com"); expect(buttons("이름 저장")).toHaveLength(0);
  });
  it("생성 성공 후 me 확인이 실패해도 durable request를 버리지 않는다", async () => {
    await open(); const original = vi.mocked(fetch).getMockImplementation()!; let failRefresh = true;
    vi.mocked(fetch).mockImplementation((input, init) => {
      if (new URL(String(input), "https://app.test").pathname === "/api/auth/me" && createBodies.length > 0 && failRefresh) { failRefresh = false; return Promise.reject(new TypeError("lost refresh")); }
      return original(input, init);
    });
    await newModal(); await fill('[role="dialog"] input', "Confirmed Team"); await submit();
    await wait(() => expect(document.querySelector('[role="dialog"] [role="alert"]')).not.toBeNull());
    expect(sessionStorage.getItem("workspace-create:user")).not.toBeNull(); await submit();
    await wait(() => expect(route()).toContain("/onboarding")); expect(createBodies).toHaveLength(2); expect(createBodies[0]).toEqual(createBodies[1]);
  });
});

describe("context 취소 후 새 의도", () => {
  it("서버가 옛 intent를 확정 취소한 뒤에만 durable key를 버리고 새 화면에서 다시 만든다", async () => {
    await open(); const original = vi.mocked(fetch).getMockImplementation()!; let cancel = true;
    vi.mocked(fetch).mockImplementation((input, init) => {
      if (new URL(String(input), "https://app.test").pathname === "/api/workspaces" && cancel) {
        cancel = false; createBodies.push(JSON.parse(String(init?.body))); me = persona("owner", 1, "w2");
        return Promise.resolve(Response.json({ error: { code: "request_cancelled", message: "워크스페이스가 바뀌어 생성하지 않았어요." } }, { status: 409 }));
      }
      return original(input, init);
    });
    await newModal(); await fill('[role="dialog"] input', "Cancelled"); await submit(); await wait(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    expect(sessionStorage.getItem("workspace-create:user")).toBeNull(); expect(route()).toBe("/dashboard");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="워크스페이스: Two"]')!.click()); await click("새 워크스페이스 만들기");
    await fill('[role="dialog"] input', "Fresh"); await submit(); await wait(() => expect(route()).toContain("/onboarding"));
    expect(createBodies).toHaveLength(2); expect(createBodies[1]!.requestId).not.toBe(createBodies[0]!.requestId); expect(createBodies[1]!.expectedWorkspaceId).toBe("w2");
  });
});
