import { NO_AUDIO_PROOF, type AudioUnavailableReason } from "../../../shared/audio-analysis";

// A deliberately narrow static ISO BMFF/QuickTime reader. Unrecognized layouts
// are unknown, never evidence of silence. Media payloads are skipped with Blob.slice.
const METADATA_BYTES = 2 * 1024 ** 2, MAX_BOXES = 4096, MAX_SAMPLES = 100_000;
const BRANDS = new Set(["isom", "iso2", "mp41", "mp42", "avc1", "qt  "]);
const VIDEO_CODECS = new Set(["avc1", "avc3", "hvc1", "hev1", "vp09", "av01", "mp4v", "jpeg"]);
type Box = { type: string; start: number; data: number; end: number };
type Probe = { kind: "present" } | { kind: "no_audio"; proof: typeof NO_AUDIO_PROOF } | { kind: "unavailable"; reason: AudioUnavailableReason };
class ProbeError extends Error { constructor(public reason: AudioUnavailableReason) { super(reason); } }
const invalid = (): never => { throw new ProbeError("invalid_container"); };
const unsupported = (): never => { throw new ProbeError("unsupported_container"); };
const text = (bytes: Uint8Array, offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
const u32 = (bytes: Uint8Array, offset: number) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
function u64(bytes: Uint8Array, offset: number) {
  const value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
  return Number(value);
}
function header(bytes: Uint8Array, offset: number, boundary: number): Box {
  if (offset + 8 > bytes.length) invalid();
  const size = u32(bytes, offset), extended = size === 1;
  if (size === 0) unsupported(); // EOF-sized payload cannot establish truncation bounds.
  if (extended && offset + 16 > bytes.length) invalid();
  const length = extended ? u64(bytes, offset + 8) : size, data = offset + (extended ? 16 : 8);
  if (length < data - offset || !Number.isSafeInteger(offset + length) || offset + length > boundary) invalid();
  return { type: text(bytes, offset + 4), start: offset, data, end: offset + length };
}
class Movie {
  count = 0;
  samples = 0;
  constructor(public bytes: Uint8Array, public media: { start: number; end: number }[]) {}
  boxes(start: number, end: number): Box[] {
    const out: Box[] = [];
    for (let offset = start; offset < end;) {
      if (++this.count > MAX_BOXES) throw new ProbeError("probe_limit");
      const box = header(this.bytes, offset, end); out.push(box); offset = box.end;
    }
    return out;
  }
  one(boxes: Box[], type: string): Box { const matches = boxes.filter((box) => box.type === type); return matches.length === 1 ? matches[0]! : invalid(); }
  full(box: Box, size: number) { if (box.end - box.data < size || this.bytes[box.data] !== 0) invalid(); }
}
function sampleSizes(movie: Movie, box: Box): number[] {
  const b = movie.bytes; movie.full(box, 12);
  const size = u32(b, box.data + 4), count = u32(b, box.data + 8);
  movie.samples += count;
  if (!count || movie.samples > MAX_SAMPLES) throw new ProbeError("probe_limit");
  if (box.end - box.data !== 12 + (size ? 0 : count * 4)) invalid();
  const sizes = Array.from({ length: count }, (_, i) => size || u32(b, box.data + 12 + i * 4));
  if (sizes.some((value) => value === 0)) invalid();
  return sizes;
}
function chunkOffsets(movie: Movie, boxes: Box[]): number[] {
  const candidates = boxes.filter((box) => box.type === "stco" || box.type === "co64");
  if (candidates.length !== 1) invalid();
  const box = candidates[0]!, b = movie.bytes; movie.full(box, 8);
  const count = u32(b, box.data + 4), width = box.type === "co64" ? 8 : 4;
  if (!count || count > MAX_SAMPLES) throw new ProbeError("probe_limit");
  if (box.end - box.data !== 8 + count * width) invalid();
  return Array.from({ length: count }, (_, i) => width === 8 ? u64(b, box.data + 8 + i * width) : u32(b, box.data + 8 + i * width));
}
function chunkMap(movie: Movie, box: Box, descriptions: number, chunks: number) {
  movie.full(box, 8); const b = movie.bytes, count = u32(b, box.data + 4);
  if (!count || count > MAX_SAMPLES || box.end - box.data !== 8 + count * 12) invalid();
  const rows = Array.from({ length: count }, (_, i) => ({ first: u32(b, box.data + 8 + i * 12), samples: u32(b, box.data + 12 + i * 12), description: u32(b, box.data + 16 + i * 12) }));
  rows.forEach((row, i) => {
    if (!row.samples || !row.description || row.description > descriptions || row.first > chunks || (i === 0 ? row.first !== 1 : row.first <= rows[i - 1]!.first)) invalid();
  });
  return rows;
}
function validateTiming(movie: Movie, box: Box, samples: number) {
  movie.full(box, 8); const b = movie.bytes, count = u32(b, box.data + 4);
  if (!count || count > MAX_SAMPLES || box.end - box.data !== 8 + count * 8) invalid();
  let total = 0;
  for (let i = 0; i < count; i++) { const n = u32(b, box.data + 8 + i * 8), delta = u32(b, box.data + 12 + i * 8); if (!n || !delta) invalid(); total += n; }
  if (total !== samples) invalid();
}
function validateDataReferences(movie: Movie, minf: Box[]): number {
  const dinf = movie.one(minf, "dinf"), dref = movie.one(movie.boxes(dinf.data, dinf.end), "dref");
  movie.full(dref, 8); const entries = movie.boxes(dref.data + 8, dref.end);
  if (!entries.length || entries.length !== u32(movie.bytes, dref.data + 4)) invalid();
  for (const entry of entries) {
    movie.full(entry, 4);
    if (entry.type !== "url " || entry.end - entry.data !== 4 || u32(movie.bytes, entry.data) !== 1) unsupported();
  }
  return entries.length;
}
function validateVideo(movie: Movie, mdia: Box[]) {
  const minf = movie.one(mdia, "minf"), children = movie.boxes(minf.data, minf.end);
  movie.full(movie.one(children, "vmhd"), 12);
  const references = validateDataReferences(movie, children), stbl = movie.one(children, "stbl"), tables = movie.boxes(stbl.data, stbl.end);
  const stsd = movie.one(tables, "stsd"); movie.full(stsd, 8);
  const descriptions = movie.boxes(stsd.data + 8, stsd.end);
  if (!descriptions.length || descriptions.length !== u32(movie.bytes, stsd.data + 4)) invalid();
  for (const description of descriptions) {
    if (!VIDEO_CODECS.has(description.type)) unsupported();
    if (description.end - description.data < 78) invalid();
    const reference = new DataView(movie.bytes.buffer).getUint16(description.data + 6);
    if (!reference || reference > references) unsupported();
  }
  const sizes = sampleSizes(movie, movie.one(tables, "stsz")), offsets = chunkOffsets(movie, tables);
  const map = chunkMap(movie, movie.one(tables, "stsc"), descriptions.length, offsets.length);
  validateTiming(movie, movie.one(tables, "stts"), sizes.length);
  let index = 0, run = 0;
  offsets.forEach((offset, chunk) => {
    while (map[run + 1] && map[run + 1]!.first <= chunk + 1) run++;
    const count = map[run]!.samples;
    if (index + count > sizes.length) invalid();
    let length = 0; for (let n = 0; n < count; n++) length += sizes[index++]!;
    if (!Number.isSafeInteger(offset + length) || !movie.media.some((data) => offset >= data.start && offset + length <= data.end)) invalid();
  });
  if (index !== sizes.length) invalid();
}
function inspectMovie(bytes: Uint8Array, media: { start: number; end: number }[]): Probe {
  const movie = new Movie(bytes, media), children = movie.boxes(0, bytes.length);
  if (children.some((box) => ["cmov", "rmra", "mvex"].includes(box.type))) unsupported();
  const mvhd = movie.one(children, "mvhd");
  if (![0, 1].includes(bytes[mvhd.data]!) || mvhd.end - mvhd.data < (bytes[mvhd.data] === 1 ? 112 : 100)) invalid();
  const movieVersion = bytes[mvhd.data];
  if (!u32(bytes, mvhd.data + (movieVersion === 1 ? 20 : 12)) || !(movieVersion === 1 ? u64(bytes, mvhd.data + 24) : u32(bytes, mvhd.data + 16))) invalid();
  const tracks = children.filter((box) => box.type === "trak"); if (!tracks.length) invalid();
  const videos: Box[][] = [], ids = new Set<number>();
  for (const track of tracks) {
    const boxes = movie.boxes(track.data, track.end), tkhd = movie.one(boxes, "tkhd"), mdia = movie.one(boxes, "mdia");
    if (![0, 1].includes(bytes[tkhd.data]!) || tkhd.end - tkhd.data < (bytes[tkhd.data] === 1 ? 96 : 84)) invalid();
    const id = u32(bytes, tkhd.data + (bytes[tkhd.data] === 1 ? 20 : 12));
    if (!id || ids.has(id)) invalid(); ids.add(id);
    const metadata = movie.boxes(mdia.data, mdia.end), hdlr = movie.one(metadata, "hdlr"), mdhd = movie.one(metadata, "mdhd");
    movie.full(hdlr, 24);
    if (![0, 1].includes(bytes[mdhd.data]!) || mdhd.end - mdhd.data < (bytes[mdhd.data] === 1 ? 36 : 24)) invalid();
    if (!u32(bytes, mdhd.data + (bytes[mdhd.data] === 1 ? 20 : 12)) || !(bytes[mdhd.data] === 1 ? u64(bytes, mdhd.data + 24) : u32(bytes, mdhd.data + 16))) invalid();
    const handler = text(bytes, hdlr.data + 8);
    if (handler === "soun") return { kind: "present" };
    if (handler !== "vide") unsupported();
    videos.push(metadata);
  }
  videos.forEach((video) => validateVideo(movie, video));
  return { kind: "no_audio", proof: NO_AUDIO_PROOF };
}
export async function probeAudioTracks(file: Blob): Promise<Probe> {
  let consumed = 0, boxCount = 0;
  const read = async (start: number, end: number) => {
    consumed += end - start;
    if (consumed > METADATA_BYTES) throw new ProbeError("probe_limit");
    const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
    if (bytes.length !== end - start) invalid();
    return bytes;
  };
  try {
    if (file.size < 8 || text(await read(0, 8), 4) !== "ftyp") unsupported();
    let movie: Uint8Array | undefined, recognized = false;
    const media: { start: number; end: number }[] = [];
    for (let offset = 0; offset < file.size;) {
      if (++boxCount > MAX_BOXES) throw new ProbeError("probe_limit");
      const bytes = await read(offset, Math.min(file.size, offset + 16)), local = header(bytes, 0, file.size - offset);
      const box = { ...local, start: offset, data: offset + local.data, end: offset + local.end };
      if (box.type === "ftyp") {
        if (offset !== 0 || box.end - box.data < 8 || (box.end - box.data) % 4) invalid();
        const brands = await read(box.data, box.end);
        recognized = BRANDS.has(text(brands, 0));
        for (let i = 8; i < brands.length; i += 4) recognized ||= BRANDS.has(text(brands, i));
      } else if (box.type === "moov") { if (movie) unsupported(); movie = await read(box.data, box.end); }
      else if (box.type === "mdat") media.push({ start: box.data, end: box.end });
      else if (!["free", "skip", "wide"].includes(box.type)) unsupported();
      offset = box.end;
    }
    if (!recognized) unsupported();
    if (!movie || !media.length) invalid();
    return inspectMovie(movie!, media);
  } catch (error) { return { kind: "unavailable", reason: error instanceof ProbeError ? error.reason : "read_failed" }; }
}
