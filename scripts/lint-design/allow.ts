import { readFileSync } from "node:fs";
import { normalizeValue } from "./text.ts";
import type { AllowRule, Violation } from "./types.ts";

/** `**`는 여러 폴더, `*`는 한 폴더 안 */
export function globToRegExp(glob: string): RegExp {
  const body = glob
    .replace(/[.+^${}()|[\]\\?]/g, "\\$&")
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*\*/g, "\u0001")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, "(?:.*/)?")
    .replace(/\u0001/g, ".*");
  return new RegExp(`^${body}$`);
}

export function loadAllowRules(path: string): AllowRule[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { rules?: AllowRule[] };
  return parsed.rules ?? [];
}

export interface AllowResult {
  remaining: Violation[];
  errors: string[];
  unused: AllowRule[];
}

export function applyAllow(violations: Violation[], rules: AllowRule[]): AllowResult {
  const errors = rules
    .filter((r) => !r.reason?.trim())
    .map((r) => `허용 목록 오류: reason이 비어 있음 (${r.file} ${r.value})`);
  const usable = rules.filter((r) => r.reason?.trim());
  const matchers = usable.map((r) => ({ rule: r, file: globToRegExp(r.file), value: normalizeValue(r.value) }));
  const used = new Set<AllowRule>();
  const remaining = violations.filter((v) => {
    const hit = matchers.find((m) => m.file.test(v.file) && m.value === normalizeValue(v.literal));
    if (hit) used.add(hit.rule);
    return !hit;
  });
  return { remaining, errors, unused: usable.filter((r) => !used.has(r)) };
}
