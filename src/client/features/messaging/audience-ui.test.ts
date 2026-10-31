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
let countResponse: () => Promise<Response>, missing: boolean;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); requests = []; missing = false;
  draft = { id: "b", name: "QA", status: "draft", scheduledAt: null, sentAt: null, updatedAt: 1, stats: null, channel: "email", kind: "info", audience: { groupIds: ["chosen-g"], tagIds: ["chosen-t"] }, template: { subject: "QA", preview: "", body: "QA only", buttonLabel: "", buttonUrl: "" } };
  countResponse = async () => Response.json({ total: 3, eligible: 3, reasons: {} });
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input), "https://app.test"); requests.push(url);
    if (url.pathname === "/api/leads/groups/selected") return Response.json({ groups: missing ? [] : [{ id: "chosen-g", name: "선택한 그룹", count: 3 }] });
    if (url.pathname === "/api/leads/groups") return Response.json({ groups: url.searchParams.has("cursor") ? [{ id: "g2", name: "다음 그룹", count: 1 }] : [{ id: "g1", name: "첫 그룹", count: 1 }], nextCursor: url.searchParams.has("cursor") ? null : "group-next" });
    if (url.pathname === "/api/leads/lookups") return Response.json({ items: url.searchParams.has("selected") ? [{ id: "chosen-t", name: "선택한 태그" }] : url.searchParams.has("cursor") ? [{ id: "t2", name: "다음 태그" }] : [{ id: "t1", name: "첫 태그" }], nextCursor: url.searchParams.has("cursor") ? null : "tag-next" });
    if (url.pathname === "/api/broadcasts/audience") return countResponse();
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
});
