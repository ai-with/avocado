// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LandingHeader } from "./sections/Header";
import { Showcase } from "./sections/Showcase";
import { SHOWCASE } from "./showcase";

let signedIn: boolean, root: Root, container: HTMLDivElement;
vi.mock("../../lib/me", () => ({ useMe: () => ({ me: signedIn ? { user: { id: "fake-user" }, workspace: { id: "fake-workspace" } } : null }) }));
beforeEach(() => {
  signedIn = false; window.location.hash = "";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No HTTP in landing anchor DOM regression"); }));
  // Keep real media/codec operations out of this test. Reduced motion also
  // disables the in-view autoplay observer in the real Showcase component.
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => { throw new Error("No media playback"); });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => { throw new Error("No media loading"); });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); window.location.hash = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function show() { await act(async () => root.render(h(MemoryRouter, null, h("div", null, h(LandingHeader), h(Showcase))))); }
const navigation = () => container.querySelector<HTMLElement>('nav[aria-label="섹션"]')!;
const introduction = () => [...navigation().querySelectorAll<HTMLAnchorElement>("a")].find((a) => a.textContent === "이렇게 씁니다")!;

describe("landing introduction anchor DOM contract", () => {
  it("links to the one real showcase section and preserves the existing anchors in order", async () => {
    await show(); const links = [...navigation().querySelectorAll<HTMLAnchorElement>("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["#showcase", "#features", "#process", "#faq"]);
    expect(links.slice(1).map((a) => a.textContent)).toEqual(["기능", "진행 방식", "FAQ"]);
    expect(introduction().getAttribute("href")).toBe(`#${SHOWCASE.id}`); expect(container.querySelectorAll(`#${SHOWCASE.id}`)).toHaveLength(1);
    expect(container.querySelector(`#${SHOWCASE.id}`)?.querySelectorAll("video")).toHaveLength(SHOWCASE.videos.length);
  });
  it.each([false, true])("keeps authenticated=%s CTA routes and fragment navigation independent", async (auth) => {
    signedIn = auth; await show(); const actions = container.querySelector(".landing-header-actions")!;
    expect([...actions.querySelectorAll("a")].map((a) => [a.getAttribute("href"), a.textContent])).toEqual(auth ? [["/dashboard", "대시보드로 가기"]] : [["/login", "로그인"], ["/signup", "시작하기"]]);
    await act(async () => introduction().click()); expect(window.location.hash).toBe("#showcase");
    expect([...actions.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(auth ? ["/dashboard"] : ["/login", "/signup"]);
    expect(fetch).not.toHaveBeenCalled(); expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled(); expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
  });
  it("uses native focusable links without cancelling keyboard activation or trapping focus", async () => {
    await show(); const link = introduction(); link.focus(); expect(document.activeElement).toBe(link); expect(link.tabIndex).toBe(0); expect(link.getAttribute("role")).toBeNull();
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }); expect(link.dispatchEvent(enter)).toBe(true); expect(enter.defaultPrevented).toBe(false);
    // happy-dom does not synthesize a trusted keyboard default action. Invoke
    // that native anchor action explicitly, then verify its hash destination.
    await act(async () => link.click()); expect(window.location.hash).toBe("#showcase");
    const next = navigation().querySelector<HTMLAnchorElement>('a[href="#features"]')!; next.focus(); expect(document.activeElement).toBe(next); expect(next.tabIndex).toBe(0);
  });
});
