// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../ui";
import { BroadcastEditor } from "./BroadcastEditor";
import type { Broadcast } from "./broadcast-model";

vi.mock("../../lib/me", () => ({ useMe: () => ({ me: { workspace: { id: "w" }, user: { id: "u", name: "QA" }, role: "owner" } }) }));
let root: Root, container: HTMLDivElement, requests: URL[], draft: Broadcast;
let countResponse: () => Promise<Response>, missing: boolean, configured: boolean, postLost: boolean, currentWorkspace: string;
let sendBodies: unknown[], mutationHeaders: Headers[];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); requests = []; missing = false; configured = true; postLost = false; currentWorkspace = "w"; sendBodies = []; mutationHeaders = [];
  draft = { id: "b", generation: "gen", name: "QA", status: "draft", scheduledAt: null, sentAt: null, updatedAt: 1, stats: null, channel: "email", kind: "info", audience: { groupIds: ["chosen-g"], tagIds: ["chosen-t"] }, template: { subject: "QA", preview: "", body: "QA only", buttonLabel: "", buttonUrl: "" } };
  countResponse = async () => Response.json({ total: 3, eligible: 3, reasons: {} });
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input), "https://app.test"); requests.push(url);
    if (url.pathname === "/api/messaging/settings") return Response.json({ workspaceId: currentWorkspace, senderConfigured: true, sendPolicy: { configured, message: "발송 기준을 준비하고 있어요. 실제 발송은 아직 사용할 수 없어요." }, csrfToken: "local" });
    if (url.pathname === "/api/leads/groups/selected") return Response.json({ groups: missing ? [] : [{ id: "chosen-g", name: "선택한 그룹", count: 3 }] });
    if (url.pathname === "/api/leads/groups") return Response.json({ groups: url.searchParams.has("cursor") ? [{ id: "g2", name: "다음 그룹", count: 1 }] : [{ id: "g1", name: "첫 그룹", count: 1 }], nextCursor: url.searchParams.has("cursor") ? null : "group-next" });
    if (url.pathname === "/api/leads/lookups") return Response.json({ items: url.searchParams.has("selected") ? [{ id: "chosen-t", name: "선택한 태그" }] : url.searchParams.has("cursor") ? [{ id: "t2", name: "다음 태그" }] : [{ id: "t1", name: "첫 태그" }], nextCursor: url.searchParams.has("cursor") ? null : "tag-next" });
    if (url.pathname === "/api/broadcasts/audience") return countResponse();
    if (url.pathname === "/api/broadcasts/b" && init?.method === "PATCH") { mutationHeaders.push(new Headers(init.headers)); return Response.json({ generation: "saved-gen", updatedAt: 2 }); }
    if (url.pathname === "/api/broadcasts/b/send") { mutationHeaders.push(new Headers(init?.headers)); sendBodies.push(JSON.parse(String(init?.body))); if (postLost) throw new Error("local response loss"); return Response.json({ id: "run", status: "scheduled" }); }
    throw new Error("Unexpected audience test request");
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function show() { await act(async () => root.render(h(MemoryRouter, null, h(ToastProvider, null, h(BroadcastEditor, { initial: draft, connected: false, onDone: () => {} }))))); }
const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text)!;
const click = async (text: string) => { await act(async () => button(text).click()); };
const counted = async () => { await act(async () => { await new Promise((done) => setTimeout(done, 350)); }); };

