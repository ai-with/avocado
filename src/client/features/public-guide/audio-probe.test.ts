import { afterEach, describe, expect, it, vi } from "vitest";
import { probeAudioTracks } from "./audio-probe";
import { extractAudioWav } from "./extract";
import { NO_AUDIO_PROOF } from "../../../shared/audio-analysis";

const join = (...parts: Uint8Array[]) => { const bytes = new Uint8Array(parts.reduce((n, part) => n + part.length, 0)); let offset = 0; parts.forEach((part) => { bytes.set(part, offset); offset += part.length; }); return bytes; };
const str = (value: string) => new TextEncoder().encode(value);
const words = (...values: number[]) => { const bytes = new Uint8Array(values.length * 4), view = new DataView(bytes.buffer); values.forEach((n, i) => view.setUint32(i * 4, n)); return bytes; };
function box(type: string, data: Uint8Array = new Uint8Array(), extended = false) {
  return extended ? join(words(1), str(type), words(0, data.length + 16), data) : join(words(data.length + 8), str(type), data);
}
const full = (type: string, ...data: Uint8Array[]) => box(type, join(words(0), ...data));
type Options = { audio?: boolean; handler?: string; tailMovie?: boolean; extended?: boolean; co64?: boolean; extra?: Uint8Array; offsetDelta?: number; external?: boolean; codec?: string; payload?: Uint8Array };
export function mp4Fixture(options: Options = {}) {
  const ftyp = box("ftyp", join(str("isom"), words(0), str("mp41"))), payload = options.payload ?? str("data");
  const timedHeader = (length: number) => { const bytes = new Uint8Array(length), view = new DataView(bytes.buffer); view.setUint32(12, 1000); view.setUint32(16, 1000); return bytes; };
  const handler = (type: string) => full("hdlr", words(0), str(type), new Uint8Array(12));
  const media = (type: string, children: Uint8Array = new Uint8Array()) => box("mdia", join(box("mdhd", timedHeader(24)), handler(type), children));
  const track = (metadata: Uint8Array, id = 1) => { const bytes = timedHeader(84); new DataView(bytes.buffer).setUint32(12, id); return box("trak", join(box("tkhd", bytes), metadata)); };
  const movie = (offset: number) => {
    const description = new Uint8Array(78); new DataView(description.buffer).setUint16(6, 1);
    const stbl = box("stbl", join(full("stsd", words(1), box(options.codec ?? "avc1", description)), full("stts", words(1, 1, 1000)),
      full("stsc", words(1, 1, 1, 1)), full("stsz", words(payload.length, 1)), options.co64 ? full("co64", words(1, 0, offset + (options.offsetDelta ?? 0))) : full("stco", words(1, offset + (options.offsetDelta ?? 0)))));
    const reference = box("url ", options.external ? words(0) : words(1));
    const minf = box("minf", join(box("vmhd", new Uint8Array(12)), box("dinf", full("dref", words(1), reference)), stbl));
    return box("moov", join(box("mvhd", timedHeader(100)), track(media(options.handler ?? "vide", minf)),
      ...(options.audio ? [track(media("soun"), 2)] : []), options.extra ?? new Uint8Array()), options.extended);
  };
  const mdat = box("mdat", payload), provisional = movie(0);
  const moov = movie(ftyp.length + (options.tailMovie ? 8 : provisional.length + 8));
  return options.tailMovie ? join(ftyp, mdat, moov) : join(ftyp, moov, mdat);
}
const file = (bytes = mp4Fixture()) => new File([bytes], "video.mp4", { type: "video/mp4" });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("정적 MP4/MOV positive no-audio probe", () => {
  it.each([{ }, { tailMovie: true }, { extended: true }, { co64: true }])("완전한 정적 트랙 목록·sample 범위 %j만 부재로 확인한다", async (options) => {
    expect(await probeAudioTracks(file(mp4Fixture(options)))).toEqual({ kind: "no_audio", proof: NO_AUDIO_PROOF });
  });
  it("QuickTime brand의 MOV도 같은 구조 검증을 통과해야 한다", async () => {
    const bytes = mp4Fixture(); bytes.set(str("qt  "), 8);
    expect((await probeAudioTracks(new File([bytes], "video.mov", { type: "video/quicktime" }))).kind).toBe("no_audio");
  });
  it("disabled audio도 존재로 보며 mdat 안 soun 문자열은 트랙으로 오인하지 않는다", async () => {
    expect(await probeAudioTracks(file(mp4Fixture({ audio: true })))).toEqual({ kind: "present" });
    expect(await probeAudioTracks(file(mp4Fixture({ payload: str("soun") })))).toEqual({ kind: "no_audio", proof: NO_AUDIO_PROOF });
  });
  it.each(["cmov", "rmra", "mvex"])("%s movie는 부재를 확정하지 않는다", async (type) => {
    expect((await probeAudioTracks(file(mp4Fixture({ extra: box(type) })))).kind).toBe("unavailable");
  });
  it.each([{ handler: "text" }, { external: true }, { codec: "encv" }, { offsetDelta: 1 }, { offsetDelta: -8 }])("지원 밖/외부참조/샘플 경계 %j는 unknown이다", async (options) => {
    expect((await probeAudioTracks(file(mp4Fixture(options)))).kind).toBe("unavailable");
  });
  it("잘린 moov/mdat·복수 moov·fragment·EOF-sized box·WebM은 none이 아니다", async () => {
    const bytes = mp4Fixture(), duplicate = box("moov", new Uint8Array(100));
    for (const bad of [bytes.slice(0, 30), bytes.slice(0, -1), join(bytes, duplicate), join(bytes, box("moof")), join(bytes, words(0), str("mdat")), words(0x1a45dfa3, 0)]) {
      expect((await probeAudioTracks(file(bad))).kind).toBe("unavailable");
    }
  });
  it("메타데이터 예산·read failure는 none이 아니며 payload 전체를 읽지 않는다", async () => {
    const valid = file(), slice = valid.slice.bind(valid), ranges: number[] = [];
    vi.spyOn(valid, "slice").mockImplementation((start, end) => { ranges.push((end ?? valid.size) - (start ?? 0)); return slice(start, end); });
    expect((await probeAudioTracks(valid)).kind).toBe("no_audio"); expect(Math.max(...ranges)).toBeLessThan(valid.size);
    const huge = join(box("ftyp", join(str("isom"), words(0))), box("moov", new Uint8Array(2 * 1024 ** 2 + 1)));
    expect(await probeAudioTracks(file(huge))).toMatchObject({ kind: "unavailable", reason: "probe_limit" });
    vi.spyOn(valid, "slice").mockImplementation(() => { throw new Error("private file failure"); });
    expect(await probeAudioTracks(valid)).toEqual({ kind: "unavailable", reason: "read_failed" });
  });
});

