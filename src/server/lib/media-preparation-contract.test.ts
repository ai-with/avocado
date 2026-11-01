import { describe, expect, it, vi } from "vitest";
import { boundedMediaStream, PREPARATION_CAPS } from "./media-preparation-contract";

const BATCH = PREPARATION_CAPS.chunkBytes;
type Mode = "native" | "standard" | "short" | "default";
function virtual(total: number, mode: Mode, small = 16 * 1024) {
  let offset = 0, pulls = 0;
  const cancel = vi.fn(), readAtLeast = vi.fn(), read = vi.fn();
  const byteSource: UnderlyingByteSource = { type: "bytes", pull(controller) {
    pulls++;
    if (offset === total) { controller.close(); controller.byobRequest?.respond(0); return; }
    const n = Math.min(small, total - offset), target = controller.byobRequest?.view;
    if (target) {
      const count = Math.min(n, target.byteLength), view = new Uint8Array(target.buffer, target.byteOffset, count);
      for (let i = 0; i < count; i++) view[i] = (offset + i) % 251;
      offset += count; controller.byobRequest!.respond(count);
    } else {
      const view = new Uint8Array(n); for (let i = 0; i < n; i++) view[i] = (offset + i) % 251;
      offset += n; controller.enqueue(view);
    }
  }, cancel };
  const stream = mode === "default" ? new ReadableStream<Uint8Array>({ pull(controller) {
    pulls++; if (offset === total) { controller.close(); return; }
    const view = new Uint8Array(Math.min(small, total - offset));
    for (let i = 0; i < view.length; i++) view[i] = (offset + i) % 251;
    offset += view.length; controller.enqueue(view);
  }, cancel }, { highWaterMark: 0 }) : new ReadableStream(byteSource);
  const getReader = stream.getReader.bind(stream);
  vi.spyOn(stream, "getReader").mockImplementation(((options?: ReadableStreamGetReaderOptions) => {
    const reader = getReader(options as { mode: "byob" });
    if (options?.mode === "byob") {
      const original = reader.read.bind(reader);
      if (mode === "native") Object.defineProperty(reader, "readAtLeast", { value: (minimum: number, view: Uint8Array) => {
        readAtLeast(minimum, view.byteLength);
        return (original as unknown as (view: Uint8Array, options: { min: number }) => Promise<ReadableStreamReadResult<Uint8Array>>)(view, { min: minimum });
      } });
      else vi.spyOn(reader, "read").mockImplementation(((view: Uint8Array, opts?: { min: number }) => {
        read(view.byteLength, opts?.min); return (original as unknown as (view: Uint8Array, options?: { min: number }) => Promise<ReadableStreamReadResult<Uint8Array>>)(view, mode === "short" ? undefined : opts);
      }) as typeof reader.read);
    }
    return reader;
  }) as typeof stream.getReader);
  return { stream, cancel, readAtLeast, read, pulls: () => pulls };
}
async function consume(stream: ReadableStream<Uint8Array>, content = true) {
  const reader = stream.getReader(), lengths: number[] = []; let offset = 0;
  while (true) {
    const item = await reader.read(); if (item.done) break;
    lengths.push(item.value.byteLength);
    if (content) expect(item.value.every((value, index) => value === (offset + index) % 251)).toBe(true);
    offset += item.value.byteLength;
  }
  reader.releaseLock(); return { lengths, bytes: offset };
}

