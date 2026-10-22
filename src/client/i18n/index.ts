import { ko, type Dict } from "./ko";
import { en } from "./en";

export type Lang = "ko" | "en";
export type TKey = keyof Dict;
const dicts: Record<Lang, Dict> = { ko, en };

// 공개 페이지용. 브랜드 화면은 한국어 고정이라 쓰지 않는다
export const makeT = (lang: Lang) => (key: TKey) => dicts[lang][key];
