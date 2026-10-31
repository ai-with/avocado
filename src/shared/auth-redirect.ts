const FALLBACK = "/dashboard";
const APP_ORIGIN = "https://app.invalid";

// 인증 뒤에는 같은 사이트의 경로로만 돌아간다. 브라우저가 무시하거나 슬래시로 해석하는 문자도 거른다.
export function safeAuthNext(raw: string | null | undefined): string {
  if (!raw?.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(raw)) return FALLBACK;
  const path = raw.split(/[?#]/, 1)[0]!;
  if (/%(?:0[0-9a-f]|1[0-9a-f]|5c|7f)/i.test(path)) return FALLBACK;
  try {
    const target = new URL(raw, APP_ORIGIN);
    if (target.origin !== APP_ORIGIN || target.pathname.startsWith("//")) return FALLBACK;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return FALLBACK;
  }
}
