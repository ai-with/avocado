// 입력칸 공용 순수 함수. 화면 밖에서 시험할 수 있게 React 와 분리했다

// Number.MAX_SAFE_INTEGER(9,007,199,254,740,991)가 16자리라 15자리까지만 받으면 정밀도가 깨지지 않는다
export const MAX_NUMBER_DIGITS = 15;

// 사용자가 친 글에서 숫자만 남긴다. 붙여 넣은 "1,200원", "₩ 3 000"도 숫자로 읽힌다
export function digitsOnly(text: string): string {
  return text.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, MAX_NUMBER_DIGITS);
}

// 숫자 글자를 천 단위 쉼표로. "1234567" → "1,234,567"
export function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatNumberInput(value: number | null): string {
  return value === null ? "" : groupThousands(String(Math.trunc(Math.abs(value))));
}

export function parseNumberInput(text: string): number | null {
  const digits = digitsOnly(text);
  return digits === "" ? null : Number(digits);
}

// 소수 입력: 숫자와 점 하나만. 입력 중 "12." "0.0" 같은 중간 상태를 그대로 보여 주려고 표시 글자를 따로 다룬다
// 받을 수 없는 글(다른 글자, 점 두 개, 소수 자리 초과, 정수 15자리 초과)이면 null 을 돌려 이전 글자를 유지하게 한다
export function normalizeDecimalInput(raw: string, maxDecimals?: number): string | null {
  const plain = raw.replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(plain)) return null;
  const [intPart = "", fraction] = plain.split(".");
  const intDigits = intPart.replace(/^0+(?=\d)/, "");
  if (intDigits.length > MAX_NUMBER_DIGITS) return null;
  if (fraction !== undefined && maxDecimals !== undefined && fraction.length > maxDecimals) return null;
  return fraction === undefined ? groupThousands(intDigits) : `${groupThousands(intDigits)}.${fraction}`;
}

export function parseDecimalInput(text: string): number | null {
  const plain = text.replace(/,/g, "");
  if (plain === "" || plain === ".") return null;
  const n = Number(plain);
  return Number.isFinite(n) ? n : null;
}

export function formatDecimalInput(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  const [intPart = "", fraction] = String(Math.abs(value)).split(".");
  return fraction === undefined ? groupThousands(intPart) : `${groupThousands(intPart)}.${fraction}`;
}

// 글자 수는 화면에 보이는 글자 단위로 센다(이모지·결합 문자 하나 = 1자). maxLength 는 UTF-16 단위라 다를 수 있다
const segmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });
export function countChars(text: string): number {
  let n = 0;
  for (const _ of segmenter.segment(text)) n++;
  return n;
}

export function countLabel(current: number, max?: number): string {
  return max === undefined ? `${current}자` : `${current}/${max}`;
}

// 칩 입력: 쉼표로 나눠 앞뒤 공백을 지우고, 빈 것·이미 있는 것(대소문자 무시)은 빼고, max 개까지만 붙인다
export function addTags(current: string[], raw: string, max = Infinity): string[] {
  const seen = new Set(current.map((t) => t.toLowerCase()));
  const next = [...current];
  for (const part of raw.split(",")) {
    const tag = part.trim();
    if (!tag || seen.has(tag.toLowerCase()) || next.length >= max) continue;
    seen.add(tag.toLowerCase());
    next.push(tag);
  }
  return next;
}
