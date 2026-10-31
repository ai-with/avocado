// @vitest-environment happy-dom
import { act, createElement as h, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeT } from "../../i18n";
import type { PublicJoinChallenge } from "../../../shared/public-join";
import { JoinForm } from "./sections/JoinForm";
import { JoinChallenge } from "./sections/JoinChallenge";
import { PublicShell } from "./sections/PublicShell";
import type { TurnstileApi, TurnstileOptions } from "./turnstile";

let root: Root, container: HTMLDivElement;
let challenge: PublicJoinChallenge;
let rendered: { id: string; element: HTMLElement; options: TurnstileOptions }[];
let api: TurnstileApi, requests: { path: string; method: string; body: Record<string, unknown>; credentials?: RequestCredentials }[];
let response: () => Promise<Response>;
const SCRIPT = 'script[src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"]';
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  delete window.turnstile; document.head.querySelectorAll(SCRIPT).forEach((script) => script.remove());
  const append = document.head.append.bind(document.head);
  vi.spyOn(document.head, "append").mockImplementation((...nodes: (Node | string)[]) => {
    // 외부 script는 실행하지 않고 실제 script DOM과 수동 load/error 이벤트를 검증한다.
    for (const node of nodes) if (node instanceof HTMLScriptElement && node.src.startsWith("https://challenges.cloudflare.com/")) node.type = "text/plain";
    append(...nodes);
  });
  challenge = { siteKey: "public-site-key", action: "guide_join", cData: "a".repeat(64) };
  rendered = []; requests = [];
  api = {
    render: vi.fn((element, options) => { const id = `widget-${rendered.length + 1}`; rendered.push({ element, options, id }); return id; }),
    reset: vi.fn(), remove: vi.fn(), ready: (callback) => callback(),
  };
  response = async () => Response.json({ guideToken: "new-private-guide" }, { status: 201 });
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ path: String(input), method: init?.method ?? "GET", body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>, credentials: init?.credentials });
    return response();
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); delete window.turnstile; document.head.querySelectorAll(SCRIPT).forEach((script) => script.remove()); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Location() { const location = useLocation(); return h("output", { "data-path": true }, location.pathname + location.search); }
async function show(element: ReactNode = h(JoinForm, { slug: "shared", lang: "en", title: "QA guide", challenge })) {
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ["/g/shared?lang=en"] }, h(PublicShell, { langLabel: "한국어", onToggleLang: () => {}, children: h(Fragment, null, element, h(Location)) }))));
}
const script = () => document.head.querySelector<HTMLScriptElement>(SCRIPT)!;
async function load() { await act(async () => { window.turnstile = api; script().dispatchEvent(new Event("load")); }); }
async function solve(value = "solved-token", index = rendered.length - 1) { await act(async () => rendered[index]!.options.callback(value)); }
const submitButton = () => container.querySelector<HTMLButtonElement>('button[form="join-form"]')!;
async function submit() { await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
async function input(label: string, value: string) {
  const control = [...container.querySelectorAll<HTMLInputElement>("input")].find((item) => item.labels?.[0]?.textContent?.includes(label))!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(control, value); control.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function retry(label = "Check again") { await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === label)!.click()); }

