// @vitest-environment happy-dom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../ui";
import { SiteAlertModal } from "./sections/SiteAlertModal";
import { SiteCard } from "./sections/SiteCard";
import type { SiteAlertStatus } from "../../../shared/site-alerts";
import { DEFAULT_SITE_ALERT_POLICY } from "../../../shared/site-alerts";
import type { Site } from "./api";

let root: Root, container: HTMLDivElement, status: SiteAlertStatus;
let posts: { body: Record<string, unknown>; headers: Headers }[], pending: Promise<Response> | null, conflict: boolean;
const site: Site = { id: "s", name: "QA", domains: ["qa.invalid"], siteKey: "public-key", consentMode: "require", collectRawEmail: false, currency: "KRW", attributionDays: 7, firstEventAt: 1, createdAt: 1, snippet: "<script>QA</script>", summary: { sessions: 1, pageviews: 5, conversions: 2, conversionValue: 0, conversionValueConverted: 0, conversionValuePending: 0 } };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); posts = []; pending = null; conflict = false;
  status = { policy: { ...DEFAULT_SITE_ALERT_POLICY }, generation: "config-a", subscriptionGeneration: "sub-a", subscribed: false, eligible: true, canEdit: true, mailConfigured: false, csrfToken: "session-csrf", cooldownUntil: null, email: "own@qa.invalid", lastCheck: null, lastMail: null };
  vi.stubGlobal("fetch", vi.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>; posts.push({ body, headers: new Headers(init.headers) });
      if (conflict) { conflict = false; status = { ...status, generation: "config-new", policy: { ...status.policy, minimumAverage: 333 } }; return Response.json({ error: { code: "alert_changed", message: "설정이 바뀌었어요." } }, { status: 409 }); }
      if (pending) return pending;
      status = { ...status, ...(body.settings ? { policy: body.settings as SiteAlertStatus["policy"] } : {}), subscribed: !!body.subscribed }; return Response.json({ ok: true });
    }
    return Response.json(status);
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function show(element: ReactNode = h(SiteAlertModal, { siteId: "s", name: "QA", onClose: () => {} })) { await act(async () => root.render(h(MemoryRouter, null, h(ToastProvider, null, element)))); }
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === label)!;
const checkbox = (label: string) => [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((item) => item.labels?.[0]?.textContent?.includes(label))!;
const input = (label: string) => [...container.querySelectorAll<HTMLInputElement>('input[type="text"]')].find((item) => item.labels?.[0]?.textContent?.includes(label))!;
async function submit() { await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
async function fill(label: string, value: string) { await act(async () => { const node = input(label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); }); }

describe("사이트 급감 알림 실제 React DOM", () => {
  it("사이트 카드 수치를 보존하고 설정을 열기 전에는 추가 API를 호출하지 않는다", async () => {
    await show(h(SiteCard, { site, onEdit: () => {}, onRotate: () => {}, onRemove: () => {} }));
    expect(fetch).not.toHaveBeenCalled(); expect(container.textContent).toContain("최근 7일 세션"); expect(container.textContent).not.toContain("ECB");
    await act(async () => button("급감 알림").click()); expect(fetch).toHaveBeenCalledOnce(); expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });
  it("기본 off와 명시 기준·내 이메일을 보여주며 미설정 메일을 성공으로 표시하지 않는다", async () => {
    await show(); expect(checkbox("감지 사용").checked).toBe(false); expect(checkbox("내 계정").checked).toBe(false);
    expect(input("이 비율").value).toBe("20"); expect(input("최소 일평균").value).toBe("100");
    for (const text of ["80% 이상 감소", "완료된 2일", "그전 7일 평균", "전주 같은 요일", "09:00 KST", "7일에 한 번", "own@qa.invalid", "준비 전에는 메일을 보내지 않아요"]) expect(container.textContent).toContain(text);
    expect(container.querySelector('input[type="email"]')).toBeNull(); expect(posts).toHaveLength(0);
    await submit(); expect(container.textContent).toContain("설정을 저장했어요. 메일 준비 전에는 발송하지 않아요."); expect(container.textContent).not.toContain("메일을 보냈");
    expect(posts[0]).toMatchObject({ body: { subscribed: false, expectedGeneration: "config-a", expectedSubscriptionGeneration: "sub-a" } }); expect(posts[0]!.headers.get("X-CSRF-Token")).toBe("session-csrf");
  });
  it("지표 변경은 기본 표본을 10전환으로 바꾸고 비율·표본·기간을 조정해 보낸다", async () => {
    await show(); const metric = [...container.querySelectorAll<HTMLButtonElement>('[role="combobox"]')].find((item) => item.textContent?.includes("페이지뷰"))!;
    await act(async () => metric.click()); await act(async () => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent === "전환 수")!.click());
    expect(input("최소 일평균").value).toBe("10"); await fill("이 비율", "30"); await fill("최소 일평균", "25");
    await act(async () => { checkbox("감지 사용").click(); checkbox("내 계정").click(); }); await submit();
    expect(posts[0]!.body).toMatchObject({ settings: { enabled: true, metric: "conversions", ratioPercent: 30, minimumAverage: 25, confirmationDays: 2 }, subscribed: true });
  });
  it("검증 범위를 벗어나면 요청을 막고 중복 submit도 한 건으로 제한한다", async () => {
    await show(); await fill("이 비율", "91"); await submit(); expect(posts).toHaveLength(0); expect(container.querySelector('[role="alert"]')?.textContent).toContain("0~90%");
    await fill("이 비율", "20"); let resolve!: (response: Response) => void; pending = new Promise((done) => { resolve = done; });
    await act(async () => { const form = container.querySelector("form")!; form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(posts).toHaveLength(1); expect(button("알림 설정 저장").disabled).toBe(true); await act(async () => resolve(Response.json({ ok: true })));
  });
  it("보기 권한은 다른 수신자를 지정하거나 다시 켤 수 없고 자기 구독만 해제한다", async () => {
    status = { ...status, canEdit: false, eligible: false, subscribed: true }; await show();
    expect(checkbox("감지 사용").disabled).toBe(true); await act(async () => checkbox("내 계정").click()); expect(checkbox("내 계정").disabled).toBe(true); await submit();
    expect(posts[0]!.body).not.toHaveProperty("settings"); expect(posts[0]!.body).toMatchObject({ subscribed: false }); expect(posts[0]!.body).not.toHaveProperty("userId");
  });
  it("다른 탭의 설정 변경은 최신 상태를 다시 보여주고 과거 세대로 덮어쓰지 않는다", async () => {
    await show(); conflict = true; await submit(); expect(input("최소 일평균").value).toBe("333"); expect(container.querySelector('[role="alert"]')?.textContent).toContain("바뀌었어요");
    await submit(); expect(posts[1]!.body.expectedGeneration).toBe("config-new");
  });
  it("결과 미확인과 회복 취소를 성공 발송으로 표시하지 않는다", async () => {
    status = { ...status, lastMail: { status: "unknown", errorCode: "delivery_expired", at: 1 } }; await show(); expect(container.textContent).toContain("결과 미확인 · 자동 재전송 중단");
    status = { ...status, lastMail: { status: "cancelled", errorCode: "recovered", at: 1 } }; await act(async () => root.unmount()); root = createRoot(container); await show(); expect(container.textContent).toContain("최신 집계가 회복되어 보내지 않았어요");
  });
  it("사이트가 바뀐 뒤 늦은 설정 응답과 unmount 응답은 새 화면에 적용하지 않는다", async () => {
    let finish!: (response: Response) => void; vi.mocked(fetch).mockImplementationOnce(() => new Promise((done) => { finish = done; })); await show();
    status = { ...status, email: "new@qa.invalid" }; await show(h(SiteAlertModal, { siteId: "new", name: "New", onClose: () => {} }));
    await act(async () => finish(Response.json({ ...status, email: "stale@qa.invalid" }))); expect(container.textContent).toContain("new@qa.invalid"); expect(container.textContent).not.toContain("stale@qa.invalid");
  });
});
