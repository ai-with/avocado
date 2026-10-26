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
