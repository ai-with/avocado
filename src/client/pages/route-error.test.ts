// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeTree, router as browserRouter } from "../routes";
import { RouteErrorPage } from "./RouteError";

let me: unknown = null;
vi.mock("../lib/me", () => ({ useMe: () => ({ me, loading: false, refresh: async () => me }) }));
let root: Root, container: HTMLDivElement, active: ReturnType<typeof createMemoryRouter> | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); me = null;
  Object.defineProperty(window, "confirm", { configurable: true, writable: true, value: vi.fn(() => false) });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === "/api/auth/config") return Response.json({ google: false });
    if (path === "/api/notifications") return Response.json({ items: [], unread: 0 });
    throw new Error("unexpected local API");
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); active?.dispose(); active = undefined; container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(() => browserRouter.dispose());
async function show(routes: RouteObject[], path: string) {
  await act(async () => { active = createMemoryRouter(routes, { initialEntries: [path] }); root.render(h(RouterProvider, { router: active })); });
}
function button(label: string) { return [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label)!; }

describe("entry-bundle route error boundary", () => {
  it("wraps all existing public/protected/legacy routes eagerly without changing their paths", () => {
    expect(routeTree).toHaveLength(1); expect(routeTree[0]?.path).toBeUndefined(); expect(routeTree[0]?.lazy).toBeUndefined();
    expect((routeTree[0]?.errorElement as { type: unknown }).type).toBe(RouteErrorPage);
    const children = routeTree[0]!.children!;
    expect(children.some((r) => r.path === "/invite/:token")).toBe(true); expect(children.some((r) => r.path === "/verify-phone")).toBe(true);
    expect(children.find((r) => r.path === "/dashboard")?.children?.some((r) => r.path === "keyword-dm")).toBe(true);
    expect(children.some((r) => r.path === "/keyword-dm")).toBe(true); expect(children.some((r) => r.path === "*")).toBe(true);
  });
  it.each(["/dashboard/keyword-dm", "/invite/PRIVATE-TOKEN"])('lazy chunk rejection at %s stays private and never reloads on render', async (path) => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false), reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    const error = new TypeError("Failed to fetch dynamically imported module: https://private.test/assets/Page.js?PRIVATE-TOKEN=1");
    error.stack = "PRIVATE-STACK";
    await show([{ errorElement: routeTree[0]!.errorElement, children: [{ path, lazy: async () => { throw error; } }] }], path);
    expect(container.textContent).toContain("화면을 불러오지 못했어요"); expect(container.textContent).not.toMatch(/PRIVATE|private.test|Unexpected Application Error|developer|stack/i);
    expect(confirm).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled();
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/dashboard");
    await act(async () => button("페이지 다시 열기").click()); expect(confirm).not.toHaveBeenCalled(); expect(reload).toHaveBeenCalledOnce();
    // Browser-native cancellation must leave the explicit action usable.
    expect(button("페이지 다시 열기").disabled).toBe(false);
    await act(async () => button("페이지 다시 열기").click()); expect(reload).toHaveBeenCalledTimes(2); expect(confirm).not.toHaveBeenCalled();
  });
  it("non-chunk render failure shows a generic error without error/response content", async () => {
    function Broken(): never { throw new Error("PRIVATE-FORM PRIVATE-URL PRIVATE-STACK"); }
    await show([{ errorElement: routeTree[0]!.errorElement, children: [{ path: "/broken", element: h(Broken) }] }], "/broken");
    expect(container.textContent).toContain("페이지를 표시하지 못했어요"); expect(container.textContent).not.toMatch(/PRIVATE|Unexpected Application Error|ErrorBoundary/);
    await act(async () => active!.navigate("/missing"));
    expect(container.textContent).toContain("홈으로 가기"); expect(container.textContent).not.toContain("PRIVATE");
  });
  it("cancelled loading is generic and a later normal navigation can recover without reload", async () => {
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    await show([{ errorElement: routeTree[0]!.errorElement, children: [
      { path: "/cancelled", lazy: async () => { throw new DOMException("PRIVATE abort", "AbortError"); } },
      { path: "/healthy", element: h("p", null, "정상 화면") },
    ] }], "/cancelled");
    expect(container.textContent).toContain("페이지를 표시하지 못했어요");
    await act(async () => active!.navigate("/healthy")); expect(container.textContent).toBe("정상 화면"); expect(reload).not.toHaveBeenCalled();
  });
  it("route response bodies and status details never become the visible error message", async () => {
    await show([{ errorElement: routeTree[0]!.errorElement, children: [{ path: "/response", loader: () => { throw new Response("PRIVATE-RESPONSE https://private.test/invite/TOKEN", { status: 500, statusText: "PRIVATE-STATUS" }); } }] }], "/response");
    expect(container.textContent).toContain("페이지를 표시하지 못했어요"); expect(container.textContent).not.toMatch(/PRIVATE|private.test|TOKEN|500/);
  });
  it("normal protected navigation still requires login and preserves next", async () => {
    await show(routeTree, "/dashboard/referral");
    expect(active!.state.location.pathname).toBe("/login"); expect(new URLSearchParams(active!.state.location.search).get("next")).toBe("/dashboard/referral");
    expect(container.textContent).toContain("로그인");
  });
});
