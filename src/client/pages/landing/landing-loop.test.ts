// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Showcase } from "./sections/Showcase";
import { SHOWCASE } from "./showcase";

type Watcher = { callback: IntersectionObserverCallback; element: Element | null; disconnected: boolean };
let root: Root, container: HTMLDivElement, reduced: boolean;
const watchers: Watcher[] = [];
beforeEach(() => {
  reduced = false; watchers.length = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No HTTP in loop DOM regression"); }));
  vi.spyOn(window, "matchMedia").mockImplementation(() => ({ matches: reduced } as MediaQueryList));
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => { throw new Error("No real media loading"); });
  vi.stubGlobal("IntersectionObserver", class {
    value: Watcher;
    constructor(callback: IntersectionObserverCallback) { this.value = { callback, element: null, disconnected: false }; watchers.push(this.value); }
    observe(element: Element) { this.value.element = element; }
    disconnect() { this.value.disconnected = true; }
  });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const show = async () => { await act(async () => root.render(h(Showcase))); };
const item = (name: string) => [...container.querySelectorAll<HTMLLIElement>(".landing-showcase-item")].find((el) => el.querySelector("video")?.getAttribute("poster") === "/videos/" + name + ".jpg")!;
const enter = (video: HTMLVideoElement, visible: boolean) => {
  const watcher = watchers.find((entry) => entry.element === video && !entry.disconnected)!;
  watcher.callback([{ isIntersecting: visible } as IntersectionObserverEntry], {} as IntersectionObserver);
};

describe("showcase loop source contract (mock DOM, no browser decode)", () => {
  it("changes only review media, preserves its existing poster and keeps all introductions looping", async () => {
    await show();
    expect(SHOWCASE.videos.map((video) => video.file)).toEqual(["guide", "review", "feedback"]);
    for (const name of ["guide", "review", "feedback"]) {
      const video = item(name).querySelector("video")!;
      const expected = name === "review" ? "review-loop" : name;
      expect([...video.querySelectorAll("source")].map((source) => [source.getAttribute("src"), source.type])).toEqual([
        ["/videos/" + expected + ".webm", "video/webm"], ["/videos/" + expected + ".mp4", "video/mp4"],
      ]);
      expect(video.loop).toBe(true); expect(video.getAttribute("poster")).toBe("/videos/" + name + ".jpg");
      expect(video.hasAttribute("playsinline")).toBe(true); expect(video.preload).toBe("metadata");
    }
    expect(container.querySelectorAll(".landing-showcase-play")).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled(); expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
  });
  it("retains visibility playback and never injects an ended seek, terminal screen, or replay button", async () => {
    await show(); const video = item("review").querySelector("video")!;
    enter(video, true); expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    enter(video, false); expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledOnce();
    await act(async () => video.dispatchEvent(new Event("ended")));
    expect(video.loop).toBe(true); expect(container.querySelectorAll(".landing-showcase-play")).toHaveLength(0);
    enter(video, true); expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    expect(video.currentTime).toBe(0); expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
  });
  it("keeps reduced-motion opt-in and native loop after the user starts review", async () => {
    reduced = true; await show(); expect(watchers).toHaveLength(0);
    expect(container.querySelectorAll(".landing-showcase-play")).toHaveLength(3);
    await act(async () => item("review").querySelector<HTMLButtonElement>("button")!.click());
    expect(watchers).toHaveLength(1);
    const video = item("review").querySelector("video")!; enter(video, true);
    expect(video.loop).toBe(true); expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    expect(container.querySelectorAll(".landing-showcase-play")).toHaveLength(2);
  });
});

describe("review loop original/derived assets", () => {
  it("preserves both original review encodings byte-for-byte", () => {
    const hash = (name: string) => createHash("sha256").update(readFileSync("public/videos/" + name)).digest("hex");
    expect(hash("review.mp4")).toBe("4528bc1306cae3df9a01a9460cf88cf745d95f7082c74bc03a788f44cb8ad5cc");
    expect(hash("review.webm")).toBe("0125479644112cd5ddbfe1d9e412f008a8df98c0476027544054cc61ce5a6659");
  });
  const ffprobeAvailable = spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
  it.runIf(ffprobeAvailable).each([["mp4", "h264"], ["webm", "vp9"]])("keeps %s dimensions/fps/codec/silence and exactly232 cyclic frames", (extension, codec) => {
    const result = spawnSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,nb_read_frames", "-of", "json", "public/videos/review-loop." + extension], { encoding: "utf8" });
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data.streams).toHaveLength(1);
    expect(data.streams[0]).toMatchObject({ codec_type: "video", codec_name: codec, width: 1920, height: 1080, r_frame_rate: "30/1", nb_read_frames: "232" });
    expect(Math.abs(Number(data.format.duration) - 232 / 30)).toBeLessThan(0.002);
  });
});
