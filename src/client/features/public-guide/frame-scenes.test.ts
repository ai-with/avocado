import { describe, expect, it } from "vitest";
import { colorHistogram, frameTargets, histogramDistance, HISTOGRAM_BINS, retainSceneCut, sceneChanged, sceneSample, SCENE_HISTOGRAM_THRESHOLD, SCENE_SPATIAL_THRESHOLD, spatialLumaDifference, type SceneSample } from "./frame-scenes";

type Color = readonly [number, number, number];
const RED: Color = [255, 0, 0], GREEN: Color = [0, 130, 0];
const solid = (color: Color) => pixels(() => color);
function pixels(at: (x: number, y: number) => Color) {
  const result = new Uint8ClampedArray(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const offset = 4 * (y * 32 + x); result.set([...at(x, y), 255], offset); }
  return result;
}
const checker = (flip = false) => pixels((x, y) => (x + y + Number(flip)) % 2 ? [255, 255, 255] : [0, 0, 0]);
const moderateChecker = (flip = false) => pixels((x, y) => (x + y + Number(flip)) % 2 ? [128, 128, 128] : [64, 64, 64]);
const distance = (a: Uint8ClampedArray, b: Uint8ClampedArray) => histogramDistance(colorHistogram(b), colorHistogram(a));
describe("RGB cumulative histogram scene distance", () => {
  it("normalizes each channel, ignores alpha and treats the first sample as no cut", () => {
    const input = checker(), histogram = colorHistogram(input);
    for (let channel = 0; channel < 3; channel++) expect(histogram.slice(channel * HISTOGRAM_BINS, (channel + 1) * HISTOGRAM_BINS).reduce((sum, n) => sum + n, 0)).toBe(1);
    expect(histogramDistance(histogram, null)).toBe(0); expect(histogramDistance(histogram, histogram)).toBe(0);
    const transparent = input.slice(); for (let i = 3; i < transparent.length; i += 4) transparent[i] = 0; expect(distance(input, transparent)).toBe(0);
  });
  it("pixel rearrangement is invariant, which helps motion but also misses equal-histogram cuts", () => {
    expect(distance(checker(), checker(true))).toBe(0);
  });
  it("uses a conservative spatial fallback to retain strong same-histogram cuts, also admitting strong motion", () => {
    expect(sceneChanged(sceneSample(checker(true)), sceneSample(checker()))).toBe(true);
    expect(sceneChanged(sceneSample(moderateChecker(true)), sceneSample(moderateChecker()))).toBe(false);
    expect(spatialLumaDifference(moderateChecker(), moderateChecker(true))).toBeCloseTo(64);
    expect(sceneChanged(sceneSample(solid([0, 0, 0])), null)).toBe(false);
    expect(SCENE_SPATIAL_THRESHOLD).toBeGreaterThan(30);
  });
  it("small lighting changes move nearby bins smoothly while a large exposure change can trigger", () => {
    expect(distance(solid([64, 64, 64]), solid([96, 96, 96]))).toBeCloseTo(2 / 15);
    expect(distance(solid([64, 64, 64]), solid([96, 96, 96]))).toBeLessThan(SCENE_HISTOGRAM_THRESHOLD);
    expect(distance(solid([64, 64, 64]), solid([192, 192, 192]))).toBeGreaterThan(SCENE_HISTOGRAM_THRESHOLD);
  });
  it("detects abrupt color cuts even when the legacy gray luma is nearly equal", () => {
    expect(distance(solid(RED), solid(GREEN))).toBeCloseTo(23 / 45);
    expect(distance(solid([0, 0, 0]), solid([255, 255, 255]))).toBe(1);
  });
  it("keeps the strict technical threshold boundary and rejects invalid pixel shapes", () => {
    expect(distance(solid([0, 0, 0]), solid([48, 48, 48]))).toBe(SCENE_HISTOGRAM_THRESHOLD);
    expect(distance(solid([0, 0, 0]), solid([48, 48, 48])) > SCENE_HISTOGRAM_THRESHOLD).toBe(false);
    expect(() => colorHistogram(new Uint8ClampedArray())).toThrow("scene_pixels_invalid"); expect(() => colorHistogram(new Uint8ClampedArray(3))).toThrow("scene_pixels_invalid");
  });
});
describe("bounded frame target union", () => {
  it("preserves the legacy uniform fps stride when no cut needs priority", () => {
    expect(frameTargets(10, 3, []).map((r) => r.tMs)).toEqual([0, 4000, 8000]);
    expect(frameTargets(1.01, 20, []).map((r) => r.tMs)).toEqual([0, 1000]); expect(frameTargets(1, 20, []).map((r) => r.tMs)).toEqual([0]);
  });
  it("prioritizes cuts, keeps integer-second fps labels and never duplicates union timestamps", () => {
    expect(frameTargets(4, 1, [1000, 1500])).toEqual([{ tMs: 1000, source: "fps", cut: true }]);
    const rows = frameTargets(4, 10, [500, 1000, 1000]); expect(rows.map((r) => r.tMs)).toEqual([0, 500, 1000, 2000, 3000]); expect(rows.find((r) => r.tMs === 500)?.source).toBe("scene"); expect(new Set(rows.map((r) => r.tMs)).size).toBe(rows.length);
  });
  it("retains at most max candidates even for long duration and dense cuts", () => {
    const selected = frameTargets(3600, 5, []); expect(selected).toHaveLength(5); expect(selected.map((r) => r.tMs)).toEqual([0, 720000, 1440000, 2160000, 2880000]);
    expect(frameTargets(180, 3, [500, 1000, 1500, 2000])).toHaveLength(3);
  });
  it("keeps sparse cuts and the first/latest dense cuts within a bounded chronological set", () => {
    const cuts: number[] = [];
    for (const t of [500, 2000, 3000]) retainSceneCut(cuts, t, 4);
    expect(cuts).toEqual([500, 2000, 3000]); retainSceneCut(cuts, 2000, 4); expect(cuts).toHaveLength(3);
    for (let t = 3500; t < 180000; t += 500) { retainSceneCut(cuts, t, 4); expect(cuts.length).toBeLessThanOrEqual(4); }
    expect(cuts[0]).toBe(500); expect(cuts.at(-1)).toBe(179500); expect(cuts).toEqual([...cuts].sort((a,b) => a-b));
    expect(new Set(cuts).size).toBe(cuts.length); expect(cuts.some((t) => t > 90000 && t < 179500)).toBe(true);
    const single: number[] = []; for (const t of [1000, 1500, 5000]) retainSceneCut(single, t, 1); expect(single).toEqual([1000]);
    expect(() => retainSceneCut([], -1, 4)).toThrow("frame_time_invalid");
  });
  it("preserves a late golden forbidden segment after the production 180-frame cut cap and server sampling", async () => {
    // Runtime-load the actual server pure functions without bringing Worker Env
    // globals into the client's DOM typechecking project.
    const { sampleFrames, aggregateVotes } = await import(new URL("../../../server/pipeline/rules.ts", import.meta.url).href) as {
      sampleFrames<T extends { tMs: number }>(all: T[], n: number, window: null): T[];
      aggregateVotes(kind: "forbidden", votes: { frameId: string; yes: boolean; confidence: "high" }[], asked: number): { result: string };
    };
    const cuts: number[] = [];
    for (let t = 500; t < 180000; t += 500) retainSceneCut(cuts, t, 180);
    const selected = frameTargets(180, 180, cuts), modelInputs = sampleFrames(selected, 12, null);
    expect(selected).toHaveLength(180); expect(selected.at(-1)?.tMs).toBe(179500);
    expect(modelInputs.at(-1)?.tMs).toBe(179500);
    // Deterministic oracle: tests sampling/aggregation, not AI perception.
    const votes = modelInputs.map((f) => ({ frameId: String(f.tMs), yes: f.tMs >= 179500, confidence: "high" as const }));
    expect(aggregateVotes("forbidden", votes, modelInputs.length).result).toBe("candidate");
    const before = frameTargets(180, 180, Array.from({ length: 180 }, (_, i) => (i+1)*500));
    expect(before.at(-1)?.tMs).toBe(90000);
    expect(aggregateVotes("forbidden", sampleFrames(before, 12, null).map((f) => ({ frameId: String(f.tMs), yes: f.tMs >= 179500, confidence: "high" as const })), 12).result).toBe("compliant");
  });
  it("handles zero, invalid limits, duration and out-of-range cut times explicitly", () => {
    expect(frameTargets(10, 0, [500])).toEqual([]); expect(frameTargets(0, 5, [])).toEqual([]);
    for (const max of [-1, NaN, Infinity, 1.5]) expect(() => frameTargets(1, max, [])).toThrow("frame_limit_invalid");
    for (const duration of [-1, NaN, Infinity]) expect(() => frameTargets(duration, 1, [])).toThrow("video_duration_invalid");
    expect(() => frameTargets(1, 1, [1000])).toThrow("frame_time_invalid");
  });
});

