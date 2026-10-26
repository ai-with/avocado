import { COLOR_LITERAL, PX_LITERAL, isZeroPx, lineCol, maskJsComments } from "./text.ts";
import { suggestToken } from "./tokens.ts";
import type { TokenIndex, Violation } from "./types.ts";

const STRING_LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

/** `style={{ ... }}` 본문의 [시작, 끝) 범위. 중괄호 짝을 센다 */
function styleRanges(src: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const m of src.matchAll(/style=\{\{/g)) {
    const start = (m.index ?? 0) + m[0].length;
    let depth = 2;
    let i = start;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
    }
    ranges.push([start, i]);
  }
  return ranges;
}

export function scanTsx(file: string, source: string, tokens: TokenIndex): Violation[] {
  const src = maskJsComments(source);
  const ranges = styleRanges(src);
  const out: Violation[] = [];
  for (const s of src.matchAll(STRING_LITERAL)) {
    const base = s.index ?? 0;
    const inStyle = ranges.some(([from, to]) => base >= from && base < to);
    const add = (literal: string, at: number, suggestion?: string) => {
      out.push({ file, ...lineCol(src, base + at), code: inStyle ? "e" : "d", literal, suggestion });
    };
    for (const c of s[0].matchAll(COLOR_LITERAL)) add(c[0], c.index ?? 0, suggestToken(tokens, null, c[0]));
    if (!inStyle) continue;
    for (const px of s[0].matchAll(PX_LITERAL)) {
      if (!isZeroPx(px[0])) add(px[0], px.index ?? 0);
    }
  }
  return out;
}
