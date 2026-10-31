// @vitest-environment happy-dom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../ui";
import { LeadsPage } from "./LeadsPage";
import type { LeadRow } from "./types";
import { GroupModal } from "./sections/GroupModal";
import { GuideLeadsTab } from "./GuideLeadsTab";

let workspace: string, root: Root, container: HTMLDivElement, requests: URL[], preparing: boolean;
let pending: Promise<Response> | null, more: boolean;
vi.mock("../../lib/me", () => ({ useMe: () => ({ me: { workspace: { id: workspace }, user: { id: "u", name: "QA" }, role: "owner" } }) }));
const source = { type: "manual" as const, guideId: null, influencerId: null, channelKey: null, linkId: null, at: 1 };
const row = (id: string): LeadRow => ({ id, email: `${id}@qa.invalid`, name: id, company: null, phone: null, marketingOptIn: false, alimtalkOptIn: false, unsubscribedAt: null, bouncedAt: null, firstSource: source, lastSource: source, createdAt: 1, tagIds: [], sourceTypes: ["manual"] });
const lookups = { guides: [], influencers: [], channels: [], tags: [], contents: [] };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); workspace = "w"; requests = []; preparing = false; pending = null; more = false;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input), "https://app.test"); requests.push(url);
    if (url.pathname.endsWith("/funnel")) return Response.json({ rows: [] });
    if (url.pathname === "/api/leads/groups/preview") return Response.json({ count: 2 });
    if (url.pathname === "/api/leads/groups") return Response.json({ groups: url.searchParams.has("cursor") ? [{ id: "group-next", name: "Next group", rules: { all: [] }, count: 3 }] : [], nextCursor: more && !url.searchParams.has("cursor") ? "group-page" : null });
    if (url.pathname === "/api/leads/lookups") return Response.json({ items: [{ id: "tag-next", name: "Next tag" }], nextCursor: null });
    if (url.pathname === "/api/leads") {
      if (pending) { const saved = pending; pending = null; return saved; }
      if (preparing) return Response.json({ error: { code: "search_preparing", message: "검색 자료를 준비하고 있어요. 잠시 후 다시 검색해 주세요." } }, { status: 503 });
      return Response.json({ leads: url.searchParams.has("cursor") ? [row("next")] : url.searchParams.get("q") ? [row("filtered")] : [row("first"), row("second")], lookups, nextCursor: url.searchParams.has("cursor") ? null : "opaque-cursor", lookupCursors: more ? { tags: "tag-page" } : {} });
    }
    throw new Error("Unexpected test request");
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function show(path = "/dashboard/leads", element: ReactNode = h(LeadsPage)) { await act(async () => root.render(h(MemoryRouter, { initialEntries: [path] }, h(ToastProvider, null, element)))); }
const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text)!;
const click = async (text: string) => { await act(async () => button(text).click()); };
async function search(value: string) { await act(async () => { const input = container.querySelector<HTMLInputElement>('input[aria-label="리드 검색"]')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }

describe("리드 페이지와 검색 이행 실제 React DOM", () => {
  it("가이드 리드 탭도 페이지를 이동하며 묶어 보기나 모든 그룹을 반복 조회하지 않는다", async () => {
    await show("/dashboard/guides/g?q=unrelated", h(GuideLeadsTab, { guideId: "g" })); await click("다음 페이지");
    expect(requests.filter((u) => u.pathname === "/api/leads").every((u) => u.searchParams.get("guideId") === "g")).toBe(true);
    expect(requests.filter((u) => u.pathname === "/api/leads").every((u) => !u.searchParams.has("q"))).toBe(true);
    expect(container.textContent).toContain("next@qa.invalid"); expect(requests.filter((u) => u.pathname.endsWith("/funnel"))).toHaveLength(1); expect(requests.filter((u) => u.pathname === "/api/leads/groups")).toHaveLength(0);
  });
  it("태그 탭과 그룹 편집 안에서도 다음 lookup을 불러올 수 있다", async () => {
    more = true; await show(); await click("태그"); expect(button("태그 필터 더 보기")).toBeTruthy();
    await click("그룹"); await click("그룹 만들기"); const modal = container.querySelector('[role="dialog"]')!;
    expect([...modal.querySelectorAll("button")].some((b) => b.textContent === "태그 필터 더 보기")).toBe(true); await act(async () => [...modal.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "태그 필터 더 보기")!.click());
    expect(requests.some((u) => u.pathname === "/api/leads/lookups")).toBe(true);
  });
  it("규칙이 바뀌면 이전 preview 응답을 무시하고 최신 집계만 표시한다", async () => {
    let finish!: (response: Response) => void; vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockImplementationOnce(async () => Response.json({ count: 99 }));
    await act(async () => root.render(h(MemoryRouter, null, h(ToastProvider, null, h(GroupModal, { group: { name: "QA", rules: { all: [] } }, lk: lookups, onClose: () => {}, onSaved: () => {} })))));
    await click("조건 추가"); expect(container.textContent).toContain("지금 99명"); await act(async () => finish(Response.json({ count: 1 }))); expect(container.textContent).toContain("지금 99명");
  });
  it("opaque cursor로 이동하고 이전 페이지로 돌아오며 현재 페이지 선택만 유지한다", async () => {
    await show(); expect(container.textContent).toContain("1페이지"); expect(button("이전 페이지").disabled).toBe(true);
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); expect(container.textContent).toContain("2명 선택");
    await click("다음 페이지"); expect(requests.some((url) => url.searchParams.get("cursor") === "opaque-cursor")).toBe(true); expect(container.textContent).toContain("2페이지"); expect(container.textContent).toContain("next@qa.invalid"); expect(container.textContent).not.toContain("2명 선택"); expect(button("다음 페이지").disabled).toBe(true);
    await click("이전 페이지"); expect(container.textContent).toContain("first@qa.invalid"); expect(container.textContent).toContain("1페이지");
  });
  it("검색 변경은 커서를 초기화하며 그룹 목록을 다시 전체 집계하지 않는다", async () => {
    await show(); await click("다음 페이지"); const groupsBefore = requests.filter((u) => u.pathname === "/api/leads/groups").length;
    await search("Ä%_"); const latest = requests.filter((u) => u.pathname === "/api/leads").at(-1)!;
    expect(latest.searchParams.get("q")).toBe("Ä%_"); expect(latest.searchParams.has("cursor")).toBe(false); expect(container.textContent).toContain("1페이지"); expect(requests.filter((u) => u.pathname === "/api/leads/groups")).toHaveLength(groupsBefore);
    expect(container.querySelector<HTMLAnchorElement>('a[href^="/api/leads/export"]')?.href).toContain("q=");
  });
  it("미이행 검색을 준비 상태로 보여주고 빈 결과로 주장하지 않으며 다시 확인할 수 있다", async () => {
    preparing = true; await show("/dashboard/leads?q=Ä"); expect(container.textContent).toContain("검색 자료를 준비하고 있어요"); expect(container.textContent).not.toContain("조건에 맞는 리드가 없어요");
    preparing = false; await click("다시 확인"); expect(container.textContent).toContain("filtered@qa.invalid");
  });
  it("이전 필터의 늦은 응답을 무시하고 최신 결과를 유지한다", async () => {
    let finish!: (r: Response) => void; pending = new Promise((resolve) => { finish = resolve; }); await show(); await search("new"); expect(container.textContent).toContain("filtered@qa.invalid");
    await act(async () => finish(Response.json({ leads: [row("stale")], lookups }))); expect(container.textContent).not.toContain("stale@qa.invalid"); expect(container.textContent).toContain("filtered@qa.invalid");
  });
  it("명시적으로 다음 lookup·그룹 묶음을 불러오고 조용히 첫 묶음으로 제한하지 않는다", async () => {
    more = true; await show(); await click("태그 필터 더 보기"); expect(requests.some((u) => u.pathname === "/api/leads/lookups" && u.searchParams.get("cursor") === "tag-page")).toBe(true);
    await click("그룹 더 보기"); expect(requests.some((u) => u.pathname === "/api/leads/groups" && u.searchParams.get("cursor") === "group-page")).toBe(true);
    await click("그룹"); expect(container.textContent).toContain("Next group");
  });
  it("workspace 변경 뒤 오래된 목록을 적용하지 않는다", async () => {
    let finish!: (r: Response) => void; pending = new Promise((resolve) => { finish = resolve; }); await show(); workspace = "other"; await show();
    await act(async () => finish(Response.json({ leads: [row("old-workspace")], lookups }))); expect(container.textContent).not.toContain("old-workspace@qa.invalid"); expect(container.textContent).toContain("first@qa.invalid");
  });
});
