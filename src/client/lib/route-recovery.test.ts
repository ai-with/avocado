import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router-dom";
import { createPageRecovery, isChunkLoadFailure } from "./route-recovery";
import { RouteErrorPage, RouteErrorView } from "../pages/RouteError";

describe("explicit route recovery without browser side effects", () => {
  it.each([
    "Failed to fetch dynamically imported module: https://private.test/assets/Page.js?private=secret",
    "error loading dynamically imported module: https://private.test/assets/Page.js",
    "Importing a module script failed.", "Loading chunk 123 failed.",
  ])("recognizes a module-load failure without exposing its URL: %s", (message) => {
    expect(isChunkLoadFailure(new TypeError(message))).toBe(true);
  });
  it("does not classify API/render/abort errors or arbitrary objects as a stale module", () => {
    for (const error of [new Error("private body"), new TypeError("Failed to fetch"), new DOMException("cancelled", "AbortError"), "Failed to fetch dynamically imported module", { message: "private" }, null]) expect(isChunkLoadFailure(error)).toBe(false);
    const named = new Error("private asset URL"); named.name = "ChunkLoadError"; expect(isChunkLoadFailure(named)).toBe(true);
    const hostile = new Error(); Object.defineProperty(hostile, "message", { get() { throw new Error("PRIVATE getter"); } }); expect(isChunkLoadFailure(hostile)).toBe(false);
  });
  it("never reloads automatically and each explicit action calls reload once without locking after a native cancellation", () => {
    const reload = vi.fn(); // A cancelled native unload leaves this document mounted.
    const action = createPageRecovery({ reload });
    expect(reload).not.toHaveBeenCalled();
    expect(action.reopen()).toBe(true); expect(reload).toHaveBeenCalledOnce();
    expect(action.reopen()).toBe(true); expect(reload).toHaveBeenCalledTimes(2);
  });
  it("SSR has no browser and cannot initiate recovery; action errors remain private", () => {
    expect(createPageRecovery(null).reopen()).toBe(false);
    const reload = vi.fn().mockImplementationOnce(() => { throw new Error("PRIVATE COOKIE URL STACK"); }).mockImplementation(() => {});
    const action = createPageRecovery({ reload });
    expect(action.reopen()).toBe(false); expect(action.reopen()).toBe(true); expect(reload).toHaveBeenCalledTimes(2);
    for (const chunk of [true, false]) {
      const html = renderToStaticMarkup(createElement(RouteErrorView, { chunk, available: false, failed: false, onReopen: () => { throw new Error("must not run on SSR"); } }));
      expect(html).toContain("홈으로 가기"); expect(html).not.toMatch(/PRIVATE|STACK|https:\/\/|Unexpected Application Error|developer/);
    }
  });
  it("the actual route error element renders on SSR without window or serialized private errors", async () => {
    const handler = createStaticHandler([{ path: "/invite/:token", errorElement: createElement(RouteErrorPage), loader: () => { throw new TypeError("Failed to fetch dynamically imported module: https://private.test/PRIVATE-TOKEN.js"); } }]);
    const context = await handler.query(new Request("https://app.test/invite/PRIVATE-TOKEN"));
    if (context instanceof Response) throw new Error("unexpected local redirect");
    const router = createStaticRouter(handler.dataRoutes, context);
    const html = renderToStaticMarkup(createElement(StaticRouterProvider, { router, context, hydrate: false }));
    expect(html).toContain("화면을 불러오지 못했어요"); expect(html).toContain("disabled");
    expect(html).not.toMatch(/PRIVATE|private.test|__staticRouterHydrationData|Unexpected Application Error/);
  });
});
