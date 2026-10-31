// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditCampaignModal } from "../guides/sections/EditCampaignModal";
import type { GuideCampaign } from "../guides/types";
import { ToastProvider } from "../../ui";

let root: Root, container: HTMLDivElement;
let patches: Record<string, unknown>[];
const campaign: GuideCampaign = { id: "c1", name: "Campaign", brandId: "b1", brandName: "Brand", status: "active", endsAt: null, archivedAt: null };
beforeEach(() => {
  patches = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/brands") return Response.json({ brands: [{ id: "b1", name: "Brand" }] });
    if (path === "/api/campaigns/c1" && init?.method === "PATCH") { patches.push(JSON.parse(String(init.body))); return Response.json({ ok: true }); }
    throw new Error(`예상하지 않은 캠페인 요청: ${path}`);
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function show(value = campaign, archiveOnSave = false) {
  const saved = vi.fn(async () => {}), closed = vi.fn();
  await act(async () => root.render(h(MemoryRouter, null, h(ToastProvider, null, h(EditCampaignModal, { campaign: value, archiveOnSave, onSaved: saved, onClose: closed })))));
  return { saved, closed };
}
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === label)!;
async function end(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function submit() { await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }

describe("명시적인 캠페인 종료 시각", () => {
  it("종료 시각이 없으면 보관 저장을 막고 업로드 마감과 다른 필드임을 안내한다", async () => {
    await show(campaign, true);
    expect(container.textContent).toContain("캠페인 종료 시각을 알려 주세요");
    expect(container.textContent).toContain("영상 업로드 마감과 별개");
    expect(button("저장하고 보관").disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[type="datetime-local"]')?.value).toBe("");
    expect(patches).toHaveLength(0);
  });

  it("선택한 로컬 종료 시각을 명시하고 보관하며 서버의 archivedAt은 임의로 보내지 않는다", async () => {
    const { saved, closed } = await show(campaign, true);
    await end("2026-11-01T18:30");
    expect(button("저장하고 보관").disabled).toBe(false);
    await submit();
    expect(patches).toEqual([{ name: "Campaign", brandId: "b1", endsAt: new Date("2026-11-01T18:30").getTime(), status: "archived" }]);
    expect(patches[0]).not.toHaveProperty("deadlineAt");
    expect(patches[0]).not.toHaveProperty("archivedAt");
    expect(saved).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("과거 보관 캠페인의 없는 종료 시각을 추정하지 않고 입력을 요구한다", async () => {
    await show({ ...campaign, status: "archived" });
    expect(container.textContent).toContain("종료 시각이 없어 성과 수집을 멈춘 상태");
    expect(button("저장").disabled).toBe(true);
    expect(container.textContent).not.toContain("보관한 시각:");
    expect(container.querySelector<HTMLInputElement>('input[type="datetime-local"]')?.required).toBe(true);
  });
});
