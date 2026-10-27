// AI 출력에 섞이는 외국 문자(한자·가나·태국 문자 등) 검사.
// Llama 3.3 이 한국어를 쓰다 한자어를 중국어·일본어로 바꿔 쓰는 일이 잦다 (findings/avocado-ai-korean-quality.md)
export type OutputLang = "ko" | "en";

// Common 은 숫자·문장부호·기호·이모지, Inherited 는 결합 문자(변형 선택자·ZWJ)
const ALLOWED: Record<OutputLang, RegExp> = {
  ko: /[\p{Script=Hangul}\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u,
  en: /[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u,
};

// 허용 밖 문자를 중복 없이 돌려준다. allowed 에 든 문자(제품 이름 등 입력에 있던 글자)는 통과
export function foreignChars(text: string, lang: OutputLang = "ko", allowed = ""): string[] {
  const found = new Set<string>();
  for (const ch of text) if (!ALLOWED[lang].test(ch) && !allowed.includes(ch)) found.add(ch);
  return [...found];
}

export const hasForeignChars = (text: string, lang: OutputLang = "ko", allowed = "") => foreignChars(text, lang, allowed).length > 0;

const SENTENCE_END = /(?<=[.!?。！？])\s+/;

// 조건에 걸린 문장만 뺀다. 문장 구분이 없으면 통째로 비워진다
export function dropSentences(text: string, bad: (sentence: string) => boolean): string {
  return text
    .split(SENTENCE_END)
    .filter((s) => !bad(s))
    .join(" ");
}

// 크리에이터에게 보이는 문구에 나오면 안 되는 브랜드 내부 용어
const INTERNAL_TERMS = /광고\s*소재|UGC|퍼포먼스\s*마케팅|전환\s*캠페인/i;
export const hasInternalTerm = (text: string) => INTERNAL_TERMS.test(text);
