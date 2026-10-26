/** 주석 글자를 공백으로 바꿔 오프셋을 보존한다 */
export function maskCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

export function maskJsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\/|(?<![:"'`])\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
}

export function lineCol(src: string, offset: number): { line: number; col: number } {
  const before = src.slice(0, offset);
  const line = before.split("\n").length;
  return { line, col: offset - before.lastIndexOf("\n") };
}

/** 색 비교용: 소문자, 공백 제거 */
export function normalizeValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

export const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)/g;
export const PX_LITERAL = /-?\d*\.?\d+px/g;

export function isZeroPx(px: string): boolean {
  return Number.parseFloat(px) === 0;
}
