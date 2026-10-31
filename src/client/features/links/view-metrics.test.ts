// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GATE } from "../../../shared/leads";
import { GuideLeadsTab } from "../leads/GuideLeadsTab";
import { EMPTY_LOOKUPS } from "../leads/types";
import { DocumentAnalytics } from "./DocumentPanel";
import { documentStatsText, type DocumentRow, type DocumentViewStats } from "./common";

const BASE = { clicks: 8, measuredClicks: 2, views: 5, uniqueViews: 1, reViews: 2, unattributedViews: 2 };
let stats: DocumentViewStats;
let root: Root;
let container: HTMLDivElement;

const doc: DocumentRow = {
  id: "doc1", guideId: "g1", title: "자료", pages: 1, sizeMb: 0, allowDownload: false, gate: DEFAULT_GATE,
  sourceType: "editor", sourceUrl: null, fetchedHtmlKey: null, fetchedAt: null, createdAt: 1,
  stats: { ...BASE, completed: 3, leads: 0 },
};

beforeEach(() => {
  stats = { ...BASE };
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const path = new URL(String(input), "https://app.example.com").pathname;
    if (path === "/api/documents/doc1/analytics") return Response.json({
      ...stats, pages: 1, unique: 3, completed: 3, completionRate: 0.6, avgScrollPct: 70, pageStats: [], leadViews: [],
      byLink: [{ ...stats, linkId: "link1", channelKey: "ig_bio", influencerName: "작가", completed: 3 }],
    });
    if (path === "/api/guides/g1/funnel") return Response.json({ rows: [{
      ...stats, influencerId: "i1", name: "작가", dmSent: 0, leads: 0,
      siteVisited: 0, siteScroll50: 0, siteConverted: 0, siteConversionValue: 0,
    }] });
    if (path === "/api/leads") return Response.json({ leads: [], lookups: EMPTY_LOOKUPS });
    throw new Error(`예상하지 않은 API 요청: ${path}`);
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderScreens() {
  await act(async () => root.render(h(MemoryRouter, null,
    h("section", { id: "document-metrics" }, h(DocumentAnalytics, { doc, channels: [] })),
    h("section", { id: "funnel-metrics" }, h(GuideLeadsTab, { guideId: "g1" })),
  )));
}
const documentMetric = (label: string) => [...container.querySelectorAll("#document-metrics .stat")]
  .find((node) => node.querySelector(".stat-label")?.textContent === label)?.querySelector(".stat-value")?.textContent;
const sourceRow = () => container.querySelector<HTMLTableRowElement>("#document-metrics tbody tr")!;
const funnelRow = () => container.querySelector<HTMLTableRowElement>("#funnel-metrics tbody tr")!;

describe("자료 통계와 퍼널의 열람 기준", () => {
  it("전체 열람·전체 클릭 대신 고유 열람/측정 가능 클릭으로 같은 비율을 보여 준다", async () => {
    await renderScreens();
    expect(documentMetric("열람률")).toBe("50%");
    expect(sourceRow().cells[4]?.textContent).toBe("50%");
    expect(funnelRow().cells[5]?.textContent).toBe("50%");
    expect(documentMetric("고유 열람(클릭)")).toBe("1");
    expect(documentMetric("재열람(브라우저 추정)")).toBe("2");
    expect(documentMetric("미연결 열람")).toBe("2");
    expect(documentMetric("전체 열람")).toBe("5");
  });

  it("과거 클릭·미연결 열람만 있으면 0% 대신 측정 기록 없음으로 표시한다", async () => {
    stats = { clicks: 9, measuredClicks: 0, views: 4, uniqueViews: 0, reViews: 2, unattributedViews: 4 };
    await renderScreens();
    expect(documentMetric("열람률")).toBe("-");
    expect(sourceRow().cells[4]?.textContent).toBe("-");
    expect(funnelRow().cells[5]?.textContent).toBe("-");
    expect(funnelRow().cells[3]?.textContent).toBe("측정 기록 없음");
    expect(container.querySelector("#document-metrics")?.textContent).toContain("측정 기록 없음 · 전체 클릭 9");
    expect(documentStatsText({ ...stats, completed: 0, leads: 0 })).toContain("열람률 -");
  });

  it("측정 가능 클릭이 있고 열람이 없으면 실제 0%를 표시한다", async () => {
    stats = { clicks: 9, measuredClicks: 3, views: 0, uniqueViews: 0, reViews: 0, unattributedViews: 0 };
    await renderScreens();
    expect(documentMetric("열람률")).toBe("0%");
    expect(sourceRow().cells[4]?.textContent).toBe("0%");
    expect(funnelRow().cells[5]?.textContent).toBe("0%");
  });

  it("클릭 기준 고유 열람과 브라우저 추정 재열람을 구분하고 미연결 열람의 제외를 안내한다", async () => {
    await renderScreens();
    const documentText = container.querySelector("#document-metrics")?.textContent;
    expect(documentText).toContain("사람 수와는 달라요");
    expect(documentText).toContain("같은 자료를 같은 브라우저로 다시 연 횟수의 추정값");
    expect(documentText).toContain("열람률에서 제외해요");
    expect(documentText).toContain("과거 기록에는 열림 여부를 확인할 수 없는 폼 예약 기록이 포함될 수 있어요");
    expect(container.querySelector("#funnel-metrics")?.textContent).toContain("재열람은 같은 자료를 같은 브라우저로 다시 연 횟수의 추정값");
    expect(container.querySelector("#funnel-metrics")?.textContent).toContain("과거 기록에는 열림 여부를 확인할 수 없는 폼 예약 기록이 포함될 수 있어요");
  });
});
