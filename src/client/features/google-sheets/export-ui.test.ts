// @vitest-environment happy-dom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../ui";
import { PerformanceTable } from "../performance/PerformanceTable";
import type { PerfRow } from "../performance/perfTypes";
import { LeadsPage } from "../leads/LeadsPage";
import { SheetsExportControl } from "./SheetsExportControl";
import type { SheetsConnection, SheetsJob } from "./types";

vi.mock("../../lib/me", () => ({ useMe: () => ({ me: { user: { id: "u1", name: "Person", email: "person@example.com" }, workspace: { id: "w1", name: "Team" }, role: "owner" }, loading: false }) }));

type RequestLog = { path: string; query: URLSearchParams; method: string; body: Record<string, unknown>; headers: Headers };
let root: Root, container: HTMLDivElement;
let status: SheetsConnection;
let row: PerfRow;
let outcome: SheetsJob;
let requests: RequestLog[];
let failExport: boolean;
let pendingExport: Promise<Response> | null;
let acceptedExports: number;

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  status = { configured: true, connected: true, generation: "connection-a", csrfToken: "session-csrf", maxRows: 1000, accountEmail: "sheets-owner@example.com" };
  row = { contentId: "c1", guideId: "g1", guideName: "Campaign", influencerId: "i1", influencerName: "Creator", igHandle: "creator", url: "https://www.instagram.com/reel/post1/", format: "reel", postedAt: 1_800_000_000_000, postedAtSource: "api", registeredAt: 1_800_000_000_000, connected: true, thumbnailUrl: "/api/performance/contents/c1/thumbnail", thumbnailFetchedAt: 100, collectionEndsAt: null, collectionStoppedReason: null, snapshots: {}, clicks: 123, leads: 7 };
  outcome = { id: "export1", status: "done", rows: 1, spreadsheetUrl: "https://docs.google.com/spreadsheets/d/file1/edit" };
  requests = []; failExport = false; pendingExport = null; acceptedExports = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input), "https://app.example.com");
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
    requests.push({ path: url.pathname, query: url.searchParams, method: init?.method ?? "GET", body, headers: new Headers(init?.headers) });
    if (url.pathname === "/api/google-sheets/status") return Response.json(status);
    if (url.pathname === "/api/google-sheets/connect") return Response.json({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=opaque-state" });
    if (url.pathname === "/api/google-sheets/disconnect") { status = { ...status, connected: false, accountEmail: null }; return Response.json({ connected: false }); }
    if (url.pathname === "/api/google-sheets/exports") {
      if (body.connectionGeneration !== status.generation) return Response.json({ error: { code: "connection_changed", message: "Google 연결 계정이 바뀌었어요. 계정을 확인한 뒤 다시 내보내 주세요." } }, { status: 409 });
      if (failExport) { failExport = false; throw new TypeError("network interrupted"); }
      acceptedExports++;
      return pendingExport ?? Response.json(outcome);
    }
    if (url.pathname === "/api/google-sheets/exports/export1") return Response.json(outcome);
    if (url.pathname === "/api/performance") return Response.json({ rows: [row], filters: { guides: [{ id: "g1", name: "Campaign" }], influencers: [{ id: "i1", name: "Creator" }] } });
    if (url.pathname === "/api/performance/contents/c1/retry") return Response.json({ ok: true, queued: 1 });
    if (url.pathname === "/api/leads") return Response.json({ leads: [], lookups: { guides: [{ id: "g1", name: "Campaign" }], influencers: [], channels: [], tags: [], contents: [] } });
    if (url.pathname === "/api/leads/groups") return Response.json({ groups: [] });
    throw new Error(`예상하지 않은 UI 요청: ${url.pathname}`);
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function show(element: ReactNode = h(SheetsExportControl, { kind: "performance", query: "guideId=g1" }), path = "/dashboard/performance") {
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [path] }, h(ToastProvider, null, element))); });
}
function button(label: string) {
  const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === label);
  if (!found) throw new Error(`버튼이 없어요: ${label}`);
  return found;
}
const click = async (label: string) => { await act(async () => button(label).click()); };
const exported = () => requests.filter((request) => request.path === "/api/google-sheets/exports" && request.method === "POST");
const waitExports = async (n: number) => { await act(async () => { await vi.waitFor(() => expect(exported()).toHaveLength(n), { timeout: 2000, interval: 10 }); }); };
async function remount(element: ReactNode, path: string) {
  await act(async () => root.unmount()); root = createRoot(container); await show(element, path);
}

