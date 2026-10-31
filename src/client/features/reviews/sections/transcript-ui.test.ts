// @vitest-environment happy-dom
import { act, createElement as h, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranscriptTab } from "./TranscriptTab";
import type { ReviewDetail } from "../types";

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No real HTTP"); })); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function show(status: string, error: string | null, mediaState?: ReviewDetail["mediaState"]) {
  const d = { jobs: [{ stage: "transcribe", status, error }], segments: [], mediaState } as unknown as ReviewDetail;
  await act(async () => root.render(h(StrictMode, null, h(TranscriptTab, { d, base: "/api/reviews/s", canEdit: false, onSeek: vi.fn(), onAct: vi.fn() }))));
}
describe("음성 상태 DOM의 확정/확인불가 구분", () => {
  it.each([
    ["no_audio_track", "음성 없음", "오디오 트랙이 없는 영상이에요"],
    ["no_speech", "대사 없음", "오디오에서 대사를 찾지 못했어요"],
    ["audio_unavailable", "오디오 확인 불가", "대사가 없는 영상으로 판단하지 않으며"],
    ["no_audio", "오디오 확인 불가", "대사가 없는 영상으로 판단하지 않으며"],
    ["withdrawn", "동의를 철회한 영상이에요", "음성 분석을 중단했어요"],
  ])("%s는 %s로 구분한다", async (error, title, description) => {
    await show("skipped", error!); expect(container.textContent).toContain(title!); expect(container.textContent).toContain(description!); expect(fetch).not.toHaveBeenCalled();
  });
  it("queued/failed를 음성 없음으로 표시하지 않는다", async () => {
    await show("queued", null); expect(container.textContent).toContain("전사 준비 중"); expect(container.textContent).not.toContain("음성 없음");
    await show("failed", "transcribe_failed"); expect(container.textContent).toContain("전사 실패"); expect(container.textContent).not.toContain("음성 없음");
  });
  it("이미 끝난 전사도 이후 철회/미디어 확인불가를 준비중이나 음성없음으로 표시하지 않는다", async () => {
    await show("done", null, "withdrawn"); expect(container.textContent).toContain("동의를 철회한 영상이에요"); expect(container.textContent).not.toContain("전사 준비 중");
    await show("skipped", "no_audio_track", "unavailable"); expect(container.textContent).toContain("오디오 확인 불가"); expect(container.textContent).not.toContain("음성 없음");
  });
});
