// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractFrames, FRAME_STEP_TIMEOUT_MS, VIDEO_LOAD_TIMEOUT_MS } from "./extract";

type Options = { duration?: number; width?: number; height?: number; pixels?: (time: number) => Uint8ClampedArray; load?: "error" | "stall" | "throw"; seek?: "error" | "stall" | "throw"; jpeg?: "null" | "stall" | "throw"; canvasMissing?: boolean };
const file = () => new File(["synthetic container only"], "fixture.mp4", { type: "video/mp4" });
function solid(r: number, g = r, b = r) { const pixels = new Uint8ClampedArray(32 * 32 * 4); for (let i = 0; i < pixels.length; i += 4) pixels.set([r, g, b, 255], i); return pixels; }
function mockMedia(options: Options = {}) {
  let time = 0, src = "", samples = 0, drawnAt = 0;
  const seeks: number[] = [], encodes: { at: number; type?: string; quality?: number; width: number; height: number; samples: number }[] = [];
  const revoke = vi.fn(), create = vi.fn(() => "blob:synthetic-scene"); const OriginalURL = URL;
  class FakeURL extends OriginalURL { static override createObjectURL = create; static override revokeObjectURL = revoke; }
  vi.stubGlobal("URL", FakeURL);
  const video = {
    muted: false, playsInline: false, preload: "", duration: options.duration ?? 4, videoWidth: options.width ?? 1920, videoHeight: options.height ?? 1080,
    readyState: 2, seeking: false, error: null as { code: number } | null,
    onloadeddata: null as (() => void) | null, onseeked: null as (() => void) | null, onerror: null as (() => void) | null,
    pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn((name: string) => { if (name === "src") src = ""; }),
    get src() { return src; }, set src(value: string) {
      if (options.load === "throw") throw new Error("native load details"); src = value;
      if (options.load !== "stall") queueMicrotask(() => options.load === "error" ? video.onerror?.() : video.onloadeddata?.());
    },
    get currentTime() { return time; }, set currentTime(value: number) {
      if (options.seek === "throw") throw new Error("native seek details"); time = value; seeks.push(value);
      if (options.seek !== "stall") queueMicrotask(() => { if (options.seek === "error") { video.error = { code: 3 }; video.onerror?.(); } else video.onseeked?.(); });
    },
  };
  const big = { width: 0, height: 0, getContext: vi.fn(() => options.canvasMissing ? null : { drawImage: vi.fn(() => { drawnAt = time; }) }), toBlob: (callback: BlobCallback, type?: string, quality?: number) => {
    encodes.push({ at: drawnAt, type, quality, width: big.width, height: big.height, samples });
    if (options.jpeg === "throw") throw new Error("native encoder details");
    if (options.jpeg !== "stall") queueMicrotask(() => callback(options.jpeg === "null" ? null : new Blob([String(drawnAt)], { type: "image/jpeg" })));
  } };
  const small = { width: 0, height: 0, getContext: vi.fn(() => ({ drawImage: vi.fn(), getImageData: () => { samples++; return { data: options.pixels?.(time) ?? solid(0) }; } })) };
  const element = document.createElement.bind(document); let canvases = 0;
  vi.spyOn(document, "createElement").mockImplementation(((name: string) => name === "video" ? video : name === "canvas" ? (++canvases === 1 ? big : small) : element(name)) as typeof document.createElement);
  return { video, seeks, encodes, create, revoke, get samples() { return samples; } };
}
async function until(ready: () => boolean) { for (let i = 0; i < 100 && !ready(); i++) await Promise.resolve(); expect(ready()).toBe(true); }
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("extractFrames with DOM fake video/canvas, no native media or network", () => {
  it.each([[1920, 1080, 720, 405], [1080, 1920, 405, 720], [320, 240, 320, 240]])("preserves 720px/no-upscale JPEG0.8 and nominal timestamps for %ix%i", async (width, height, expectedWidth, expectedHeight) => {
    const media = mockMedia({ duration: 3, width, height }), progress: number[] = [];
    const shots = await extractFrames(file(), 10, (ratio) => progress.push(ratio));
    expect(shots.map((s) => ({ tMs: s.tMs, source: s.source }))).toEqual([{ tMs: 0, source: "fps" }, { tMs: 1000, source: "fps" }, { tMs: 2000, source: "fps" }]);
    expect(media.encodes).toHaveLength(3); expect(media.encodes.every((e) => e.type === "image/jpeg" && e.quality === .8 && e.width === expectedWidth && e.height === expectedHeight && e.samples === 6)).toBe(true);
    expect(shots.every((s) => Object.keys(s).sort().join(",") === "blob,source,tMs")).toBe(true); expect(progress.at(-1)).toBe(1); expect(progress.every((p, i) => p >= 0 && p <= 1 && (!i || p >= progress[i - 1]!))).toBe(true);
    expect(media.revoke).toHaveBeenCalledExactlyOnceWith("blob:synthetic-scene"); expect(media.video.pause).toHaveBeenCalledOnce(); expect(media.video.src).toBe("");
  });
  it("keeps an integer-second cut even when the old fps stride would discard it", async () => {
    const media = mockMedia({ pixels: (t) => solid(t >= 1 && t < 1.5 ? 255 : 0) }); const shots = await extractFrames(file(), 1);
    expect(shots.map(({ tMs, source }) => ({ tMs, source }))).toEqual([{ tMs: 1000, source: "fps" }]); expect(media.encodes).toHaveLength(1);
  });
  it("preserves half-second scene priority and deduplicates integer cuts from the fps union", async () => {
    const media = mockMedia({ pixels: (t) => t >= .5 && t < 1 ? solid(0, 130, 0) : solid(255, 0, 0) }); const shots = await extractFrames(file(), 3);
    expect(shots.map(({ tMs, source }) => ({ tMs, source }))).toEqual([{ tMs: 0, source: "fps" }, { tMs: 500, source: "scene" }, { tMs: 1000, source: "fps" }]); expect(media.encodes).toHaveLength(3);
  });
  it("retains the known strong same-histogram cut via the spatial fallback", async () => {
    const checker = (flip: boolean) => { const image = solid(0); for (let i = 0; i < 1024; i++) { const value = (i % 32 + Math.floor(i / 32) + Number(flip)) % 2 ? 255 : 0; image.set([value, value, value], 4 * i); } return image; };
    const media = mockMedia({ pixels: (t) => checker(t >= .5 && t < 1) }); const shots = await extractFrames(file(), 3);
    expect(shots.some((s) => s.tMs >= 500 && s.tMs < 1000)).toBe(true); expect(shots).toHaveLength(3); expect(media.encodes).toHaveLength(3);
  });
  it("a long synthetic duration encodes only max selected frames, not all fps/scene candidates", async () => {
    const media = mockMedia({ duration: 3600 }); const shots = await extractFrames(file(), 5);
    expect(media.samples).toBe(7200); expect(shots.map((s) => s.tMs)).toEqual([0, 720000, 1440000, 2160000, 2880000]); expect(media.encodes).toHaveLength(5); expect(media.seeks).toHaveLength(7205);
  });
  it("does not stop retaining cuts halfway through a dense 180-second video", async () => {
    const media = mockMedia({ duration: 180, pixels: (t) => solid(Math.floor(t * 2) % 2 ? 255 : 0) });
    const shots = await extractFrames(file(), 180);
    expect(shots).toHaveLength(180); expect(shots[0]!.tMs).toBe(500); expect(shots.at(-1)!.tMs).toBe(179500);
    expect(media.samples).toBe(360); expect(media.encodes).toHaveLength(180); expect(media.seeks.length).toBeLessThanOrEqual(540);
  });
  it("zero max avoids loading and invalid limits fail before a URL is created", async () => {
    const media = mockMedia(); expect(await extractFrames(file(), 0)).toEqual([]);
    for (const max of [-1, NaN, Infinity]) await expect(extractFrames(file(), max)).rejects.toThrow("frame_limit_invalid"); expect(media.create).not.toHaveBeenCalled();
  });
  it.each([0, .01, .1])("tiny/zero duration %f does not wait forever for a same-time seek", async (duration) => {
    const media = mockMedia({ duration }); const shots = await extractFrames(file(), 5); expect(shots).toHaveLength(duration ? 1 : 0); expect(media.revoke).toHaveBeenCalledOnce();
  });
  it.each([NaN, Infinity, -1])("invalid duration %f fails and releases the decoder", async (duration) => {
    const media = mockMedia({ duration }); await expect(extractFrames(file(), 5)).rejects.toThrow("video_duration_invalid"); expect(media.revoke).toHaveBeenCalledOnce(); expect(media.encodes).toHaveLength(0);
  });
  it.each(["error", "throw"] as const)("load %s propagates and revokes the original URL", async (load) => {
    const media = mockMedia({ load }); await expect(extractFrames(file(), 1)).rejects.toThrow("video_load_failed"); expect(media.revoke).toHaveBeenCalledExactlyOnceWith("blob:synthetic-scene");
  });
  it.each(["error", "throw"] as const)("seek %s propagates and releases resources", async (seek) => {
    const media = mockMedia({ seek }); await expect(extractFrames(file(), 1)).rejects.toThrow("video_seek_failed"); expect(media.revoke).toHaveBeenCalledOnce(); expect(media.encodes).toHaveLength(0);
  });
  it.each(["null", "throw"] as const)("JPEG %s is an extraction failure, not a false successful empty result", async (jpeg) => {
    const media = mockMedia({ jpeg }); await expect(extractFrames(file(), 1)).rejects.toThrow("frame_encode_failed"); expect(media.revoke).toHaveBeenCalledOnce(); expect(media.encodes).toHaveLength(1);
  });
  it.each(["load", "seek", "jpeg"] as const)("bounds a stalled %s operation and releases resources", async (stage) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); const media = mockMedia({ [stage]: "stall", duration: 1 });
    const result = extractFrames(file(), 1), rejected = expect(result).rejects.toThrow(stage === "load" ? "video_load_timeout" : stage === "seek" ? "video_seek_timeout" : "frame_encode_failed");
    if (stage === "seek") await until(() => media.seeks.length > 0); if (stage === "jpeg") await until(() => media.encodes.length > 0);
    await vi.advanceTimersByTimeAsync(stage === "load" ? VIDEO_LOAD_TIMEOUT_MS : FRAME_STEP_TIMEOUT_MS); await rejected; expect(media.revoke).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("canvas/progress failures also release the video", async () => {
    const first = mockMedia({ canvasMissing: true }); await expect(extractFrames(file(), 1)).rejects.toThrow("frame_canvas_unavailable"); expect(first.revoke).toHaveBeenCalledOnce();
    vi.restoreAllMocks(); vi.unstubAllGlobals(); const second = mockMedia(); await expect(extractFrames(file(), 1, () => { throw new Error("caller failed"); })).rejects.toThrow("caller failed"); expect(second.revoke).toHaveBeenCalledOnce();
  });
});
