// Local encoded-media comparison for AIWITH-382. No browser, network or model.
// Run: node scripts/eval-frame-scenes.ts
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { frameTargets, retainSceneCut, sceneChanged, sceneSample, spatialLumaDifference, type FrameTarget, type SceneSample } from "../src/client/features/public-guide/frame-scenes.ts";
// Runtime-load real server pure functions. Their source is checked by the
// server TS project; the CLI does not need its Worker/Env global declarations.
const { sampleFrames, aggregateVotes } = await import(new URL("../src/server/pipeline/rules.ts", import.meta.url).href) as {
  sampleFrames<T extends { tMs: number }>(all: T[], n: number, window: null): T[];
  aggregateVotes(kind: "forbidden", votes: { frameId: string; yes: boolean; confidence: "high" }[], asked: number): { result: string };
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), ".."), FPS = 10, WIDTH = 64, SMALL = 32;
const SAMPLE_BYTES = SMALL * SMALL * 4, MAX_DECODE_BYTES = 8 * 1024 ** 2;
type Interval = readonly [number, number];
type Pattern = "static" | "light" | "strong_light" | "motion" | "color" | "integer" | "layout" | "pulse" | "dense";
type Clip = { name: string; duration: number; max: number; pattern: Pattern; golden: Interval[]; budget: "production" | "max1_contract" };
const CLIPS: Clip[] = [
  { name: "static_control", duration: 6, max: 180, pattern: "static", golden: [], budget: "production" },
  { name: "mild_light_control", duration: 6, max: 180, pattern: "light", golden: [], budget: "production" },
  { name: "strong_light_control", duration: 6, max: 180, pattern: "strong_light", golden: [], budget: "production" },
  { name: "strong_spatial_control", duration: 6, max: 180, pattern: "motion", golden: [], budget: "production" },
  { name: "isoluminant_brief", duration: 4, max: 180, pattern: "color", golden: [[500,1000]], budget: "production" },
  { name: "integer_stride_contract", duration: 4, max: 1, pattern: "integer", golden: [[1000,1500]], budget: "max1_contract" },
  { name: "equal_histogram_layout", duration: 6, max: 180, pattern: "layout", golden: [[500,1000]], budget: "production" },
  { name: "sub_sample_pulse_limit", duration: 4, max: 180, pattern: "pulse", golden: [[200,300]], budget: "production" },
  { name: "server_thinning_limit", duration: 30, max: 180, pattern: "color", golden: [[500,1000]], budget: "production" },
  { name: "dense_late_cap", duration: 180, max: 180, pattern: "dense", golden: [[179500,180000]], budget: "production" },
];
const inside = (time: number, intervals: readonly Interval[]) => intervals.some(([start,end]) => time >= start && time < end);
function requireValue(value: unknown, label: string): asserts value { if (!value) throw new Error(label); }
function outputFile(path: string, value: string) { writeFileSync(path, value, { flag: "wx", mode: 0o600 }); }
async function sha256(path: string) {
  const hash = createHash("sha256"); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest("hex");
}
function run(binary: "ffmpeg" | "ffprobe", args: string[], maxBuffer = 64 * 1024) {
  return execFileSync(binary, args, { timeout: 60_000, maxBuffer, stdio: ["ignore", "pipe", "pipe"] });
}

