import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Button, LoadingState } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import type { FormFields } from "../../../shared/leads";
import { VisitorForm } from "./VisitorForm";

type PublicForm = { title: string; description: string; headerImageUrl: string | null; fields: FormFields; brandName: string; closed: "deadline" | "full" | null; closedMessage: string };
type Result = { type: "message" | "document"; text: string; url?: string };

// 공개 신청 폼 /form/:slug (slug = 단축링크)
export function PublicFormPage() {
  const { token = "" } = useParams();
  const [form, setForm] = useState<PublicForm | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Result | null>(null);

  useEffect(() => {
    api.get<PublicForm>(`/public/form/${token}`, { redirectOn401: false }).then(setForm, (e: unknown) => setError(errorMessage(e)));
  }, [token]);

  if (error || done || form?.closed) return <StatusCard form={form} done={done} error={error} />;
  if (!form) {
    return (
      <div className="visitor">
        <div className="visitor-card"><LoadingState /></div>
      </div>
    );
  }
  return (
    <div className="visitor">
      <VisitorForm
        brandName={form.brandName}
        title={form.title}
        description={form.description}
        headerImageUrl={form.headerImageUrl}
        base={form.fields.base.filter((b) => b.enabled)}
        questions={form.fields.questions}
        submitLabel="제출하기"
        onSubmit={async (v) => setDone(await api.post<Result>(`/public/form/${token}/submit`, v, { redirectOn401: false }))}
      />
    </div>
  );
}

// 제출 완료, 마감, 열 수 없음 안내
function StatusCard({ form, done, error }: { form: PublicForm | null; done: Result | null; error: string }) {
  return (
    <div className="visitor">
      <div className="visitor-card text-center">
        {form && <span className="visitor-brand">{form.brandName}</span>}
        <h3>{done ? "제출했어요" : form?.closed ? "마감된 신청이에요" : "폼을 열 수 없어요"}</h3>
        <p className="text-secondary pre-wrap">{done?.text || (form?.closed ? form.closedMessage : error)}</p>
        {done?.type === "document" && done.url && <Button onClick={() => location.assign(done.url!)}>자료 보기</Button>}
      </div>
    </div>
  );
}
