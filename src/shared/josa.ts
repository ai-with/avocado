// 조사 선택·교정 (AIWITH-567). 메시지 템플릿 변수 뒤 조사 교정도 여기서 한다

// 받침 여부로 조사를 고른다. 첫째가 받침 있을 때, 둘째가 없을 때
const PAIRS = {
  "을/를": ["을", "를"],
  "이/가": ["이", "가"],
  "은/는": ["은", "는"],
  "과/와": ["과", "와"],
  "으로/로": ["으로", "로"],
} as const;
export type JosaPair = keyof typeof PAIRS;

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;
const JONG_COUNT = 28;
const JONG_RIEUL = 8;

type Coda = "none" | "rieul" | "other";

// ponytail: 숫자·영문은 읽는 소리 근사. 숫자는 끝 자리 읽기만 보고(0으로 끝나면 십·백·천이라 받침 있음), 영문은 끝 글자 규칙이라 apple(애플) 같은 예외는 틀린다. 틀리는 사례가 쌓이면 발음 사전으로 바꾼다
const DIGIT_CODA: Record<string, Coda> = { "0": "other", "1": "rieul", "3": "other", "6": "other", "7": "rieul", "8": "rieul" };
const EN_RIEUL = /l$/i;
const EN_OTHER = /(m|n|ng|k|ck|p|t|b)$/i;

function lastCoda(word: string): Coda {
  const trimmed = word.replace(/[^0-9A-Za-z가-힣]+$/, "");
  const ch = trimmed.slice(-1);
  if (!ch) return "none";
  const code = ch.charCodeAt(0);
  if (code >= HANGUL_START && code <= HANGUL_END) {
    const jong = (code - HANGUL_START) % JONG_COUNT;
    return jong === 0 ? "none" : jong === JONG_RIEUL ? "rieul" : "other";
  }
  if (/[0-9]/.test(ch)) return DIGIT_CODA[ch] ?? "none";
  if (EN_RIEUL.test(trimmed)) return "rieul";
  return EN_OTHER.test(trimmed) ? "other" : "none";
}

// 조사만 돌려준다. "으로/로"는 ㄹ 받침 뒤에도 "로"
export function josa(word: string, pair: JosaPair): string {
  const [withCoda, withoutCoda] = PAIRS[pair];
  const coda = lastCoda(word);
  if (pair === "으로/로") return coda === "other" ? withCoda : withoutCoda;
  return coda === "none" ? withoutCoda : withCoda;
}

// 단어에 조사를 붙여 돌려준다
export const withJosa = (word: string, pair: JosaPair) => `${word}${josa(word, pair)}`;

// --- 변수 뒤 조사 교정 (AIWITH-567) ---
// 값(앞말) 바로 뒤에 붙은 조사를 값의 받침에 맞게 고친다. 작성자가 어느 쪽으로 써도(예: 이에요/예요) 맞추고, 병기형(을/를, (이)에요)은 하나로 바꾼다

// forms: [받침 있을 때, 없을 때]. ro: 으로/로 계열(ㄹ 받침이면 로). plain: 단독형 표기, explicit: 병기형 표기
// tail: 조사 뒤에 더 이어져도 되는 어미·조사 (그 밖의 한글이 이어지면 단어의 일부로 보고 건드리지 않는다)
type Rule = { forms: readonly [string, string]; ro?: boolean; plain: string[]; explicit: string[]; tail?: RegExp };

const RULES: Rule[] = [
  { forms: ["이에요", "예요"], plain: ["이에요", "예요"], explicit: ["(이)에요"] },
  { forms: ["이었", "였"], plain: ["이었", "였"], explicit: ["(이)었", "(이)였"], tail: /^(어|다|던|고|는|지|으|을|습|죠|기)/ },
  { forms: ["이야", "야"], plain: ["이야"], explicit: ["(이)야"] },
  { forms: ["이라고", "라고"], plain: ["이라고", "라고"], explicit: ["(이)라고"], tail: /^(요|도|는|만)/ },
  { forms: ["이랑", "랑"], plain: ["이랑", "랑"], explicit: ["(이)랑"] },
  { forms: ["이나", "나"], plain: ["이나", "나"], explicit: ["(이)나"] },
  { forms: ["으로서", "로서"], ro: true, plain: ["으로서", "로서"], explicit: ["(으)로서"], tail: /^(의|도|는|만)/ },
  { forms: ["으로써", "로써"], ro: true, plain: ["으로써", "로써"], explicit: ["(으)로써"], tail: /^(의|도|는|만)/ },
  { forms: ["으로", "로"], ro: true, plain: ["으로", "로"], explicit: ["(으)로"], tail: /^(부터|도|는|만)/ },
  { forms: ["이", "가"], plain: ["이", "가"], explicit: ["이/가", "가/이", "(이)가"] },
  { forms: ["을", "를"], plain: ["을", "를"], explicit: ["을/를", "를/을", "(을)를"] },
  { forms: ["은", "는"], plain: ["은", "는"], explicit: ["은/는", "는/은", "(은)는"] },
  { forms: ["과", "와"], plain: ["과", "와"], explicit: ["과/와", "와/과", "(과)와"] },
  // 호격. "야"는 이야/야 보다 호격으로 본다 (달밤툰야 -> 달밤툰아)
  { forms: ["아", "야"], plain: ["아", "야"], explicit: ["아/야", "야/아"] },
];

// 병기형을 먼저, 같은 종류 안에서는 긴 표기 먼저
const CANDIDATES = RULES.flatMap((rule) => [
  ...rule.explicit.map((text) => ({ text, rule, explicit: true })),
  ...rule.plain.map((text) => ({ text, rule, explicit: false })),
]).sort((a, b) => Number(b.explicit) - Number(a.explicit) || b.text.length - a.text.length);

// 조사 뒤 경계: 끝, 공백, 문장부호, 다음 {{ 토큰
const BOUNDARY = /^(\s|[.,!?~…)\]'"”’」』:;])/;

function pickForm(rule: Rule, coda: Coda): string {
  const [withCoda, withoutCoda] = rule.forms;
  if (rule.ro) return coda === "other" ? withCoda : withoutCoda;
  return coda === "none" ? withoutCoda : withCoda;
}

// 값 바로 뒤 글(following)이 조사로 시작하면 값에 맞게 고쳐 돌려준다. 단독형은 뒤가 경계(또는 허용 어미)일 때만, 병기형은 항상
export function fixJosaAfter(value: string, following: string): string {
  const coda = lastCoda(value);
  for (const { text, rule, explicit } of CANDIDATES) {
    if (!following.startsWith(text)) continue;
    const rest = following.slice(text.length);
    const ok = explicit || rest === "" || rest.startsWith("{{") || BOUNDARY.test(rest) || rule.tail?.test(rest);
    if (ok) return pickForm(rule, coda) + rest;
  }
  return following;
}
