import type { FormEvent } from "react";
import { Button, Input, SectionCard, Select, Textarea } from "../../../ui";
import { SUPPORT_BODY_MAX, SUPPORT_BODY_MIN, SUPPORT_TYPES, isSupportType } from "../../../../shared/support";
import type { useSupport } from "../useSupport";

type Props = { s: ReturnType<typeof useSupport> };

// 문의 유형, 내용, 회신 이메일
export function SupportForm({ s }: Props) {
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void s.send();
  };
  return (
    <SectionCard title="문의 남기기" description="남겨 주신 내용을 확인하고 회신 이메일로 답해 드려요.">
      <form className="stack" noValidate onSubmit={onSubmit}>
        <Select label="문의 유형" required value={s.draft.type} onChange={(e) => isSupportType(e.target.value) && s.set("type", e.target.value)} error={s.fields.type}>
          {SUPPORT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </Select>
        <Textarea
          label="내용"
          required
          rows={6}
          maxLength={SUPPORT_BODY_MAX}
          placeholder="어떤 화면에서 무엇을 하려다 막혔는지 적어 주세요."
          hint={`${SUPPORT_BODY_MIN}자 이상, ${s.draft.body.length.toLocaleString("ko-KR")}/${SUPPORT_BODY_MAX.toLocaleString("ko-KR")}자`}
          value={s.draft.body}
          onChange={(e) => s.set("body", e.target.value)}
          error={s.fields.body}
        />
        <Input label="회신 이메일" type="email" required autoComplete="email" value={s.draft.replyEmail} onChange={(e) => s.set("replyEmail", e.target.value)} error={s.fields.replyEmail} />
        {s.error && !Object.keys(s.fields).length && <p className="text-danger" role="alert">{s.error}</p>}
        <div className="row row-end">
          <Button type="submit" disabled={s.busy}>{s.busy ? "보내는 중" : "문의 보내기"}</Button>
        </div>
      </form>
    </SectionCard>
  );
}