describe("bounded media RPC batching", () => {
  it("uses native readAtLeast once per <=1MiB batch, preserves every byte and verifies EOF separately", async () => {
    const total = 2 * BATCH + 37, source = virtual(total, "native"), complete = vi.fn();
    const result = await consume(boundedMediaStream(source.stream, total, total, async () => {}, complete));
    expect(result.lengths).toEqual([BATCH, BATCH, 37]); expect(result.bytes).toBe(total);
    expect(source.readAtLeast.mock.calls).toEqual([[BATCH, BATCH], [BATCH, BATCH], [37, 37], [1, 1]]);
    expect(complete).toHaveBeenCalledOnce(); expect(source.cancel).not.toHaveBeenCalled(); expect(source.stream.locked).toBe(false);
  });
  it("batches a virtual production-sized 607918275-byte source without retaining the whole video", async () => {
    const total = 607_918_275, source = virtual(total, "native"), complete = vi.fn();
    const result = await consume(boundedMediaStream(source.stream, total, PREPARATION_CAPS.inputBytes, async () => {}, complete), false);
    expect(result.bytes).toBe(total); expect(result.lengths).toHaveLength(Math.ceil(total / BATCH));
    expect(result.lengths.every((n) => n > 0 && n <= BATCH)).toBe(true);
    expect(source.readAtLeast).toHaveBeenCalledTimes(Math.ceil(total / BATCH) + 1);
    expect(complete).toHaveBeenCalledOnce();
  });
  it("uses standard BYOB min and preserves partial transferred buffers on the final short batch", async () => {
    const source = virtual(13, "standard", 3), complete = vi.fn();
    expect(await consume(boundedMediaStream(source.stream, 13, 13, async () => {}, complete))).toEqual({ lengths: [13], bytes: 13 });
    expect(source.read.mock.calls).toEqual([[13, 13], [1, 1]]); expect(complete).toHaveBeenCalledOnce();
  });
  it("coalesces short BYOB responses even if an adapter ignores the min option", async () => {
    const source = virtual(BATCH + 103, "short", 3_333), complete = vi.fn();
    expect(await consume(boundedMediaStream(source.stream, BATCH + 103, BATCH + 103, async () => {}, complete))).toEqual({ lengths: [BATCH, 103], bytes: BATCH + 103 });
    expect(source.read.mock.calls.length).toBeGreaterThan(300); expect(complete).toHaveBeenCalledOnce();
  });
  it("coalesces default-reader fragments across batch boundaries without reading the next batch ahead", async () => {
    const total = 2 * BATCH + 19, source = virtual(total, "default", 65_537), complete = vi.fn();
    const wrapped = boundedMediaStream(source.stream, total, total, async () => {}, complete), reader = wrapped.getReader();
    expect(source.pulls()).toBe(0); const first = await reader.read(); expect(first.value?.byteLength).toBe(BATCH);
    expect(source.pulls()).toBe(16); await Promise.resolve(); expect(source.pulls()).toBe(16);
    expect(first.value!.every((value, index) => value === index % 251)).toBe(true);
    const second = await reader.read(); expect(second.value?.byteLength).toBe(BATCH);
    expect(second.value!.every((value, index) => value === (BATCH + index) % 251)).toBe(true);
    expect((await reader.read()).value?.byteLength).toBe(19); expect(complete).not.toHaveBeenCalled();
    expect((await reader.read()).done).toBe(true); expect(complete).toHaveBeenCalledOnce();
  });
  it("does not mark complete if a consumer stops after exactly the declared bytes", async () => {
    const source = virtual(31, "native", 7), complete = vi.fn(), reader = boundedMediaStream(source.stream, 31, 31, async () => {}, complete).getReader();
    expect((await reader.read()).value?.byteLength).toBe(31); expect(complete).not.toHaveBeenCalled();
    await reader.cancel("consumer_stopped"); expect(source.cancel).toHaveBeenCalledExactlyOnceWith("consumer_stopped"); expect(complete).not.toHaveBeenCalled(); expect(source.stream.locked).toBe(false);
  });
  it.each(["native", "standard", "default"] as const)("rejects truncation, extra bytes and oversize fragments (%s)", async (mode) => {
    for (const actual of [BATCH - 1, BATCH + 1]) {
      const source = virtual(actual, mode), complete = vi.fn();
      await expect(consume(boundedMediaStream(source.stream, BATCH, BATCH, async () => {}, complete), false)).rejects.toThrow("media_preparation_unavailable");
      expect(complete).not.toHaveBeenCalled(); expect(source.stream.locked).toBe(false);
    }
    if (mode === "default") {
      const source = virtual(BATCH + 2, mode, BATCH + 1), complete = vi.fn();
      await expect(consume(boundedMediaStream(source.stream, BATCH + 2, BATCH + 2, async () => {}, complete), false)).rejects.toThrow("media_preparation_unavailable");
      expect(source.cancel).toHaveBeenCalledOnce(); expect(complete).not.toHaveBeenCalled();
    }
  });
  it("finishes a byte-oriented downstream BYOB reader, including its final partial read", async () => {
    const source = virtual(521, "native", 17), complete = vi.fn(), wrapped = boundedMediaStream(source.stream, 521, 521, async () => {}, complete);
    const reader = wrapped.getReader({ mode: "byob" }); let offset = 0;
    while (true) {
      const item = await reader.read(new Uint8Array(257));
      if (item.value) { for (let i = 0; i < item.value.length; i++) expect(item.value[i]).toBe((offset+i)%251); offset += item.value.byteLength; }
      if (item.done) break;
    }
    expect(offset).toBe(521); expect(complete).toHaveBeenCalledOnce();
  });
  it("propagates cancellation during a pending native read without completion or extra pulls", async () => {
    let enter!: () => void, resume!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; }), gate = new Promise<void>((resolve) => { resume = resolve; }), cancel = vi.fn(), complete = vi.fn(), pull = vi.fn(async () => { enter(); await gate; });
    const source = new ReadableStream({ type: "bytes", pull, cancel }), reader = boundedMediaStream(source, 100, 100, async () => {}, complete).getReader();
    const pending = reader.read(); await entered; await reader.cancel("stop"); expect((await pending).done).toBe(true); resume();
    await Promise.resolve(); expect(cancel).toHaveBeenCalledExactlyOnceWith("stop"); expect(pull).toHaveBeenCalledOnce(); expect(complete).not.toHaveBeenCalled(); expect(source.locked).toBe(false);
  });
  it("fails a local deadline check before reading and rejects invalid lengths without source IO", async () => {
    const pull = vi.fn(), cancel = vi.fn(), complete = vi.fn(), source = new ReadableStream({ type: "bytes", pull, cancel });
    expect(() => boundedMediaStream(source, 2, 1, async () => {}, complete)).toThrow("media_preparation_unavailable"); expect(source.locked).toBe(false);
    await expect(consume(boundedMediaStream(source, 1, 1, async () => { throw new Error("expired"); }, complete))).rejects.toThrow("media_preparation_unavailable");
    expect(pull).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce(); expect(complete).not.toHaveBeenCalled();
  });
});
