// @vitest-environment happy-dom
import { act, createElement as h, Fragment, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnsubscribePage } from "./UnsubscribePage";

let root: Root, container: HTMLDivElement;
let requests: { path: string; method: string }[];
let respond: (method: string, token: string) => Promise<Response>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); requests = [];
  respond = async (method, token) => Response.json(method === "GET" ? { workspaceName: token === "one" ? "첫 브랜드" : "두 번째 브랜드" } : { ok: true });
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input), method = init?.method ?? "GET"; requests.push({ path, method });
    return respond(method, decodeURIComponent(path.split("/").at(-1)!));
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function NavigateToken() { const navigate = useNavigate(); return h("button", { "data-test-navigate": true, onClick: () => navigate("/unsubscribe/two") }, "다른 링크"); }
async function open() { await act(async () => root.render(h(StrictMode, null, h(MemoryRouter, { initialEntries: ["/unsubscribe/one"] }, h(Fragment, null,
  h(NavigateToken), h(Routes, null, h(Route, { path: "/unsubscribe/:token", element: h(UnsubscribePage) })),
))))); }
const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === text);
async function click(text: string) { await act(async () => { const control = button(text); expect(control).toBeDefined(); control!.click(); }); }
async function wait(check: () => void) { await vi.waitFor(async () => { await act(async () => {}); check(); }); }

describe("공개 수신 거부 브랜드 React DOM", () => {
  it("토큰 이름을 확인·완료 화면에 표시하고 명시 클릭 전에는 GET만 한다", async () => {
    await open(); expect(container.querySelector(".visitor-brand")?.textContent).toBe("첫 브랜드");
    expect(requests.length).toBeGreaterThan(0); expect(requests.every((request) => request.method === "GET" && request.path === "/api/public/unsubscribe/one")).toBe(true);
    expect(container.textContent).toContain("메시지 수신을 그만할까요?"); await click("수신 거부");
    expect(container.querySelector(".visitor-brand")?.textContent).toBe("첫 브랜드"); expect(container.textContent).toContain("수신 거부했어요");
    expect(requests.filter((request) => request.method === "POST")).toEqual([{ method: "POST", path: "/api/public/unsubscribe/one" }]);
  });
  it("브랜드의 HTML은 실행 가능한 DOM 대신 텍스트로만 렌더한다", async () => {
    const name = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    respond = async () => Response.json({ workspaceName: name }); await open();
    expect(container.querySelector(".visitor-brand")?.textContent).toBe(name); expect(container.querySelector(".visitor img, .visitor script")).toBeNull();
  });
  it("조회 중에는 브랜드/거부버튼을 표시하지 않고 실패 후 다시 조회한다", async () => {
    const pending: ((response: Response) => void)[] = []; respond = () => new Promise((resolve) => pending.push(resolve)); await open();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("브랜드를 불러오는 중이에요"); expect(button("수신 거부")).toBeUndefined();
    await act(async () => pending.forEach((resolve) => resolve(Response.json({ error: { code: "not_found", message: "수신 거부 링크를 찾을 수 없어요." } }, { status: 404 }))));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("수신 거부 링크를 찾을 수 없어요."); expect(container.querySelector(".visitor-brand")).toBeNull(); expect(button("수신 거부")).toBeUndefined();
    respond = async () => Response.json({ workspaceName: "다시 확인한 브랜드" }); await click("다시 불러오기");
    expect(container.querySelector(".visitor-brand")?.textContent).toBe("다시 확인한 브랜드"); expect(requests.every((request) => request.method === "GET")).toBe(true);
  });
  it("malformed200은 빈 브랜드의 정상 거부 화면으로 취급하지 않는다", async () => {
    respond = async () => Response.json({ workspaceName: { private: "invalid" } }); await open();
    expect(container.querySelector('[role="alert"]')).not.toBeNull(); expect(container.querySelector(".visitor-brand")).toBeNull(); expect(button("수신 거부")).toBeUndefined();
  });
  it("중복 클릭은 한 POST만 시작하고 실패해도 같은 브랜드에 재시도한다", async () => {
    const fallback = respond; let finish!: (response: Response) => void;
    respond = (method, token) => method === "POST" ? new Promise((resolve) => { finish = resolve; }) : fallback(method, token);
    await open(); await act(async () => { button("수신 거부")!.click(); button("수신 거부")!.click(); });
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(1); expect(button("수신 거부")!.disabled).toBe(true);
    await act(async () => finish(Response.json({ error: { message: "잠시 후 다시 시도해 주세요." } }, { status: 503 })));
    expect(container.querySelector(".visitor-brand")?.textContent).toBe("첫 브랜드"); expect(container.querySelector('[role="alert"]')?.textContent).toBe("잠시 후 다시 시도해 주세요.");
    respond = fallback; await click("수신 거부"); expect(container.textContent).toContain("수신 거부했어요"); expect(requests.filter((request) => request.method === "POST")).toHaveLength(2);
  });
  it("토큰 이동 뒤 늦은 옛 GET은 다른 브랜드를 덮어쓰지 않는다", async () => {
    const old: ((response: Response) => void)[] = []; const fallback = respond;
    respond = (method, token) => token === "one" ? new Promise((resolve) => old.push(resolve)) : fallback(method, token);
    await open(); await click("다른 링크"); expect(container.querySelector(".visitor-brand")?.textContent).toBe("두 번째 브랜드");
    await act(async () => old.forEach((resolve) => resolve(Response.json({ workspaceName: "노출하면 안 되는 옛 브랜드" }))));
    expect(container.querySelector(".visitor-brand")?.textContent).toBe("두 번째 브랜드"); expect(container.textContent).not.toContain("옛 브랜드");
  });
  it("토큰 이동은 이전 브랜드/거부 완료 상태를 버리고 늦은 옛 POST도 적용하지 않는다", async () => {
    const fallback = respond; let finish!: (response: Response) => void, second!: (response: Response) => void;
    respond = (method, token) => method === "POST" ? new Promise((resolve) => { finish = resolve; }) : token === "two" ? new Promise((resolve) => { second = resolve; }) : fallback(method, token);
    await open(); await click("수신 거부"); await click("다른 링크");
    expect(container.querySelector(".visitor-brand")).toBeNull(); expect(button("수신 거부")).toBeUndefined();
    await act(async () => { finish(Response.json({ ok: true })); second(Response.json({ workspaceName: "두 번째 브랜드" })); });
    await wait(() => expect(container.querySelector(".visitor-brand")?.textContent).toBe("두 번째 브랜드"));
    expect(container.textContent).toContain("메시지 수신을 그만할까요?"); expect(container.textContent).not.toContain("수신 거부했어요");
  });
});
