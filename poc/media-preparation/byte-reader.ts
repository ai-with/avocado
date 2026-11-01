/** One bounded batch per read. No read-ahead until the consumer asks for it. */
const MAX = 1024 ** 2;
type Chunk = { done: false; value: Uint8Array } | { done: true; value?: undefined };
// The repository Workers types declare this extension, but the shared compiler's
// DOM/Node globals can select the standard reader interface. Narrow the actual
// method at runtime, using Cloudflare's documented signature; no unchecked cast.
type AtLeastReader = ReadableStreamBYOBReader & {
  readAtLeast(minElements: number, view: Uint8Array): Promise<{ done: boolean; value?: Uint8Array }>;
};
function supportsAtLeast(reader: ReadableStreamBYOBReader): reader is AtLeastReader {
  return "readAtLeast" in reader && typeof reader.readAtLeast === "function";
}
export class BoundedByteReader {
  private byob: AtLeastReader | null = null;
  private ordinary: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private pending: Uint8Array | null = null; private offset = 0;
  private ended = false; private released = false; private cancelled = false; private cancellation?: Promise<void>;
  constructor(source: ReadableStream<Uint8Array>) {
    let candidate: ReadableStreamBYOBReader | undefined;
    try { candidate = source.getReader({ mode: "byob" }); } catch { /* Non-byte stream. */ }
    if (candidate && supportsAtLeast(candidate)) this.byob = candidate;
    else {
      // Node lacks Cloudflare's extension. Default-reader coalescing also works
      // with byte producers that do not settle a pending standard BYOB EOF.
      candidate?.releaseLock(); this.ordinary = source.getReader();
    }
  }
  async read(size: number, check: () => Promise<void> = async () => {},
    wait: <T>(promise: Promise<T>) => Promise<T> = promise => promise): Promise<Chunk> {
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX || this.released) throw new Error("stream_chunk_limit");
    if (this.ended) return { done: true };
    if (this.byob) {
      await check();
      // readAtLeast transfers/detaches the supplied buffer. Always use its
      // returned view, and use a fresh bounded view for the next EOF probe.
      const item = await wait(this.byob.readAtLeast(size, new Uint8Array(size)));
      if (this.cancelled) throw new Error("stream_cancelled");
      const value = item.value;
      if (value !== undefined && (!(value instanceof Uint8Array) || value.byteLength > size)) throw new Error("stream_chunk_limit");
      if (item.done) this.ended = true;
      if (!value?.byteLength) {
        if (!item.done) throw new Error("stream_chunk_limit");
        return { done: true };
      }
      // Cloudflare can return a partial EOF view with done:false. Preserve it;
      // the next read must still observe EOF before an exact stream completes.
      return { done: false, value };
    }
    const buffer = new Uint8Array(size); let used = 0;
    while (used < size) {
      await check();
      if (!this.pending) {
        const item = await wait(this.ordinary!.read());
        if (this.cancelled) throw new Error("stream_cancelled");
        if (item.done) { this.ended = true; break; }
        if (!(item.value instanceof Uint8Array) || !item.value.byteLength || item.value.byteLength > MAX) throw new Error("stream_chunk_limit");
        this.pending = item.value; this.offset = 0;
      }
      const count = Math.min(size - used, this.pending.byteLength - this.offset);
      buffer.set(this.pending.subarray(this.offset, this.offset + count), used);
      used += count; this.offset += count;
      if (this.offset === this.pending.byteLength) this.pending = null;
    }
    return used ? { done: false, value: buffer.subarray(0, used) } : { done: true };
  }
  releaseLock() {
    if (!this.released) { (this.byob ?? this.ordinary!).releaseLock(); this.released = true; this.pending = null; }
  }
  cancel(reason?: unknown): Promise<void> {
    if (this.released) return Promise.resolve();
    this.cancellation ??= (async () => {
      this.cancelled = true;
      try { await (this.byob ?? this.ordinary!).cancel(reason); }
      finally { this.releaseLock(); }
    })();
    return this.cancellation;
  }
}
