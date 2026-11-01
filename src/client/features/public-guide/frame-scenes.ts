export const HISTOGRAM_BINS = 16;
// Average RGB cumulative-histogram distance, normalized to [0, 1].
// 0.20 is a technical starting point, not a calibrated violation-recall target.
export const SCENE_HISTOGRAM_THRESHOLD = 0.20;
// Conservative fallback for strong spatial changes with the same distribution.
// It also admits strong motion: pixels alone cannot distinguish these cases.
export const SCENE_SPATIAL_THRESHOLD = 96;

export function colorHistogram(pixels: Uint8ClampedArray): Float64Array {
  if (!pixels.length || pixels.length % 4) throw new Error("scene_pixels_invalid");
  const histogram = new Float64Array(3 * HISTOGRAM_BINS), weight = 4 / pixels.length;
  for (let i = 0; i < pixels.length; i += 4) for (let channel = 0; channel < 3; channel++) histogram[channel * HISTOGRAM_BINS + (pixels[i + channel]! >>> 4)]! += weight;
  return histogram;
}
export function histogramDistance(current: Float64Array, previous: Float64Array | null): number {
  if (!previous) return 0;
  if (current.length !== 3 * HISTOGRAM_BINS || previous.length !== current.length) throw new Error("scene_histogram_invalid");
  let distance = 0;
  for (let channel = 0; channel < 3; channel++) {
    let cumulative = 0;
    for (let bin = 0; bin < HISTOGRAM_BINS - 1; bin++) {
      const index = channel * HISTOGRAM_BINS + bin;
      cumulative += current[index]! - previous[index]!;
      distance += Math.abs(cumulative);
    }
  }
  return Math.min(1, distance / (3 * (HISTOGRAM_BINS - 1)));
}
export type SceneSample = { pixels: Uint8ClampedArray; histogram: Float64Array };
export const sceneSample = (pixels: Uint8ClampedArray): SceneSample => ({ pixels, histogram: colorHistogram(pixels) });
export function spatialLumaDifference(current: Uint8ClampedArray, previous: Uint8ClampedArray): number {
  if (!current.length || current.length % 4 || previous.length !== current.length) throw new Error("scene_pixels_invalid");
  let value = 0;
  for (let i = 0; i < current.length; i += 4) value += Math.abs(current[i]! * .3 + current[i + 1]! * .59 + current[i + 2]! * .11 - previous[i]! * .3 - previous[i + 1]! * .59 - previous[i + 2]! * .11);
  return value / (current.length / 4);
}
export function sceneChanged(current: SceneSample, previous: SceneSample | null): boolean {
  return previous !== null && (histogramDistance(current.histogram, previous.histogram) > SCENE_HISTOGRAM_THRESHOLD || spatialLumaDifference(current.pixels, previous.pixels) > SCENE_SPATIAL_THRESHOLD);
}
export type FrameTarget = { tMs: number; source: "fps" | "scene"; cut: boolean };
export function validateFrameLimit(max: number) {
  if (!Number.isSafeInteger(max) || max < 0) throw new Error("frame_limit_invalid");
}
export function validateFrameDuration(durationS: number) {
  if (!Number.isFinite(durationS) || durationS < 0 || !Number.isSafeInteger(Math.ceil(durationS))) throw new Error("video_duration_invalid");
}
// Keep sparse cuts unchanged. Once full, compact the densest interior time span
// instead of keeping only the beginning of a long video. First/latest survive
// for max>=2; max=1 keeps its existing first-cut contract. At most max+1 numeric
// timestamps exist during insertion, and at most max remain on return.
export function retainSceneCut(cuts: number[], tMs: number, max: number): void {
  validateFrameLimit(max);
  if (!Number.isSafeInteger(tMs) || tMs < 0) throw new Error("frame_time_invalid");
  if (!max || cuts.includes(tMs) || max === 1 && cuts.length) return;
  const next = cuts.findIndex((time) => time > tMs);
  cuts.splice(next < 0 ? cuts.length : next, 0, tMs);
  if (cuts.length <= max) return;
  let remove = 1, span = Infinity;
  for (let i = 1; i < cuts.length - 1; i++) {
    const around = cuts[i + 1]! - cuts[i - 1]!;
    if (around < span) { remove = i; span = around; }
  }
  cuts.splice(remove, 1);
}
// Only metadata is retained during scanning. Integer-second cuts keep their
// existing public 'fps' label, but cut priority prevents stride from losing them.
export function frameTargets(durationS: number, max: number, cutTimesMs: readonly number[]): FrameTarget[] {
  validateFrameLimit(max);
  validateFrameDuration(durationS);
  if (!max || !durationS) return [];
  const cuts: number[] = [];
  for (const t of cutTimesMs) {
    if (!Number.isSafeInteger(t) || t < 0 || t >= durationS * 1000) throw new Error("frame_time_invalid");
    retainSceneCut(cuts, t, max);
  }
  const reserved = cuts.filter((t) => t % 1000 === 0).map((t) => t / 1000);
  const count = Math.ceil(durationS) - reserved.length, budget = max - cuts.length, stride = budget > 0 ? Math.ceil(count / budget) : Infinity;
  const result: FrameTarget[] = cuts.map((tMs) => ({ tMs, source: tMs % 1000 === 0 ? "fps" : "scene", cut: true }));
  for (let index = 0; budget > 0 && index < count && result.length < max; index += stride) {
    let second = index;
    for (const cut of reserved) { if (cut <= second) second++; else break; }
    result.push({ tMs: second * 1000, source: "fps", cut: false });
  }
  return result.sort((a, b) => a.tMs - b.tMs);
}
