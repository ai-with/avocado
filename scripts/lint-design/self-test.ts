import assert from "node:assert/strict";
import { applyAllow, globToRegExp } from "./allow.ts";
import { scanCss } from "./scan-css.ts";
import { scanTsx } from "./scan-tsx.ts";
import { buildTokenIndex } from "./tokens.ts";

const FAKE_TOKENS = `
:root { --neutral-0: #fefdfb; --neutral-900: #1e1d1c; --space-token: 1; }
:root {
  --color-bg: var(--neutral-0);
  --space-5: 12px;
  --radius-md: 12px;
  --text-body-size: 14px;
  --text-h1-size: 32px;
}
@media (max-width: 599px) {
  :root { --text-h1-size: 24px; }
}`;

function codes(list: Array<{ code: string }>): string {
  return list.map((v) => v.code).join("");
}

function testCss(): void {
  const tokens = buildTokenIndex(FAKE_TOKENS);
  const css = `.a { color: #fefdfb; background: rgba(1, 2, 3, 0.5); border: 1px solid var(--neutral-900);
  padding: 12px 0px; border-radius: 12px; font-size: 32px; width: 99px; }
  @media (min-width: 600px) { .b { margin: 0; } }`;
  const found = scanCss("x.css", css, tokens);
  assert.equal(codes(found), "aabccc");
  assert.equal(found[0]?.suggestion, "var(--color-bg)");
  assert.equal(found.find((v) => v.literal === "12px")?.suggestion, "var(--space-5)");
  assert.equal(found.find((v) => v.literal === "32px")?.suggestion, undefined, "반응형 토큰은 제안 안 함");
}

function testTsx(): void {
  const tokens = buildTokenIndex(FAKE_TOKENS);
  const tsx = `const c = "#ff0000"; const w = <div style={{ width: "12px", color: "rgb(0,0,0)", height: 0 }} />;`;
  assert.equal(codes(scanTsx("x.tsx", tsx, tokens)), "dee");
}

function testAllow(): void {
  assert.ok(globToRegExp("src/**/*.css").test("src/client/a/b.css"));
  assert.ok(!globToRegExp("src/*/*.css").test("src/client/a/b.css"));
  const v = { file: "src/client/a.css", line: 1, col: 1, code: "c" as const, literal: "3px" };
  const ok = applyAllow([v], [{ file: "src/**/*.css", value: "3px", reason: "시험" }]);
  assert.equal(ok.remaining.length, 0);
  const noReason = applyAllow([v], [{ file: "src/**/*.css", value: "3px", reason: " " }]);
  assert.equal(noReason.errors.length, 1);
  const unused = applyAllow([], [{ file: "x", value: "1px", reason: "r" }]);
  assert.equal(unused.unused.length, 1);
}

export function runSelfTest(): void {
  testCss();
  testTsx();
  testAllow();
  console.log("lint-design self-test 통과");
}
