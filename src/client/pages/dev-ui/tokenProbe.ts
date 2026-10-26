export interface TokenEntry {
  name: string;
  value: string;
}

// 값을 코드에 적어 두지 않고 현재 로드된 스타일시트의 :root 선언에서 이름을 모은다
function collectRootNames(rules: CSSRuleList, prefix: string, into: Set<string>): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule && rule.selectorText === ":root") {
      for (const name of Array.from(rule.style)) if (name.startsWith(prefix)) into.add(name);
    } else if (rule instanceof CSSGroupingRule) {
      collectRootNames(rule.cssRules, prefix, into);
    }
  }
}

export function readRootTokens(prefix: string): TokenEntry[] {
  const names = new Set<string>();
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      collectRootNames(sheet.cssRules, prefix, names);
    } catch {
      // 다른 출처의 시트는 규칙을 읽을 수 없다. 토큰은 같은 출처 시트에만 있다
    }
  }
  const computed = getComputedStyle(document.documentElement);
  return [...names].map((name) => ({ name, value: computed.getPropertyValue(name).trim() }));
}