describe("공개 가이드 참여 Turnstile 실제 React DOM", () => {
  it("키가 없으면 외부 script/가입요청 없이 준비중 상태와 잠긴 제출 버튼을 표시한다", async () => {
    challenge = { ...challenge, siteKey: null };
    await show();
    expect(container.textContent).toContain("Participation is not available yet");
    expect(script()).toBeNull(); expect(submitButton().disabled).toBe(true);
    await submit(); expect(requests).toHaveLength(0);
  });

  it("공식 script를 직접 explicit 로드하고 모바일용 flexible·언어·guide cData로 그린다", async () => {
    vi.stubGlobal("innerWidth", 390);
    await show();
    expect(document.head.querySelectorAll(SCRIPT)).toHaveLength(1);
    expect(script().async).toBe(true); expect(script().defer).toBe(true);
    expect(submitButton().disabled).toBe(true);
    await load();
    expect(rendered[0]!.options).toMatchObject({ sitekey: "public-site-key", action: "guide_join", cData: "a".repeat(64), language: "en", size: "flexible", "response-field": false, retry: "never" });
    expect(rendered[0]!.element.className).toBe("pub-turnstile");
    expect(requests).toHaveLength(0);
  });

  it("동시에 두 위젯이 필요해도 script는 하나만 로드한다", async () => {
    const onToken = vi.fn(), t = makeT("en");
    await show(h("div", null, h(JoinChallenge, { challenge, lang: "en", scope: "one", t, onToken }), h(JoinChallenge, { challenge, lang: "en", scope: "two", t, onToken })));
    expect(document.head.querySelectorAll(SCRIPT)).toHaveLength(1);
    await load(); expect(rendered).toHaveLength(2);
  });

  it("성공 token 후에만 POST하며 중복 submit을 막고 개인 링크에 언어를 보존한다", async () => {
    let finish!: (value: Response) => void; response = () => new Promise((resolve) => { finish = resolve; });
    await show(); await load();
    await input("Name", "QA Creator"); await input("Email", "qa@example.invalid");
    await submit(); expect(requests).toHaveLength(0);
    await solve(); expect(submitButton().disabled).toBe(false);
    await act(async () => { const form = container.querySelector("form")!; form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(requests).toHaveLength(1); expect(submitButton().disabled).toBe(true);
    expect(requests[0]).toMatchObject({ path: "/api/public/guide/shared/join", method: "POST", credentials: "same-origin", body: { displayName: "QA Creator", email: "qa@example.invalid", lang: "en", turnstileToken: "solved-token" } });
    await act(async () => finish(Response.json({ guideToken: "new-private-guide" }, { status: 201 })));
    expect(container.querySelector("output")?.textContent).toBe("/g/new-private-guide?lang=en");
  });

  it("token 만료·provider 오류는 제출을 잠그고 수동 reset 뒤 새 token을 요구한다", async () => {
    await show(); await load(); await solve();
    await act(async () => rendered[0]!.options["expired-callback"]());
    expect(container.textContent).toContain("security check expired"); expect(submitButton().disabled).toBe(true);
    await retry(); expect(api.reset).toHaveBeenCalledWith("widget-1");
    expect(submitButton().disabled).toBe(true); await solve("fresh-token"); expect(submitButton().disabled).toBe(false);
    await act(async () => rendered[0]!.options["error-callback"]());
    expect(container.textContent).toContain("could not complete the security check"); expect(submitButton().disabled).toBe(true);
  });

  it("script 실패를 정리하고 명시적 재시도에서 다시 로드한다", async () => {
    await show(); const failed = script();
    await act(async () => failed.dispatchEvent(new Event("error")));
    expect(script()).toBeNull(); expect(submitButton().disabled).toBe(true);
    await retry(); expect(script()).not.toBeNull(); expect(script()).not.toBe(failed);
    await load(); await solve(); expect(submitButton().disabled).toBe(false);
  });

  it("script 준비가 멈춰도 15초 뒤 오류와 재시도 경로를 표시한다", async () => {
    vi.useFakeTimers(); await show();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_001); });
    expect(script()).toBeNull(); expect(container.textContent).toContain("could not complete the security check");
    expect(submitButton().disabled).toBe(true);
  });

  it("API 제한과 일반 실패를 현재 언어로 알리고 소비된 token·늦은 위젯 callback을 재사용하지 않는다", async () => {
    response = async () => Response.json({ error: { code: "join_rate_limited", message: "원문 provider 상세", fields: { _: "private-token" } } }, { status: 429 });
    await show(); await load(); await solve(); const old = rendered[0]!;
    await submit();
    expect(container.textContent).toContain("too many requests"); expect(container.textContent).not.toMatch(/private-token|provider 상세/);
    expect(api.remove).toHaveBeenCalledWith(old.id); expect(rendered).toHaveLength(2); expect(submitButton().disabled).toBe(true);
    await solve("late-old-token", 0); await submit(); expect(requests).toHaveLength(1);
    await solve("new-token"); expect(submitButton().disabled).toBe(false);
  });

  it("slug 변경 뒤 옛 응답·위젯 callback은 새 가이드로 이동하거나 제출을 활성화하지 않는다", async () => {
    let finish!: (value: Response) => void; response = () => new Promise((resolve) => { finish = resolve; });
    await show(); await load(); await solve(); await submit();
    await show(h(JoinForm, { slug: "second", lang: "ko", title: "다른 가이드", challenge: { ...challenge, cData: "b".repeat(64) } }));
    expect(container.textContent).toContain("다른 가이드"); expect(submitButton().disabled).toBe(true);
    await solve("late-first-token", 0); expect(submitButton().disabled).toBe(true);
    await act(async () => finish(Response.json({ guideToken: "old-private-link" }, { status: 201 })));
    expect(container.querySelector("output")?.textContent).toBe("/g/shared?lang=en");
    expect(submitButton().disabled).toBe(true);
  });

  it("로드 중 unmount와 이미 그린 위젯 unmount 뒤 늦은 callback을 무시한다", async () => {
    const onToken = vi.fn();
    await show(h(JoinChallenge, { challenge, lang: "en", scope: "first", t: makeT("en"), onToken }));
    await show(h("p", null, "gone")); await load(); expect(rendered).toHaveLength(0);
    await show(h(JoinChallenge, { challenge, lang: "ko", scope: "second", t: makeT("ko"), onToken }));
    expect(rendered).toHaveLength(1); const before = onToken.mock.calls.length;
    await show(h("p", null, "gone"));
    await act(async () => rendered[0]!.options.callback("late-private-token"));
    expect(onToken).toHaveBeenCalledTimes(before); expect(api.remove).toHaveBeenCalledWith("widget-1");
  });

  it.each(["ko", "en"] as const)("%s 일반 API 오류를 공급자 원문 없이 표시한다", async (lang) => {
    response = async () => Response.json({ error: { code: "internal_error", message: "secret-provider-response" } }, { status: 500 });
    await show(h(JoinForm, { slug: "shared", lang, title: "QA", challenge })); await load(); await solve(); await submit();
    expect(container.textContent).toContain(lang === "ko" ? "신청을 마치지 못했어요" : "We could not complete your request");
    expect(container.textContent).not.toContain("secret-provider-response"); expect(submitButton().disabled).toBe(true);
  });

  it("언어 변경은 위젯을 교체하고 옛 언어 콜백이나 비정상 token으로 제출하지 않는다", async () => {
    await show(); await load(); await solve();
    await show(h(JoinForm, { slug: "shared", lang: "ko", title: "QA", challenge }));
    expect(api.remove).toHaveBeenCalledWith("widget-1"); expect(rendered[1]!.options.language).toBe("ko");
    await solve("late-token", 0); expect(submitButton().disabled).toBe(true);
    await solve("x".repeat(2049)); expect(submitButton().disabled).toBe(true);
    await submit(); expect(requests).toHaveLength(0);
    await solve("new-ko-token"); await submit(); expect(requests[0]?.body.lang).toBe("ko");
  });

  it.each(["success", "failure"])("POST 대기 중 언어를 바꾸어도 %s 응답을 최신 언어로 마무리하고 중복 신청하지 않는다", async (outcome) => {
    let finish!: (value: Response) => void; response = () => new Promise((resolve) => { finish = resolve; });
    await show(h(JoinForm, { slug: "shared", lang: "ko", title: "QA", challenge })); await load(); await solve(); await submit();
    expect(requests).toHaveLength(1); expect(requests[0]!.body.lang).toBe("ko");
    await show(h(JoinForm, { slug: "shared", lang: "en", title: "QA", challenge }));
    await submit(); expect(requests).toHaveLength(1);
    await act(async () => finish(outcome === "success" ? Response.json({ guideToken: "completed-private-guide" }, { status: 201 }) : Response.json({ error: { code: "join_rate_limited", message: "요청이 많아요" } }, { status: 429 })));
    if (outcome === "success") expect(container.querySelector("output")?.textContent).toBe("/g/completed-private-guide?lang=en");
    else {
      expect(container.textContent).toContain("too many requests"); expect(container.textContent).not.toContain("잠시 요청이 많아요");
      await solve("fresh-after-failure"); expect(submitButton().disabled).toBe(false);
    }
    expect(requests).toHaveLength(1);
  });

  it("설정이 바뀌면 옛 가입 응답을 버리고 새 확인 뒤 busy가 남지 않는다", async () => {
    let finish!: (value: Response) => void; response = () => new Promise((resolve) => { finish = resolve; });
    await show(); await load(); await solve(); await submit();
    await show(h(JoinForm, { slug: "shared", lang: "en", title: "QA", challenge: { ...challenge, siteKey: "replacement-site-key" } }));
    await act(async () => finish(Response.json({ guideToken: "old-settings-private" }, { status: 201 })));
    expect(container.querySelector("output")?.textContent).toBe("/g/shared?lang=en");
    await solve("new-settings-token"); expect(submitButton().disabled).toBe(false);
    expect(requests).toHaveLength(1);
  });
});
