// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../ui";
import { KeywordDmPage } from "./KeywordDmPage";
import type { KdmData, Rule } from "./kdmTypes";

let role = "owner";
vi.mock("../../lib/me", () => ({ useMe: () => ({ me: { user: { id: "u" }, workspace: { id: "w", name: "Brand" }, role }, loading: false }) }));
let root: Root, container: HTMLDivElement, data: KdmData, requests: { path: string; method: string; body: Record<string, unknown> }[];
const rule = (id: string, status: Rule["status"]): Rule => ({ id, status, guideId: "g", influencerId: "i", igMediaId: "media", mediaThumbUrl: null, mediaPermalink: null, keywords: ["give"], message: "Draft {link}", publicReplyVariants: [], pausedReason: null, guideName: "Guide", influencerName: "Creator", todaySent: 0, clicks: 0, leads: 0, linkUrl: null });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); role = "owner"; requests = [];
  data = { configured: false, sendPolicy: { configured: false, reason: "send_policy_unconfigured", message: "DM 발송 기준을 준비하고 있어요. 실제 DM과 후속 공개 답글은 아직 사용할 수 없어요." }, connection: null, defaultPublicReplies: [], rules: [rule("off", "off"), rule("on", "on")] };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname, method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    requests.push({ path, method, body });
    if (path === "/api/keyword-dm" && method === "GET") return Response.json(data);
    if (path.endsWith("/toggle") && method === "POST") { data = { ...data, rules: data.rules.map((r) => ({ ...r, status: "off" })) }; return Response.json({ ok: true }); }
    if (["/api/keyword-dm/off", "/api/keyword-dm/on"].includes(path) && method === "PATCH") return Response.json({ ok: true, turnedOff: false });
    if (path === "/api/guides") return Response.json({ guides: [{ id: "g", name: "Guide" }] });
    if (path === "/api/ig/media") return Response.json({ media: [] });
    if (path === "/api/guides/g/influencers") return Response.json({ rows: [{ influencer: { id: "i", displayName: "Creator" } }] });
    throw new Error(`Unexpected local UI request ${path}`);
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function show() { await act(async () => root.render(h(MemoryRouter, null, h(ToastProvider, null, h(KeywordDmPage))))); }
const buttons = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.textContent?.trim() === label);

describe("DM policy availability in the actual page", () => {
  it("shows preparing and disables enable while retaining draft creation, edit, history and off", async () => {
    await show(); expect(container.textContent).toContain("실제 DM과 후속 공개 답글은 아직 사용할 수 없어요.");
    expect(container.textContent).toContain("발송 기준 준비 중"); expect(buttons("규칙 만들기")[0]?.disabled).toBe(false); expect(buttons("편집")).toHaveLength(2);
    expect(buttons("켜기")[0]?.disabled).toBe(true); expect(buttons("발송 기록")).toHaveLength(2);
    await act(async () => buttons("켜기")[0]!.click()); expect(requests.filter((r) => r.method === "POST")).toHaveLength(0);
    await act(async () => buttons("끄기")[0]!.click()); expect(requests.find((r) => r.method === "POST")?.body).toEqual({ on: false });
  });
  it("missing policy information stays closed; viewer has no mutating controls", async () => {
    delete data.sendPolicy; role = "viewer"; await show();
    expect(container.textContent).toContain("DM 발송 기준을 준비하고 있어요."); expect(buttons("켜기")).toHaveLength(0); expect(buttons("편집")).toHaveLength(0); expect(buttons("규칙 만들기")).toHaveLength(0);
    expect(buttons("발송 기록")).toHaveLength(2);
  });
  it.each([0, 1])("editing existing rule %s uses neutral save copy without claiming it was turned off", async (index) => {
    await show(); await act(async () => buttons("편집")[index]!.click());
    expect(document.body.textContent).toContain("설정은 저장할 수 있어요. DM 발송 기준을 준비 중이라 실제 발송할 수 없어요.");
    expect(document.body.textContent).not.toContain("규칙은 꺼진 상태로 저장돼요.");
    const form = document.querySelector("form")!;
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const update = requests.find((r) => r.method === "PATCH")!;
    expect(update.body.message).toBe("Draft {link}"); expect(update.body).not.toHaveProperty("enabled"); expect(update.body).not.toHaveProperty("status");
    expect(document.body.textContent).toContain("저장했어요. 실제 발송 기준을 준비 중이에요.");
    expect(document.body.textContent).not.toContain("초안으로 저장했어요."); expect(document.body.textContent).not.toContain("미리보기를 확인하고 켜 주세요.");
  });
  it("an empty blocked page suggests draft preparation; only new rules describe off-state draft saving", async () => {
    data.rules = []; await show();
    expect(container.textContent).toContain("DM 발송 기준을 준비하고 있어요. 규칙 초안을 미리 작성할 수 있어요.");
    expect(container.textContent).not.toContain("게시물에 '댓글에 키워드를 남기면");
    await act(async () => buttons("규칙 만들기")[0]!.click());
    expect(document.body.textContent).toContain("규칙은 꺼진 상태로 저장돼요.");
  });
});
