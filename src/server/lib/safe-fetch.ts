import { readCapped } from "./snapshot";

// 사용자가 준 외부 URL 을 서버가 가져올 때 쓰는 SSRF 방어 fetch.
// ponytail: 호스트 이름만 검사한다. 공개 도메인이 사설 IP 로 풀리는 경우(DNS rebinding)는 막지 못한다.
// Workers 런타임은 사설망에 닿지 않아 실서비스 위험은 낮다. 필요해지면 DoH 로 A/AAAA 를 조회해 같은 검사를 한다
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const ALLOWED_PORTS = new Set(["", "80", "443"]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa"];
const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;

export class FetchError extends Error {}
// 처음 주소나 리다이렉트로 옮겨 간 주소가 내부망·IP 를 가리킬 때
export class UnsafeUrlError extends FetchError {}

// 막아야 하면 사유 코드, 괜찮으면 null.
// URL 파서가 2130706433, 0x7f.1 같은 표기를 점 네 개짜리 IPv4 로 바꿔 주므로 IP 는 hostname 만 보면 된다
export function unsafeUrlReason(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "invalid_url";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "bad_protocol";
  if (url.username || url.password) return "credentials";
  if (!ALLOWED_PORTS.has(url.port)) return "bad_port";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  // 사설·루프백·링크로컬(169.254.169.254 메타데이터 포함)을 하나씩 가르지 않고 IP 직접 지정은 전부 막는다
  if (IPV4_LITERAL.test(host) || host.startsWith("[")) return "ip_literal";
  if (host === "localhost" || !host.includes(".")) return "local_host";
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return "local_host";
  return null;
}

function assertSafe(url: string) {
  const reason = unsafeUrlReason(url);
  if (reason) throw new UnsafeUrlError(reason);
}

const isRedirect = (status: number) => status >= 300 && status < 400;

// 리다이렉트는 직접 따라가며 단계마다 같은 검사를 한다. 전체 체인에 타임아웃 하나
export async function fetchHtmlSafely(startUrl: string): Promise<{ html: string; finalUrl: string }> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertSafe(url);
    const res = await fetch(url, {
      redirect: "manual",
      signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AvocadoProductReader/1.0)", Accept: "text/html" },
    });
    const location = res.headers.get("location");
    if (isRedirect(res.status) && location) {
      url = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) throw new FetchError(`status_${res.status}`);
    if (!/^text\/html|^application\/xhtml\+xml/i.test(res.headers.get("content-type") ?? "")) throw new FetchError("not_html");
    // 큰 쇼핑몰 페이지는 2MB 를 넘기도 한다. 상품 meta·JSON-LD 는 앞쪽에 있으니 2MB 까지만 읽는다
    return { html: await readCapped(res, MAX_BYTES, true), finalUrl: url };
  }
  throw new FetchError("too_many_redirects");
}
