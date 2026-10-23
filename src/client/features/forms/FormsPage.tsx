import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState, LoadingState, PageHeader, Table, ButtonLink } from "../../ui";
import { api } from "../../lib/api";
import { dateTime, ZERO_HINT, type FormRow } from "../links/common";

export { FormEditorPage } from "./FormEditorPage";

// /forms: 폼 목록
export function FormsPage() {
  const [forms, setForms] = useState<FormRow[] | null>(null);
  useEffect(() => {
    void api.get<{ forms: FormRow[] }>("/forms").then((r) => setForms(r.forms));
  }, []);
  const create = <ButtonLink variant="primary" to="/dashboard/forms/new">폼 만들기</ButtonLink>;
  return (
    <>
      <PageHeader title="신청 폼" description="자료가 없어도 체험·샘플·출시 알림 신청을 받아요. 리드 링크의 목적지로 쓰면 어느 인플루언서에게서 왔는지 남아요." actions={create} />
      {!forms && <LoadingState />}
      {forms && forms.length === 0 && <EmptyState title="아직 만든 폼이 없어요" description="폼을 만들고 가이드의 '리드 링크' 탭에서 목적지로 고르면 신청이 리드로 쌓여요." action={create} />}
      {forms && forms.length > 0 && <FormTable forms={forms} />}
    </>
  );
}

function FormTable({ forms }: { forms: FormRow[] }) {
  return (
    <Table>
      <thead><tr><th>제목</th><th className="num">제출</th><th>마감</th><th>만든 날</th></tr></thead>
      <tbody>
        {forms.map((f) => (
          <tr key={f.id}>
            <td><Link to={`/dashboard/forms/${f.id}`}>{f.title}</Link></td>
            <td className={f.submissions ? "num" : "wrap"}>{f.submissions || ZERO_HINT}{f.maxSubmissions ? ` / ${f.maxSubmissions}` : ""}</td>
            <td className="nowrap">{f.closesAt ? dateTime(f.closesAt) : "없음"}</td>
            <td className="nowrap">{dateTime(f.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
