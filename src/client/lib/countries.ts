import { EU_COUNTRIES } from "../../shared/guides";

type Lang = "ko" | "en";
// 자주 쓰는 나라는 위에 고정하고, 나머지(EU)는 화면 언어 이름순. 저장 값은 ISO 코드 그대로
const COMMON_COUNTRIES = ["KR", "US", "JP", "GB", "DE", "FR", "CA", "AU", "SG", "VN", "TH", "ID"];

export type CountryOption = { code: string; label: string };

// 예전에 저장된 값이 코드 형식이 아니면 Intl 이 RangeError 를 던지므로 값 그대로 보여 준다
export function countryName(code: string | null, lang: Lang = "ko"): string {
  if (!code) return "";
  try {
    return new Intl.DisplayNames([lang], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function countryOptions(lang: Lang): CountryOption[] {
  const toOption = (code: string) => ({ code, label: countryName(code, lang) });
  const rest = EU_COUNTRIES.filter((c) => !COMMON_COUNTRIES.includes(c)).map(toOption);
  rest.sort((a, b) => a.label.localeCompare(b.label, lang));
  return [...COMMON_COUNTRIES.map(toOption), ...rest];
}
