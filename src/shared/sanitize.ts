// 직접 쓴 문서 HTML 의 허용 목록 sanitizer. 서버(저장·공개 응답)에서 쓰므로 DOM 없이 동작한다
// ponytail: 정규식 토크나이저라 허용 태그만 다시 조립한다. 표·색상 같은 블록을 늘리면 ALLOWED 에 추가
const ALLOWED: Record<string, string[]> = {
  h1: [], h2: [], h3: [], p: [], ul: [], ol: [], li: [], blockquote: [], hr: [], br: [],
  strong: [], em: [], u: [], s: [], code: [], pre: [],
  a: ["href"],
  img: ["src", "alt"],
};
const VOID = new Set(["hr", "br", "img"]);
const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "template", "noscript", "textarea", "title"]);

const escAttr = (s: string) => s.replace(/&(?!#?\w+;)/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escText = (s: string) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");

function safeUrl(tag: string, value: string): boolean {
  const v = value.trim();
  if (/^https:\/\//i.test(v)) return true;
  if (tag === "a") return /^http:\/\//i.test(v) || /^mailto:/i.test(v);
  // 이미지는 같은 출처(/api/public/asset/...)만
  return tag === "img" && /^\/(?!\/)/.test(v) && !v.includes("\\");
}

function attrs(tag: string, raw: string): string {
  const out: string[] = [];
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const m of raw.matchAll(re)) {
    const name = m[1]!.toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    if (!ALLOWED[tag]!.includes(name)) continue;
    if ((name === "href" || name === "src") && !safeUrl(tag, value)) continue;
    out.push(` ${name}="${escAttr(value)}"`);
  }
  if (tag === "a") out.push(' target="_blank" rel="noopener noreferrer nofollow"');
  return out.join("");
}

export function sanitizeHtml(html: string): string {
  let out = "";
  let i = 0;
  const tagRe = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/y;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      out += escText(html.slice(i));
      break;
    }
    out += escText(html.slice(i, lt));
    tagRe.lastIndex = lt;
    const m = tagRe.exec(html);
    if (!m) {
      out += "&lt;";
      i = lt + 1;
      continue;
    }
    i = tagRe.lastIndex;
    if (!m[2]) continue; // 주석
    const tag = m[2].toLowerCase();
    const closing = m[1] === "/";
    if (DROP_WITH_CONTENT.has(tag)) {
      if (!closing) {
        const end = html.toLowerCase().indexOf(`</${tag}`, i);
        i = end < 0 ? html.length : (html.indexOf(">", end) + 1 || html.length);
      }
      continue;
    }
    if (!ALLOWED[tag]) continue;
    if (closing) out += VOID.has(tag) ? "" : `</${tag}>`;
    else out += `<${tag}${attrs(tag, m[3] ?? "")}>`;
  }
  return out;
}