describe("audio extraction의 3가지 결과", () => {
  it("500MiB 상한보다 먼저 bounded 부재증거를 확인하되 크기만으로 none이 되지 않는다", async () => {
    const constructor = vi.fn(() => { throw new Error("decode must not start"); }); vi.stubGlobal("OfflineAudioContext", constructor);
    expect((await extractAudioWav(file())).kind).toBe("no_audio");
    const large = file(); Object.defineProperty(large, "size", { value: 500 * 1024 ** 2 + 1 });
    expect(await extractAudioWav(large)).toEqual({ kind: "unavailable", reason: "decode_limit" }); expect(constructor).not.toHaveBeenCalled();
    // Sparse virtual payload: the test allocates only metadata and header bytes.
    const bytes = mp4Fixture(), mdat = bytes.length - 12, size = 600 * 1024 ** 2;
    new DataView(bytes.buffer).setUint32(mdat, size - mdat);
    const sparse = file(bytes); Object.defineProperty(sparse, "size", { value: size });
    let read = 0;
    vi.spyOn(sparse, "slice").mockImplementation((start = 0, end = size) => {
      read += end - start; const range = new Uint8Array(end - start); range.set(bytes.subarray(start, Math.min(bytes.length, end))); return new Blob([range]);
    });
    const fullRead = vi.spyOn(sparse, "arrayBuffer").mockRejectedValue(new Error("full file read forbidden"));
    expect(await extractAudioWav(sparse)).toEqual({ kind: "no_audio", proof: NO_AUDIO_PROOF });
    expect(read).toBeLessThan(2048); expect(fullRead).not.toHaveBeenCalled(); expect(constructor).not.toHaveBeenCalled();
  });
  it("decode rejection은 트랙 부재가 아니며 all-zero PCM도 실제 audio다", async () => {
    const decode = vi.fn().mockRejectedValue(new DOMException("unsupported", "EncodingError"));
    vi.stubGlobal("OfflineAudioContext", class { decodeAudioData = decode; });
    expect(await extractAudioWav(file(mp4Fixture({ audio: true })))).toEqual({ kind: "unavailable", reason: "decode_failed" });
    decode.mockResolvedValue({ length: 4, numberOfChannels: 1, sampleRate: 16000, duration: 0.00025, getChannelData: () => new Float32Array(4) });
    expect(await extractAudioWav(file(mp4Fixture({ audio: true })))).toMatchObject({ kind: "audio", sampleRate: 16000 });
  });
});
