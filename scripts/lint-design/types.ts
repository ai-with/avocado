export type RuleCode = "a" | "b" | "c" | "d" | "e";

export interface Violation {
  file: string;
  line: number;
  col: number;
  code: RuleCode;
  literal: string;
  suggestion?: string;
}

/** 정규화한 값 → 그 값을 가진 2층 의미 토큰 이름들 */
export type TokenIndex = Map<string, string[]>;

export interface AllowRule {
  file: string;
  value: string;
  reason: string;
}
