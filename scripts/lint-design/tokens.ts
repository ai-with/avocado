import { maskCssComments, normalizeValue } from "./text.ts";
import type { TokenIndex } from "./types.ts";

const DECL = /(--[\w-]+)\s*:\s*([^;]+);/g;
const ALIAS = /^var\((--[\w-]+)\)$/;
const OVERRIDE_BLOCK = /@media[^{]*\{[\s\S]*?\n\}/g;

function readDecls(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of block.matchAll(DECL)) out.set(m[1] as string, (m[2] as string).trim());
  return out;
}

/** tokens.css의 1층(원시), 2층(의미) :root 블록으로 값 → 의미 토큰 이름 맵을 만든다 */
export function buildTokenIndex(tokensCss: string): TokenIndex {
  const css = maskCssComments(tokensCss);
  const overridden = new Set<string>();
  for (const block of css.match(OVERRIDE_BLOCK) ?? []) {
    for (const name of readDecls(block).keys()) overridden.add(name);
  }
  const roots = [...css.replace(OVERRIDE_BLOCK, "").matchAll(/:root\s*\{([^}]*)\}/g)];
  const primitive = readDecls(roots[0]?.[1] ?? "");
  const semantic = readDecls(roots[1]?.[1] ?? "");
  const index: TokenIndex = new Map();
  for (const [name, raw] of semantic) {
    if (overridden.has(name)) continue;
    const alias = ALIAS.exec(raw)?.[1];
    const value = alias ? (semantic.get(alias) ?? primitive.get(alias) ?? raw) : raw;
    const key = normalizeValue(value);
    index.set(key, [...(index.get(key) ?? []), name]);
  }
  return index;
}

/** 속성 종류별로 제안해도 되는 토큰 이름 */
const PROP_TOKENS: Array<[RegExp, RegExp]> = [
  [/^(margin|padding|gap|row-gap|column-gap|inset|top|right|bottom|left)(-|$)/, /^--space-/],
  [/^font-size$/, /^--text-.*-size$/],
  [/^line-height$/, /^--text-.*-lh$/],
  [/radius/, /^--radius-/],
  [/^color$/, /^--color-/],
];

/** prop이 null이면 색 리터럴 */
export function suggestToken(index: TokenIndex, prop: string | null, literal: string): string | undefined {
  const names = index.get(normalizeValue(literal)) ?? [];
  const allowed = prop === null ? /^--color-/ : PROP_TOKENS.find(([p]) => p.test(prop))?.[1];
  const hits = names.filter((n) => allowed?.test(n));
  return hits.length ? hits.map((n) => `var(${n})`).join(" 또는 ") : undefined;
}
