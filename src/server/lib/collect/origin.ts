// 사이트 허용 도메인 매칭 (docs/14 6-2 4). 포트는 무시하고 대소문자는 구분하지 않는다

const DOMAIN_RE = /^(\*\.)?([a-z0-9-]+\.)*[a-z0-9-]+$/;

// 입력은 "example.com", "*.example.com", "https://www.example.com/path" 모두 받는다. 형식이 틀리면 null
export function normalizeDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  const wildcard = s.startsWith("*.");
  if (wildcard) s = s.slice(2);
  try {
    s = new URL(s.includes("://") ? s : `https://${s}`).hostname;
  } catch {
    return null;
  }
  const out = (wildcard ? "*." : "") + s;
  return DOMAIN_RE.test(out) ? out : null;
}

// "*.example.com" 은 example.com 과 모든 하위 도메인, 그 외는 정확히 같은 호스트만
export function hostAllowed(host: string, patterns: string[]): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  return patterns.some((p) => (p.startsWith("*.") ? h === p.slice(2) || h.endsWith(p.slice(1)) : h === p));
}

export function hostOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// 목적지가 등록 사이트 도메인일 때만 avc 를 붙인다(docs/14 4-1). 브랜드가 모르는 사이트에 파라미터를 뿌리지 않기 위해
export function appendClickId(url: string, clickToken: string | null, patterns: string[]): string {
  const host = hostOf(url);
  if (!clickToken || !host || !hostAllowed(host, patterns)) return url;
  const u = new URL(url);
  u.searchParams.set("avc", clickToken);
  return u.toString();
}
