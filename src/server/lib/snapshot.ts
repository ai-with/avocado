// 홈페이지 주소 원본을 HTML 스냅샷으로 떠서 R2 에 둔다. 공개 뷰어는 같은 출처 iframe(sandbox, 스크립트 없음)으로 띄운다
// ponytail: 스냅샷 시점에 고정되고, 자바스크립트로 그리는 페이지(SPA)는 빈 화면일 수 있다. 편집 화면의 '다시 불러오기'로 갱신
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 5 * 1024 * 1024;

export class SnapshotError extends Error {}

async function readCapped(res: Response): Promise<string> {
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new SnapshotError("too_large");
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new SnapshotError("too_large");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) all.set(c, at), (at += c.byteLength);
  return new TextDecoder().decode(all);
}

// 스크립트·이벤트 속성·자동 이동을 지우고, 상대 경로가 원래 사이트를 가리키게 <base> 를 넣는다. 링크는 새 창으로 연다
export function cleanSnapshot(html: string, baseUrl: string): Promise<string> {
  const base = `<base href="${baseUrl.replace(/"/g, "&quot;")}" target="_blank">`;
  let baseDone = false;
  const rewriter = new HTMLRewriter()
    .on("script, noscript, base, iframe, object, embed", { element: (el) => void el.remove() })
    .on('meta[http-equiv="refresh" i]', { element: (el) => void el.remove() })
    .on("form", { element: (el) => void el.removeAttribute("action") })
    .on("*", {
      element: (el) => {
        for (const [name = ""] of [...el.attributes]) if (/^on/i.test(name)) el.removeAttribute(name);
        for (const name of ["href", "src", "action", "formaction"]) if (/^\s*javascript:/i.test(el.getAttribute(name) ?? "")) el.removeAttribute(name);
      },
    })
    .on("head", {
      element: (el) => {
        el.prepend(base, { html: true });
        baseDone = true;
      },
    });
  return rewriter
    .transform(new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }))
    .text()
    .then((out) => (baseDone ? out : base + out));
}

export async function fetchSnapshot(url: string): Promise<string> {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; AvocadoSnapshot/1.0)", Accept: "text/html" },
  });
  if (!res.ok) throw new SnapshotError(`status_${res.status}`);
  if (!/^text\/html/i.test(res.headers.get("content-type") ?? "")) throw new SnapshotError("not_html");
  return cleanSnapshot(await readCapped(res), res.url || url);
}

// 스냅샷 응답. 직접 열어도 스크립트가 돌지 않게 CSP sandbox 를 건다
export function snapshotResponse(body: ReadableStream | string) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "sandbox allow-same-origin allow-popups allow-popups-to-escape-sandbox; script-src 'none'",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
