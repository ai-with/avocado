import { Disclosure } from "../../../ui";
import type { PublicDictionary } from "../../../../shared/brand-terms";
import type { T } from "../guideTypes";
import { PublicSection, TextList } from "./PublicShell";

// 브랜드 검수 사전 (TASK-079). 항목은 브랜드가 쓴 그대로 보여 주고 라벨만 화면 언어로 바꾼다
export function DictionarySections({ d, t }: { d: PublicDictionary; t: T }) {
  const products = d.products.map((p) => (p.variants.length ? `${p.term} (${t("dict_wrong")}: ${p.variants.join(", ")})` : p.term));
  const forbidden = d.forbidden.map((f) => [f.term, ...f.variants].join(", ") + (f.suggestion ? ` → ${t("dict_instead")}: ${f.suggestion}` : ""));
  return (
    <>
      {d.required.length > 0 && <PublicSection title={t("dict_required")}><TextList items={d.required} /></PublicSection>}
      {d.hashtags.length > 0 && <PublicSection title={t("dict_hashtags")}><TextList items={d.hashtags} /></PublicSection>}
      {products.length > 0 && <PublicSection title={t("dict_products")}><TextList items={products} /></PublicSection>}
      {forbidden.length > 0 && <PublicSection title={t("dict_forbidden")}><TextList items={forbidden} className="pub-forbidden" /></PublicSection>}
      {d.legal.length > 0 && (
        <PublicSection title={t("dict_legal")}>
          <Disclosure title={t("dict_legal_hint")} count={d.legal.length}>
            <TextList items={d.legal.map((l) => (l.suggestion ? `${l.term} → ${t("dict_instead")}: ${l.suggestion}` : l.term))} className="pub-forbidden" />
          </Disclosure>
        </PublicSection>
      )}
    </>
  );
}
