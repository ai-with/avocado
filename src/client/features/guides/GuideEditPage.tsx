import { ActionBar, Button, PageHeader } from "../../ui";
import { useGuideForm } from "./useGuideForm";
import { BasicInfoSection } from "./sections/BasicInfoSection";
import { DeliverablesSection } from "./sections/DeliverablesSection";
import { RulesSection } from "./sections/RulesSection";
import { VideoGuideSection } from "./sections/VideoGuideSection";
import "./guides.css";

// /guides/new, /guides/:id/edit (F-55 가이드 전용 규칙, F-56 초안 생성)
export function GuideEditPage() {
  const g = useGuideForm();
  return (
    <form onSubmit={g.save}>
      <PageHeader
        title={g.id ? "가이드 편집" : "새 가이드"}
        description="제품과 목적, 규정을 넣고 저장하면 바로 공유할 수 있는 가이드 URL이 나와요."
        back={g.id ? { to: `/guides/${g.id}`, label: "가이드 상세" } : { to: "/guides", label: "가이드" }}
      />
      <div className="stack-loose">
        <BasicInfoSection form={g.form} set={g.set} fields={g.fields} />
        <DeliverablesSection form={g.form} set={g.set} />
        <RulesSection form={g.form} set={g.set} sets={g.sets} setRules={g.setRules} warnings={g.warnings} fields={g.fields} />
        <VideoGuideSection vg={g.form.videoGuide} setVg={g.setVg} set={g.set} rules={g.rules} vgWarnings={g.vgWarnings} busy={g.busy} onGenerate={g.generate} />
      </div>
      <ActionBar status="저장하면 가이드 상세 화면으로 이동해요.">
        <Button variant="ghost" onClick={g.cancel}>취소</Button>
        <Button type="submit" disabled={g.busy !== ""}>{g.busy === "save" ? "저장 중" : "저장"}</Button>
      </ActionBar>
    </form>
  );
}
