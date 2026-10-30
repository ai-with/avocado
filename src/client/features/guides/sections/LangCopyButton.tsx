import { useState } from "react";
import { CopyButton, SelectMenu } from "../../../ui";
import { withLangParam, type GuideLang } from "../../../../shared/guide-public";

const LANG_OPTIONS = [{ value: "ko", label: "한국어" }, { value: "en", label: "영어" }];

type Props = { url: string; defaultLang: GuideLang; label?: string; size?: "sm" | "md"; disabled?: boolean };

// 공개 가이드 링크를 화면 언어(?lang=)와 함께 복사한다 (AIWITH-373). 기본값은 인플루언서·가이드 언어
export function LangCopyButton({ url, defaultLang, label = "복사", size = "sm", disabled }: Props) {
  const [lang, setLang] = useState<GuideLang>(defaultLang);
  return (
    <span className={`lang-copy lang-copy-${size}`}>
      <SelectMenu size={size} aria-label="링크 언어" options={LANG_OPTIONS} value={lang} onChange={(v) => v && setLang(v as GuideLang)} disabled={disabled} />
      {/* md 입력칸(56) 옆이라 버튼도 같은 높이(xl) */}
      <CopyButton text={withLangParam(url, lang)} label={label} size={size === "md" ? "xl" : "sm"} disabled={disabled} doneMessage={lang === "en" ? "영어 링크를 복사했어요." : "한국어 링크를 복사했어요."} />
    </span>
  );
}