describe("성과표와 시트 내보내기 실제 DOM", () => {
  it("준비되지 않은 Google 설정은 성공·연결 상태로 표시하지 않고 CSV 경로를 유지한다", async () => {
    status = { ...status, configured: false, connected: false, accountEmail: null };
    await show(h(PerformanceTable));
    expect(container.querySelector<HTMLAnchorElement>('a[href^="/api/performance/export"]')).not.toBeNull();
    await click("구글 시트 내보내기");
    expect(container.textContent).toContain("Google 연결을 준비하고 있어요");
    expect(button("Google 계정 연결").disabled).toBe(true);
    expect(container.textContent).not.toContain("연결된 Google 계정");
    expect(exported()).toHaveLength(0);
  });

  it("같은 성과 행에 인증된 썸네일·기존 클릭·리드를 표시하고 이미지 실패에도 수치를 보존한다", async () => {
    await show(h(PerformanceTable));
    const tableRow = container.querySelector("tbody tr")!;
    expect(tableRow.textContent).toContain("Creator");
    expect([...tableRow.querySelectorAll("td")].some((cell) => cell.textContent === "123")).toBe(true);
    expect([...tableRow.querySelectorAll("td")].some((cell) => cell.textContent === "7")).toBe(true);
    const image = tableRow.querySelector<HTMLImageElement>(".perf-thumbnail img")!;
    expect(image.getAttribute("src")).toBe("/api/performance/contents/c1/thumbnail?v=100");
    await act(async () => image.dispatchEvent(new Event("error")));
    expect(tableRow.querySelector(".perf-thumbnail img")).toBeNull();
    expect(tableRow.querySelector(".perf-thumbnail svg")).not.toBeNull();
    expect(tableRow.textContent).toContain("123");
  });

  it("수집 중지 사유를 표시하고 종료된 캠페인의 수동 재수집을 막는다", async () => {
    row = { ...row, collectionStoppedReason: "campaign_end_unknown" };
    await show(h(PerformanceTable));
    expect(container.textContent).toContain("캠페인 종료 시각을 확인해 주세요");
    expect(button("다시 수집").disabled).toBe(true);
    await click("다시 수집");
    expect(requests.filter((request) => request.path.endsWith("/retry"))).toHaveLength(0);
  });

  it("OAuth 복귀 필터와 CSRF를 내보내기에 그대로 쓰고 빠른 중복 클릭을 한 요청으로 처리한다", async () => {
    let finish!: (response: Response) => void;
    pendingExport = new Promise((resolve) => { finish = resolve; });
    await show(h(PerformanceTable), "/dashboard/performance?guideId=g1&influencerId=i1&format=reel&sheets=connected");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).toContain("sheets-owner@example.com");
    const make = button("시트 만들기");
    await act(async () => { make.click(); make.click(); });
    await waitExports(1);
    expect(exported()).toHaveLength(1);
    const request = exported()[0]!;
    expect(request.body).toMatchObject({ kind: "performance", filters: { guideId: "g1", influencerId: "i1", format: "reel" }, connectionGeneration: "connection-a" });
    expect(request.headers.get("X-CSRF-Token")).toBe("session-csrf");
    expect(String(request.body.requestId)).toMatch(/^[0-9a-f-]{36}$/);
    await act(async () => { finish(Response.json(outcome)); });
    expect(container.querySelector<HTMLAnchorElement>('a[href="https://docs.google.com/spreadsheets/d/file1/edit"]')?.textContent).toBe("시트 열기");
    expect(container.textContent).toContain("1개 행을 저장했어요");
  });

  it("연결은 필터를 복귀 주소에 보존하고 연결만으로 데이터를 자동 전송하지 않는다", async () => {
    status = { ...status, connected: false, accountEmail: null };
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    await show(h(PerformanceTable), "/dashboard/performance?guideId=g1&format=reel");
    await click("구글 시트 내보내기"); await click("Google 계정 연결");
    const connect = requests.find((request) => request.path === "/api/google-sheets/connect")!;
    const returnTo = new URL(String(connect.body.returnTo), "https://app.example.com");
    expect(returnTo.pathname).toBe("/dashboard/performance");
    expect(Object.fromEntries(returnTo.searchParams)).toEqual({ guideId: "g1", format: "reel" });
    expect(assign).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?state=opaque-state");
    expect(exported()).toHaveLength(0);
  });

  it("표시한 A 연결과 달라진 B 연결로 자동 전송하지 않고 새 계정을 확인한 다음 명시적으로 내보낸다", async () => {
    await show(); await click("구글 시트 내보내기");
    expect(container.textContent).toContain("sheets-owner@example.com");
    status = { ...status, generation: "connection-b", accountEmail: "other-account@example.com" };
    await click("시트 만들기"); await waitExports(1);
    expect(exported()[0]!.body.connectionGeneration).toBe("connection-a");
    expect(acceptedExports).toBe(0);
    expect(container.textContent).toContain("Google 연결 계정이 바뀌었어요");
    expect(container.textContent).toContain("other-account@example.com");
    expect(exported()).toHaveLength(1);
    await click("시트 만들기"); await waitExports(2);
    expect(exported()[1]!.body.connectionGeneration).toBe("connection-b");
    expect(exported()[1]!.body.requestId).not.toBe(exported()[0]!.body.requestId);
    expect(acceptedExports).toBe(1);
  });

  it("응답 손실과 새로고침에도 같은 요청 ID를 재사용하며 생성 결과 미확정이면 새 파일을 자동으로 만들지 않는다", async () => {
    const query = "q=private%40example.com";
    const element = h(SheetsExportControl, { kind: "leads", query });
    await show(element, "/dashboard/leads"); await click("구글 시트 내보내기");
    failExport = true;
    await click("시트 만들기");
    await waitExports(1);
    const originalId = exported()[0]!.body.requestId;
    outcome = { id: "export1", status: "unknown", rows: 1, errorCode: "create_unknown" };
    await click("시트 만들기");
    await waitExports(2);
    expect(exported()[1]!.body.requestId).toBe(originalId);
    expect(container.textContent).toContain("시트 생성 결과를 확인하지 못했어요");
    expect([...container.querySelectorAll("button")].some((item) => item.textContent === "시트 만들기")).toBe(false);
    expect(container.querySelector('a[href="https://drive.google.com/drive/my-drive"]')).not.toBeNull();
    await remount(element, "/dashboard/leads"); await click("구글 시트 내보내기"); await click("시트 만들기");
    await waitExports(3);
    expect(exported()[2]!.body.requestId).toBe(originalId);
    const stored = Array.from({ length: sessionStorage.length }, (_, i) => { const key = sessionStorage.key(i)!; return key + sessionStorage.getItem(key); }).join(" ");
    expect(stored).not.toContain("private@example.com");
    expect(stored).not.toContain("private%40example.com");
  });

  it("쓰기 재시도는 같은 요청 ID를 사용하고 연결 해제 후에는 연결부터 안내한다", async () => {
    outcome = { id: "export1", status: "failed", rows: 1, retryable: true, spreadsheetUrl: "https://docs.google.com/spreadsheets/d/file1/edit" };
    await show(); await click("구글 시트 내보내기"); await click("시트 만들기");
    await waitExports(1);
    const id = exported()[0]!.body.requestId;
    outcome = { ...outcome, status: "done", retryable: false };
    await click("같은 시트에 다시 저장");
    await waitExports(2);
    expect(exported()[1]!.body.requestId).toBe(id);
    await click("연결 해제");
    expect(container.textContent).not.toContain("연결된 Google 계정");
    expect(button("Google 계정 연결").disabled).toBe(false);
  });

  it("리드 OAuth 복귀도 CSV와 같은 검색·가이드·동의 필터를 내보낸다", async () => {
    await show(h(LeadsPage), "/dashboard/leads?q=someone&guideId=g1&marketing=true&sheets=connected");
    const csv = container.querySelector<HTMLAnchorElement>('a[href^="/api/leads/export"]')!;
    const csvFilters = Object.fromEntries(new URL(csv.getAttribute("href")!, "https://app.example.com").searchParams);
    await click("시트 만들기");
    await waitExports(1);
    expect(exported()[0]!.body).toMatchObject({ kind: "leads", filters: { q: "someone", guideId: "g1", marketing: "true" } });
    expect(exported()[0]!.body.filters).toEqual(csvFilters);
    const leadRead = requests.find((request) => request.path === "/api/leads")!;
    expect(Object.fromEntries(leadRead.query)).toEqual(csvFilters);
  });
});
