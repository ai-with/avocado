import { Input, SectionCard, Select, Textarea } from "../../../ui";
import { lines, toDateInput, type GuideForm, type SetField } from "../useGuideForm";

type Props = { form: GuideForm; set: SetField; fields: Record<string, string> };

export function BasicInfoSection({ form, set, fields }: Props) {
  const setProduct = (patch: Partial<GuideForm["product"]>) => set("product", { ...form.product, ...patch });
  return (
    <SectionCard title="기본 정보">
      <div className="stack">
        <Input label="가이드 이름" value={form.name} onChange={(e) => set("name", e.target.value)} error={fields.name} placeholder="예: 여름 글로우 세럼 릴스" required maxLength={80} />
        <div className="grid-2">
          <Input label="제품 이름" value={form.product.name} onChange={(e) => setProduct({ name: e.target.value })} error={fields["product.name"]} />
          <Input label="영상 목적" value={form.purpose} onChange={(e) => set("purpose", e.target.value)} placeholder="예: 광고 소재용 UGC, 계정 게시용" />
        </div>
        <div className="grid-3">
          {form.product.benefits.map((b, i) => (
            <Input key={i} label={`핵심 효능 ${i + 1}`} value={b} onChange={(e) => setProduct({ benefits: form.product.benefits.map((x, j) => (j === i ? e.target.value : x)) })} />
          ))}
        </div>
        <Textarea label="사용법" value={form.product.usage} onChange={(e) => setProduct({ usage: e.target.value })} />
        <Textarea label="제품 사진 주소 (한 줄에 하나)" value={form.product.photos.join("\n")} onChange={(e) => setProduct({ photos: lines(e.target.value) })} />
        <div className="grid-3">
          <Input label="영상 길이(초)" type="number" min={5} max={180} value={form.lengthS ?? ""} onChange={(e) => set("lengthS", e.target.value ? Number(e.target.value) : null)} error={fields.lengthS} />
          <Select label="인플루언서 기본 언어" value={form.lang} onChange={(e) => set("lang", e.target.value as "ko" | "en")}>
            <option value="ko">한국어</option>
            <option value="en">영어</option>
          </Select>
          <Input label="초안 마감일" type="date" value={toDateInput(form.deadlineAt)} onChange={(e) => set("deadlineAt", e.target.value ? new Date(`${e.target.value}T23:59:59`).getTime() : null)} />
        </div>
      </div>
    </SectionCard>
  );
}