// Every pixel is procedural; no people, brands, fonts or third-party assets.
// Goldens are declared above before either selection algorithm is evaluated.
function rawFrame(clip: Clip, time: number): Buffer {
  const event = inside(time, clip.golden), pixels = Buffer.alloc(WIDTH * WIDTH * 4);
  let color: readonly number[] = [64,64,64];
  if (clip.pattern === "light") color = time >= 500 ? [96,96,96] : [64,64,64];
  if (clip.pattern === "strong_light") color = time >= 500 ? [192,192,192] : [64,64,64];
  if (clip.pattern === "color") color = event ? [0,130,0] : [255,0,0];
  if (clip.pattern === "integer" || clip.pattern === "pulse") color = clip.pattern === "integer" && event ? [255,255,255] : [0,0,0];
  if (clip.pattern === "dense") color = Math.floor(time / 500) % 2 ? [255,255,255] : [0,0,0];
  for (let y = 0; y < WIDTH; y++) for (let x = 0; x < WIDTH; x++) {
    const at = (y * WIDTH + x) * 4;
    if (clip.pattern === "layout" || clip.pattern === "motion") { const value = (Math.floor(x/2) + Math.floor(y/2) + Number(clip.pattern === "layout" ? event : time >= 500)) % 2 ? 255 : 0; pixels.set([value,value,value,255], at); }
    else pixels.set([...color,255], at);
    // A visible QA blue square in the upper left is the forbidden test object.
    // The layout control moves the same blue area from lower left, preserving
    // the global histogram while changing the labelled spatial relationship.
    if (x < 16 && (event && y < 16 || clip.pattern === "layout" && !event && y >= 48)) pixels.set([0,0,255,255], at);
  }
  return pixels;
}
function makeVideo(directory: string, clip: Clip) {
  const raw = join(directory, clip.name + ".rgba"), video = join(directory, clip.name + ".mp4");
  const fd = openSync(raw, "wx", 0o600);
  try { for (let frame = 0; frame < clip.duration * FPS; frame++) writeSync(fd, rawFrame(clip, frame * 1000 / FPS)); }
  finally { closeSync(fd); }
  run("ffmpeg", ["-nostdin", "-v", "error", "-n", "-protocol_whitelist", "file,pipe", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", `${WIDTH}x${WIDTH}`, "-framerate", String(FPS), "-i", raw,
    "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "10", "-g", "1", "-bf", "0", "-pix_fmt", "yuv420p", "-movflags", "+faststart", video]);
  chmodSync(video, 0o600);
  const probe = JSON.parse(run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,nb_frames,r_frame_rate:format=duration", "-of", "json", video]).toString()) as {
    streams: { codec_name: string; width: number; height: number; nb_frames: string; r_frame_rate: string }[]; format: { duration: string } };
  const stream = probe.streams[0];
  requireValue(stream?.codec_name === "h264" && stream.width === WIDTH && stream.height === WIDTH && Number(stream.nb_frames) === clip.duration * FPS && stream.r_frame_rate === "10/1" && Math.abs(Number(probe.format.duration) - clip.duration) < .01, "encoded_metadata_mismatch");
  const decoded = run("ffmpeg", ["-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-i", video, "-map", "0:v:0", "-vf", "scale=32:32:flags=neighbor", "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"], MAX_DECODE_BYTES);
  requireValue(decoded.length === clip.duration * FPS * SAMPLE_BYTES, "decoded_frame_count_mismatch");
  return { raw, video, probe, decoded };
}
function imageAt(decoded: Buffer, index: number) { return new Uint8ClampedArray(decoded.buffer, decoded.byteOffset + index * SAMPLE_BYTES, SAMPLE_BYTES); }
function blueMarker(pixels: Uint8ClampedArray) {
  const offset = (4 * SMALL + 4) * 4;
  return pixels[offset]! < 80 && pixels[offset+1]! < 80 && pixels[offset+2]! > 180;
}
const requestedTime = (t: number, duration: number) => Math.max(0, Math.min(Math.max(.01, t), Math.max(0, duration - .05)));
function sampleAt(decoded: Buffer, tMs: number, duration: number) {
  return imageAt(decoded, Math.floor(requestedTime(tMs / 1000, duration) * FPS + 1e-6));
}
function evaluate(clip: Clip, decoded: Buffer) {
  // Validate encoded visibility at every 100ms frame, including the pulse that
  // lies entirely between the FE's 500ms sampling instants.
  for (let i = 0; i < clip.duration * FPS; i++) requireValue(blueMarker(imageAt(decoded, i)) === inside(i * 1000 / FPS, clip.golden), "encoded_golden_visibility_mismatch");
  const fps: FrameTarget[] = [], legacyScene: FrameTarget[] = [], firstCuts: number[] = [], balancedCuts: number[] = [];
  let previous: SceneSample | null = null, legacyEncodes = 0, maxRetained = 0;
  for (let tMs = 0; tMs < clip.duration * 1000; tMs += 500) {
    const image = sampleAt(decoded, tMs, clip.duration), current = sceneSample(image);
    const oldCut = previous !== null && spatialLumaDifference(image, previous.pixels) > 30;
    const changed = sceneChanged(current, previous); previous = current;
    if (tMs % 1000 === 0) fps.push({ tMs, source: "fps", cut: false });
    else if (oldCut) legacyScene.push({ tMs, source: "scene", cut: true });
    if (tMs % 1000 === 0 || oldCut) legacyEncodes++;
    if (changed) {
      if (firstCuts.length < clip.max) firstCuts.push(tMs);
      retainSceneCut(balancedCuts, tMs, clip.max); maxRetained = Math.max(maxRetained, balancedCuts.length);
    }
  }
  // Frozen legacy selection from 47b470e^: extract.ts (luma>30, scene-first,
  // integer fps stride). No historical DOM/codec implementation is executed.
  const keepScene = legacyScene.slice(0, clip.max), budget = clip.max - keepScene.length;
  const stride = budget > 0 ? Math.ceil(fps.length / budget) : Infinity;
  const legacy = [...keepScene, ...fps.filter((_, i) => i % stride === 0).slice(0, budget)].sort((a,b) => a.tMs-b.tMs);
  const variants = { legacy_luma: legacy, histogram_first_cap: frameTargets(clip.duration, clip.max, firstCuts), histogram_balanced: frameTargets(clip.duration, clip.max, balancedCuts) };
  const metrics = Object.fromEntries(Object.entries(variants).map(([name, selected]) => {
    requireValue(selected.length <= clip.max && new Set(selected.map((s) => s.tMs)).size === selected.length && maxRetained <= clip.max, "selection_bound_or_dedup_failure");
    const modelInputs = sampleFrames(selected, 12, null);
    const covered = (rows: { tMs: number }[]) => clip.golden.filter(([start,end]) => rows.some((r) => r.tMs >= start && r.tMs < end)).length;
    const missedIds = (rows: { tMs: number }[]) => clip.golden.flatMap(([start,end], index) => rows.some((r) => r.tMs >= start && r.tMs < end) ? [] : [`${clip.name}:${index+1}`]);
    // This oracle reads the decoded blue marker, not a model response. It tests
    // the real sampling and aggregateVotes path while holding perception fixed.
    const votes = modelInputs.map((r) => ({ frameId: String(r.tMs), yes: blueMarker(sampleAt(decoded, r.tMs, clip.duration)), confidence: "high" as const }));
    const verdict = aggregateVotes("forbidden", votes, votes.length);
    return [name, { selectedFrames: selected.length, modelInputFrames: modelInputs.length, selectedTimesMs: selected.map((s) => s.tMs), modelInputTimesMs: modelInputs.map((s) => s.tMs),
      goldenSegments: clip.golden.length, selectedSegmentCoverage: covered(selected), selectedSegmentMisses: clip.golden.length - covered(selected), modelInputSegmentCoverage: covered(modelInputs), modelInputSegmentMisses: clip.golden.length - covered(modelInputs),
      selectedMissedSegmentIds: missedIds(selected), modelInputMissedSegmentIds: missedIds(modelInputs),
      oracleRuleResult: verdict.result, oracleCaseMiss: clip.golden.length > 0 && verdict.result !== "candidate", modeledJpegOperations: name === "legacy_luma" ? legacyEncodes : selected.length,
      seekUpperBound: Math.ceil(clip.duration / .5) + (name === "legacy_luma" ? 0 : selected.length) }];
  }));
  return { name: clip.name, budget: clip.budget, durationS: clip.duration, maxFrames: clip.max, goldenIntervalsMs: clip.golden,
    maxRetainedCutTimes: maxRetained, encodedGoldenFramesChecked: clip.duration * FPS, metrics };
}

async function main() {
  const privateRoot = join(ROOT, ".agent_work");
  if (existsSync(privateRoot)) requireValue(lstatSync(privateRoot).isDirectory() && !lstatSync(privateRoot).isSymbolicLink(), "private_output_root_invalid");
  else mkdirSync(privateRoot, { mode: 0o700 });
  const directory = join(privateRoot, "scene-382-evaluation-" + randomUUID()); mkdirSync(directory, { mode: 0o700 });
  const reports = [], files = [];
  for (const clip of CLIPS) {
    const result = makeVideo(directory, clip); reports.push(evaluate(clip, result.decoded));
    files.push({ name: clip.name, rawSha256: await sha256(result.raw), videoSha256: await sha256(result.video), videoBytes: lstatSync(result.video).size, probe: result.probe });
  }
  const dense = reports.find((r) => r.name === "dense_late_cap")!;
  const before = dense.metrics.histogram_first_cap as { modelInputSegmentMisses: number }, after = dense.metrics.histogram_balanced as { modelInputSegmentMisses: number };
  requireValue(before.modelInputSegmentMisses === 1 && after.modelInputSegmentMisses === 0, "dense_late_cap_not_demonstrated");
  const sources = ["src/client/features/public-guide/frame-scenes.ts", "src/client/features/public-guide/extract.ts", "src/server/pipeline/rules.ts", "scripts/eval-frame-scenes.ts"];
  const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async (path) => [path, await sha256(join(ROOT, path))])));
  const report = { v: 1, label: "encoded_synthetic_sampling_oracle_comparison", sourceHashes, ffmpeg: run("ffmpeg", ["-version"]).toString().split("\n")[0], ffprobe: run("ffprobe", ["-version"]).toString().split("\n")[0],
    provenance: "Original procedural project QA content; no third-party footage, people, brands, fonts or external assets", forbiddenTestRule: "QA blue square in upper left", fps: FPS, encodedSize: [WIDTH,WIDTH], decodedSampleSize: [SMALL,SMALL],
    maxDecodedBufferBytes: MAX_DECODE_BYTES, decodeScaling: "FFmpeg nearest-neighbor; browser canvas/codec/seek equivalence unmeasured", serverSampling: "actual sampleFrames(...,12,null), no opening-window rule", realModelCalls: 0, realAiAccuracy: null, nativeBrowserValidated: false,
    limitations: ["Oracle uses decoded H264 RGBA pixels of one controlled geometric object; it does not estimate real AI accuracy", "Sampling misses and server resampling misses are reported separately", "JPEG operations are modeled; JPEG encoding is not executed", "Sub-500ms events and budget-induced misses remain visible", "Small max values may retain temporally biased cuts; uniform spacing is not guaranteed", "No browser, provider, remote upload or production data is used"], files, reports };
  outputFile(join(directory, "report.json"), JSON.stringify(report, null, 2) + "\n");
  outputFile(join(directory, "manifest.json"), JSON.stringify({ clips: CLIPS, files, sourceHashes }, null, 2) + "\n");
  const columns = ["case", "variant", "selected_frames", "model_inputs", "golden_segments", "selected_misses", "model_input_misses", "oracle_result", "oracle_case_miss", "modeled_jpeg_operations"];
  const csv = [columns.join(","), ...reports.flatMap((row) => Object.entries(row.metrics).map(([variant, value]) => {
    const m = value as { selectedFrames: number; modelInputFrames: number; goldenSegments: number; selectedSegmentMisses: number; modelInputSegmentMisses: number; oracleRuleResult: string; oracleCaseMiss: boolean; modeledJpegOperations: number };
    return [row.name,variant,m.selectedFrames,m.modelInputFrames,m.goldenSegments,m.selectedSegmentMisses,m.modelInputSegmentMisses,m.oracleRuleResult,m.oracleCaseMiss,m.modeledJpegOperations].join(",");
  }))].join("\n") + "\n";
  outputFile(join(directory, "comparison.csv"), csv);
  console.log(JSON.stringify({ ok: true, output: directory, encodedClips: reports.length, goldenFramesVerified: reports.reduce((n,r) => n+r.encodedGoldenFramesChecked, 0), realModelCalls: 0, realAiAccuracy: null }));
}
await main();
