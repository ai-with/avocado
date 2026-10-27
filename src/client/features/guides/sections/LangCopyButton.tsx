import { useState } from "react";
import { CopyButton, Select } from "../../../ui";
import { withLangParam, type GuideLang } from "../../../../shared/guide-public";

type Props = { url: string; defaultLang: GuideLang; label?: string; size?: "sm" | "md"; disabled?: boolean };

// 공개 가이드 링크를 화면 언어(?lang=)와 함께 복사한다 (AIWITH-373). 기본값은 인플루언서·가이드 언어
export function LangCopyButton({ url, defaultLang, label = "복사", size = "sm", disabled }: Props) {
  const [lang, setLang] = useState<GuideLang>(defaultLang);
  return (
    <span className={`lang-copy lang-copy-${size}`}>
      <Select aria-label="링크 언어" value={lang} onChange={(e) => setLang(e.target.value as GuideLang)} disabled={disabled}>
        <option value="ko">한국어</option>
        <option value="en">영어</option>
      </Select>
      <CopyButton text={withLangParam(url, lang)} label={label} size={size} disabled={disabled} doneMessage={lang === "en" ? "영어 링크를 복사했어요." : "한국어 링크를 복사했어요."} />
    </span>
  );
}
