import { ActionBar, Button, PageHeader } from "../../ui";
import { useMe } from "../../lib/me";
import { ContentSection, FieldsSection, SubmitSection } from "./sections/FormSettingsSections";
import { LinksSection, PreviewPane, SubmissionsSection } from "./sections/FormResultSections";
import { useFormEditor } from "./useFormEditor";
import "../links/lead-tools.css";
import "./forms.css";

// /forms/:id (new 포함): 왼쪽 설정, 오른쪽 방문자 화면 실시간 미리보기
export function FormEditorPage() {
  const f = useFormEditor();
  const { d, set } = f;
  const brand = useMe().me?.workspace?.name ?? "";
  return (
    <>
      <PageHeader title={f.isNew ? "폼 만들기" : d.title || "폼"} back={{ to: "/forms", label: "폼 목록" }} />
      <div className="lt-split">
        <div className="stack-loose">
          <ContentSection d={d} set={set} guides={f.guides} onPickHeader={(file) => void f.pickHeader(file)} />
          <FieldsSection d={d} set={set} setQ={f.setQ} onMove={f.moveBase} />
          <SubmitSection d={d} set={set} docs={f.docs} />
          {!f.isNew && <LinksSection links={f.links} onMakeLink={() => void f.makeLink()} />}
          {!f.isNew && <SubmissionsSection d={d} subs={f.subs} />}
        </div>
        <PreviewPane d={d} brand={brand} />
      </div>
      <ActionBar>
        <Button onClick={() => void f.save()}>{f.isNew ? "폼 만들기" : "저장"}</Button>
      </ActionBar>
    </>
  );
}