// Reproducible synthetic proxy report only. No real video or violation labels.
function legacyLuma(current: Uint8ClampedArray, previous: Uint8ClampedArray | null) {
  if (!previous) return 0; let value = 0;
  for (let i = 0; i < current.length; i += 4) value += Math.abs(current[i]! * .3 + current[i + 1]! * .59 + current[i + 2]! * .11 - previous[i]! * .3 - previous[i + 1]! * .59 - previous[i + 2]! * .11);
  return value / (current.length / 4);
}
it("reports frame count, JPEG/seek work and known synthetic interval coverage without claiming violation recall", () => {
  const clips = [
    { name: "strong_motion_fallback_tradeoff", at: (t: number) => checker(t >= .5), intervals: [] as [number, number][], max: 3 },
    { name: "moderate_motion", at: (t: number) => moderateChecker(t >= .5), intervals: [] as [number, number][], max: 3 },
    { name: "moderate_light", at: (t: number) => solid(t >= .5 ? [96, 96, 96] : [64, 64, 64]), intervals: [] as [number, number][], max: 3 },
    { name: "strong_light_limit", at: (t: number) => solid(t >= .5 ? [192, 192, 192] : [64, 64, 64]), intervals: [] as [number, number][], max: 3 },
    { name: "equal_luma_brief_color", at: (t: number) => solid(t >= .5 && t < 1 ? GREEN : RED), intervals: [[500, 1000]] as [number, number][], max: 3 },
    { name: "integer_cut_stride", at: (t: number) => solid(t >= 1 && t < 1.5 ? [255, 255, 255] : [0, 0, 0]), intervals: [[1000, 1500]] as [number, number][], max: 1 },
    { name: "same_histogram_cut_fallback", at: (t: number) => checker(t >= .5 && t < 1), intervals: [[500, 1000]] as [number, number][], max: 3 },
    { name: "sub_half_second_limit", at: (t: number) => solid(t >= .2 && t < .3 ? [255, 255, 255] : [0, 0, 0]), intervals: [[200, 300]] as [number, number][], max: 3 },
  ];
  const report = clips.map((clip) => {
    const fps: number[] = [], scene: number[] = [], cuts: number[] = []; let previous: Uint8ClampedArray | null = null, previousSample: SceneSample | null = null, oldJpeg = 0;
    for (let t = 0; t < 4; t += .5) {
      const image = clip.at(t), sample = sceneSample(image), oldCut = legacyLuma(image, previous) > 30;
      if (Number.isInteger(t)) fps.push(t * 1000); else if (oldCut) scene.push(t * 1000);
      if (Number.isInteger(t) || oldCut) oldJpeg++;
      if (sceneChanged(sample, previousSample)) retainSceneCut(cuts, t * 1000, clip.max);
      previous = image; previousSample = sample;
    }
    const oldScene = scene.slice(0, clip.max), budget = clip.max - oldScene.length, stride = budget ? Math.ceil(fps.length / budget) : Infinity;
    const oldTimes = [...oldScene, ...fps.filter((_, i) => i % stride === 0).slice(0, budget)], selected = frameTargets(4, clip.max, cuts);
    const covered = (times: number[]) => clip.intervals.length ? clip.intervals.filter(([start, end]) => times.some((t) => t >= start && t < end)).length : null;
    return { fixture: clip.name, syntheticIntervals: clip.intervals.length, legacy: { frames: oldTimes.length, jpegCalls: oldJpeg, seekRequests: 8, intervalCoverage: covered(oldTimes) }, histogram: { frames: selected.length, fps: selected.filter((r) => r.source === "fps").length, scene: selected.filter((r) => r.source === "scene").length, jpegCalls: selected.length, seekRequestsUpperBound: 8 + selected.length, intervalCoverage: covered(selected.map((r) => r.tMs)) } };
  });
  expect(report.find((r) => r.fixture === "equal_luma_brief_color")).toMatchObject({ legacy: { intervalCoverage: 0 }, histogram: { intervalCoverage: 1 } });
  expect(report.find((r) => r.fixture === "integer_cut_stride")).toMatchObject({ legacy: { intervalCoverage: 0 }, histogram: { intervalCoverage: 1 } });
  expect(report.find((r) => r.fixture === "same_histogram_cut_fallback")).toMatchObject({ legacy: { intervalCoverage: 1 }, histogram: { intervalCoverage: 1 } });
  expect(report.find((r) => r.fixture === "sub_half_second_limit")).toMatchObject({ legacy: { intervalCoverage: 0 }, histogram: { intervalCoverage: 0 } });
  expect(report.every((r) => r.legacy.intervalCoverage === null || r.histogram.intervalCoverage! >= r.legacy.intervalCoverage)).toBe(true);
  console.info("[scene_synthetic_proxy_only]", JSON.stringify({ histogramThreshold: SCENE_HISTOGRAM_THRESHOLD, spatialFallbackThreshold: SCENE_SPATIAL_THRESHOLD, binsPerChannel: HISTOGRAM_BINS, notViolationRecall: true, report }));
});
