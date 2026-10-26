import { COLOR_LITERAL, PX_LITERAL, isZeroPx, lineCol, maskCssComments } from "./text.ts";
import { suggestToken } from "./tokens.ts";
import type { RuleCode, TokenIndex, Violation } from "./types.ts";

const DECLARATION = /(?<=[{;]\s*)([a-z-]+)\s*:\s*([^;{}]+)/g;
const RAW_VAR = /var\((--(?:neutral|green|emerald|amber|red|blue)-[\w-]+)/g;
const SPACING_PROP =
  /^(margin(-[a-z-]+)?|padding(-[a-z-]+)?|gap|row-gap|column-gap|inset(-[a-z-]+)?|top|right|bottom|left|font-size|line-height|border(-[a-z]+)*-radius|box-shadow)$/;

export function scanCss(file: string, source: string, tokens: TokenIndex): Violation[] {
  const src = maskCssComments(source);
  const out: Violation[] = [];
  for (const m of src.matchAll(DECLARATION)) {
    const prop = m[1] as string;
    const value = m[2] as string;
    const valueStart = (m.index ?? 0) + m[0].length - value.length;
    const push = (code: RuleCode, literal: string, at: number, suggestion?: string) => {
      out.push({ file, ...lineCol(src, valueStart + at), code, literal, suggestion });
    };
    for (const c of value.matchAll(COLOR_LITERAL)) {
      push("a", c[0], c.index ?? 0, suggestToken(tokens, null, c[0]));
    }
    for (const v of value.matchAll(RAW_VAR)) push("b", `var(${v[1]})`, v.index ?? 0);
    if (!SPACING_PROP.test(prop)) continue;
    for (const px of value.matchAll(PX_LITERAL)) {
      if (!isZeroPx(px[0])) push("c", px[0], px.index ?? 0, suggestToken(tokens, prop, px[0]));
    }
  }
  return out;
}
