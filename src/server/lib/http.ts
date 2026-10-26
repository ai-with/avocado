import { ApiError } from "./errors";

export const csvResponse = (csv: string, filename: string) =>
  new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` } });

// R2 객체를 읽고, 키가 없거나 객체가 없으면 404
export async function requireObject(bucket: R2Bucket, key: string | null | undefined, code: string, message: string) {
  const obj = key ? await bucket.get(key) : null;
  if (!obj) throw new ApiError(404, code, message);
  return obj;
}

// Range 요청을 지원하는 R2 스트리밍 응답 (영상 재생, 프레임 이미지)
export async function streamObject(bucket: R2Bucket, key: string, reqHeaders: Headers, download: boolean) {
  const ranged = reqHeaders.has("range");
  const obj = await bucket.get(key, ranged ? { range: reqHeaders } : {});
  if (!obj) throw new ApiError(404, "file_not_found", "파일을 찾을 수 없어요.");
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, max-age=3600");
  if (download) headers.set("content-disposition", `attachment; filename="${key.split("/").pop()}"`);
  const r = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (!ranged || !r) {
    headers.set("content-length", String(obj.size));
    return new Response(obj.body, { headers });
  }
  const offset = r.suffix != null ? obj.size - r.suffix : (r.offset ?? 0);
  const length = r.length ?? obj.size - offset;
  headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
  headers.set("content-length", String(length));
  return new Response(obj.body, { status: 206, headers });
}