describe("발송 대상 옵션과 집계의 페이지 호환 실제 DOM", () => {
  it("첫 묶음 밖 저장된 선택을 이름으로 복원하고 옵션은 명시적으로 더 불러온다", async () => {
    await show(); await counted(); expect(container.textContent).toContain("선택한 그룹"); expect(container.textContent).toContain("선택한 태그");
    expect(requests.some((u) => u.pathname === "/api/leads/groups/selected")).toBe(true); expect(requests.some((u) => u.pathname === "/api/leads/tags")).toBe(false);
    await click("그룹 더 보기"); await click("태그 더 보기"); expect(container.textContent).toContain("다음 그룹"); expect(container.textContent).toContain("다음 태그");
    expect(button("3명에게 발송").disabled).toBe(false); expect(requests.every((u) => !u.pathname.endsWith("/send") && !u.pathname.endsWith("/test"))).toBe(true);
  });
  it("집계 실패를 0명으로 표시하지 않고 재확인 뒤에만 발송을 열어 준다", async () => {
    countResponse = async () => Response.json({ error: { code: "unavailable", message: "집계를 확인하지 못했어요." } }, { status: 503 });
    await show(); await counted(); expect(container.textContent).toContain("집계를 확인하지 못했어요"); expect(button("받는 사람 확인 필요").disabled).toBe(true); expect(container.textContent).not.toContain("0명에게 발송");
    countResponse = async () => Response.json({ total: 4, eligible: 4, reasons: {} }); await click("인원 다시 확인"); await counted(); expect(button("4명에게 발송").disabled).toBe(false);
  });
  it("이전 대상의 늦은 집계가 새 대상의 결과를 덮지 않는다", async () => {
    let finish!: (response: Response) => void; countResponse = () => new Promise((resolve) => { finish = resolve; }); await show(); await counted();
    countResponse = async () => Response.json({ total: 8, eligible: 8, reasons: {} });
    await act(async () => [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((item) => item.labels?.[0]?.textContent?.includes("첫 그룹"))!.click()); await counted();
    expect(button("8명에게 발송").disabled).toBe(false); await act(async () => finish(Response.json({ total: 1, eligible: 1, reasons: {} }))); expect(button("8명에게 발송").disabled).toBe(false);
  });
  it("찾을 수 없는 저장된 선택을 조용히 지우지 않고 해제할 수 있게 보여 준다", async () => {
    missing = true; await show(); await counted(); expect(container.textContent).toContain("찾을 수 없는 그룹 1"); expect(button("3명에게 발송").disabled).toBe(true);
    await act(async () => [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((item) => item.labels?.[0]?.textContent?.includes("찾을 수 없는 그룹"))!.click()); await counted(); expect(button("3명에게 발송").disabled).toBe(false);
  });
  it("미정 발송 기준은 대상 수와 점검 성공에도 실제 발송·테스트를 차단한다", async () => {
    configured = false; await show(); await counted();
    expect(container.textContent).toContain("발송 기준을 준비하고 있어요"); expect(button("3명에게 발송").disabled).toBe(true); expect(button("나에게 테스트 보내기").disabled).toBe(true);
    expect(sendBodies).toHaveLength(0);
  });
  it("응답 유실 뒤 같은 발송 요청 확인은 본문·세대·requestId를 그대로 재사용한다", async () => {
    postLost = true; await show(); await counted(); await click("3명에게 발송"); await click("지금 보내기");
    expect(sendBodies).toHaveLength(1); expect(container.querySelector("fieldset")!.disabled).toBe(true);
    postLost = false; await click("같은 발송 요청 다시 확인"); expect(sendBodies).toHaveLength(2); expect(sendBodies[0]).toEqual(sendBodies[1]);
    expect(sendBodies[0]).toMatchObject({ generation: "saved-gen" }); expect(mutationHeaders.every((headers) => headers.get("X-Message-Workspace") === "w" && headers.get("X-CSRF-Token") === "local")).toBe(true);
    expect(requests.filter((url) => url.pathname === "/api/broadcasts/b")).toHaveLength(1);
  });
  it("저장 직전 다른 탭에서 바뀐 워크스페이스에 원래 초안을 보내지 않는다", async () => {
    await show(); await counted(); currentWorkspace = "different"; await click("3명에게 발송"); await click("지금 보내기");
    expect(sendBodies).toHaveLength(0); expect(mutationHeaders).toHaveLength(0); expect(container.textContent).toContain("워크스페이스가 바뀌었어요");
  });

});
