import { useState } from "react";
import { ActionBar, Button, PageHeader } from "../../ui";
import { useMe } from "../../lib/me";
import { useGuideForm } from "./useGuideForm";
import { BasicInfoSection } from "./sections/BasicInfoSection";
import { DeliverablesSection } from "./sections/DeliverablesSection";
import { RulesSection } from "./sections/RulesSection";
import { VideoGuideSection } from "./sections/VideoGuideSection";
import { GuidePreviewPanel } from "./sections/GuidePreviewPanel";
import "./guides.css";

// /guides/new, /guides/:id/edit (F-55 가이드 전용 규칙, F-56 초안 생성, AIWITH-367 미리보기)
export function GuideEditPage() {
  const g = useGuideForm();
  const { me } = useMe();
  const [previewOpen, setPreviewOpen] = useState(false);
  // 좁은 화면 전용. 넓은 화면에서는 미리보기가 항상 오른쪽에 있어 CSS 로 숨긴다
  const toggle = (
    <Button variant="secondary" className="guide-preview-toggle" aria-expanded={previewOpen} aria-controls="guide-preview" onClick={() => setPreviewOpen(!previewOpen)}>
      {previewOpen ? "미리보기 닫기" : "미리보기"}
    </Button>
  );
  return (
    <form onSubmit={g.save}>
      <PageHeader
        title={g.id ? "가이드 편집" : "새 가이드"}
        description="제품과 목적, 규정을 넣고 저장하면 바로 공유할 수 있는 가이드 URL이 나와요."
        back={g.id ? { to: `/dashboard/guides/${g.id}`, label: "가이드 상세" } : { to: "/dashboard/guides", label: "가이드" }}
        actions={toggle}
      />
      <div className="guide-edit-layout">
        <div className="stack-loose">
          <BasicInfoSection form={g.form} set={g.set} fields={g.fields} />
          <DeliverablesSection form={g.form} set={g.set} />
          <RulesSection form={g.form} set={g.set} sets={g.sets} setRules={g.setRules} warnings={g.warnings} fields={g.fields} />
          <VideoGuideSection vg={g.form.videoGuide} setVg={g.setVg} set={g.set} rules={g.rules} vgWarnings={g.vgWarnings} busy={g.busy} onGenerate={g.generate} />
        </div>
        <GuidePreviewPanel form={g.form} rules={g.rules} brandName={me?.workspace?.name ?? ""} open={previewOpen} />
      </div>
      <ActionBar status="저장하면 가이드 상세 화면으로 이동해요.">
        <Button variant="ghost" onClick={g.cancel}>취소</Button>
        <Button type="submit" disabled={g.busy !== ""}>{g.busy === "save" ? "저장 중" : "저장"}</Button>
      </ActionBar>
    </form>
  );
}
