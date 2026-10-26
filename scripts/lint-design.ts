// 디자인 토큰 위반 검사. `npm run lint:design`, 시험은 `node scripts/lint-design.ts --self-test`
import { readFileSync, readdirSync } from "node:fs";
import { applyAllow, loadAllowRules } from "./lint-design/allow.ts";
import { scanCss } from "./lint-design/scan-css.ts";
import { runSelfTest } from "./lint-design/self-test.ts";
import { scanTsx } from "./lint-design/scan-tsx.ts";
import { buildTokenIndex } from "./lint-design/tokens.ts";
import type { Violation } from "./lint-design/types.ts";

const CLIENT_DIR = "src/client";
const TOKENS_FILE = "src/client/styles/tokens.css";
const ALLOW_FILE = "scripts/lint-design.allow.json";

function listTargets(): string[] {
  return readdirSync(CLIENT_DIR, { recursive: true, encoding: "utf8" })
    .map((p) => `${CLIENT_DIR}/${p}`)
    .filter((p) => /\.(css|tsx)$/.test(p) && p !== TOKENS_FILE && !/\.test\./.test(p))
    .sort();
}

function collect(): Violation[] {
  const tokens = buildTokenIndex(readFileSync(TOKENS_FILE, "utf8"));
  return listTargets().flatMap((file) => {
    const src = readFileSync(file, "utf8");
    return file.endsWith(".css") ? scanCss(file, src, tokens) : scanTsx(file, src, tokens);
  });
}

function format(v: Violation): string {
  const hint = v.suggestion ? ` → ${v.suggestion}` : "";
  return `${v.file}:${v.line}:${v.col} [${v.code}] ${v.literal}${hint}`;
}

function main(): number {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    return 0;
  }
  const { remaining, errors, unused } = applyAllow(collect(), loadAllowRules(ALLOW_FILE));
  for (const v of remaining) console.log(format(v));
  for (const e of errors) console.log(e);
  for (const r of unused) console.warn(`경고: 쓰지 않는 허용 규칙 ${r.file} ${r.value}`);
  console.log(`위반 ${remaining.length}건, 허용 목록 오류 ${errors.length}건`);
  return remaining.length + errors.length > 0 ? 1 : 0;
}

process.exitCode = main();
