import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendAnalysis } from "./sendAnalysis";
import { NO_AUDIO_PROOF, type AudioExtraction } from "../../../shared/audio-analysis";

const extract = vi.hoisted(() => ({ frames: vi.fn(), audio: vi.fn() }));
vi.mock("./extract", () => ({ extractFrames: extract.frames, extractAudioWav: extract.audio }));
let requests: { path: string; body: BodyInit | null | undefined }[];
beforeEach(() => {
  requests = []; extract.frames.mockResolvedValue([{ tMs: 0, source: "fps", blob: new Blob(["jpeg"], { type: "image/jpeg" }) }]);
  extract.audio.mockResolvedValue({ kind: "no_audio", proof: NO_AUDIO_PROOF } satisfies AudioExtraction);
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => { requests.push({ path: String(input), body: init?.body }); return Response.json({ ok: true }); }));
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
const run = () => sendAnalysis("/api/public/upload/capability", "submission", new File(["video"], "video.mp4"), 180, vi.fn());

describe("프레임 완료 뒤 분석 receipt", () => {
  it("frame ACK 전에는 audio 추출이나 no-audio receipt를 보내지 않는다", async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce((_input, init) => { requests.push({ path: "frames", body: init?.body }); return new Promise((resolve) => { finish = resolve; }); });
    const pending = run(); await vi.waitFor(() => expect(finish).toBeDefined());
    expect(extract.audio).not.toHaveBeenCalled(); expect(requests).toHaveLength(1); finish(Response.json({ ok: true }));
    expect(await pending).toBe(false); expect(requests).toHaveLength(2);
    expect(JSON.parse(String(requests[1]!.body))).toEqual({ submissionId: "submission", frameCount: 1, outcome: { kind: "no_audio", proof: NO_AUDIO_PROOF } });
  });
  it("프레임 실패/0프레임은 no-audio 완료로 서버를 깨우지 않는다", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 })); expect(await run()).toBe(true); expect(fetch).toHaveBeenCalledTimes(2);
    requests = []; vi.mocked(fetch).mockClear(); extract.frames.mockResolvedValue([]); expect(await run()).toBe(true); expect(fetch).not.toHaveBeenCalled();
  });
  it("decode/size unavailable 이유를 보존하며 no-audio로 바꾸지 않는다", async () => {
    extract.audio.mockResolvedValue({ kind: "unavailable", reason: "decode_limit" }); expect(await run()).toBe(true);
    expect(JSON.parse(String(requests[1]!.body)).outcome).toEqual({ kind: "unavailable", reason: "decode_limit" });
  });
  it("Queue 응답 실패는 같은 receipt를 한번 재시도한다", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!; let attempts = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith("analysis-complete") && attempts++ === 0) { requests.push({ path: String(input), body: init?.body }); return new Response(null, { status: 503 }); }
      return original(input, init);
    });
    expect(await run()).toBe(false); expect(requests).toHaveLength(3); expect(requests[1]).toEqual(requests[2]);
  });
  it("실 audio는 WAV endpoint를 쓰며 decoder exception은 완료 receipt가 아니다", async () => {
    extract.audio.mockResolvedValue({ kind: "audio", blob: new Blob(["wav"]), sampleRate: 16000, durationS: 1 }); expect(await run()).toBe(false);
    expect(requests[1]!.path.endsWith("/audio")).toBe(true); expect(requests[1]!.body).toBeInstanceOf(FormData);
    expect((requests[1]!.body as FormData).get("frameHandshakeVersion")).toBe("1"); expect((requests[1]!.body as FormData).get("frameCount")).toBe("1");
    extract.audio.mockRejectedValue(new Error("decoder failure")); requests = []; expect(await run()).toBe(true); expect(requests).toHaveLength(1);
  });
  it("partial frame failure marks a versioned audio upload without claiming frame completion", async () => {
    extract.audio.mockResolvedValue({ kind: "audio", blob: new Blob(["wav"]), sampleRate: 16000, durationS: 1 });
    vi.mocked(fetch).mockImplementation(async (input, init) => { requests.push({ path: String(input), body: init?.body }); return new Response(null, { status: String(input).endsWith("/frames") ? 503 : 201 }); });
    expect(await run()).toBe(true); const audio = requests.find((r) => r.path.endsWith("/audio"))!.body as FormData;
    expect(audio.get("frameHandshakeVersion")).toBe("1"); expect(audio.has("frameCount")).toBe(false);
  });
});
