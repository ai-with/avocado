import { useState } from "react";
import { Button, EmptyState, LoadingState, PageHeader } from "../../ui";
import { useSites } from "./useSites";
import { SiteCard } from "./sections/SiteCard";
import { SiteFormModal } from "./sections/SiteFormModal";
import { PrivacyNotice } from "./sections/PrivacyNotice";
import type { Site } from "./api";
import "./sites.css";

// 모달 상태: 닫힘(null), 새 사이트("new"), 기존 사이트 설정
type Editing = Site | "new" | null;

// /sites: 브랜드 사이트에 스크립트를 설치해 리드 링크 클릭 뒤 방문·스크롤·전환을 잇는다 (docs/14)
export function SitesPage() {
  const { sites, load, rotateKey, remove } = useSites();
  const [editing, setEditing] = useState<Editing>(null);
  const add = <Button onClick={() => setEditing("new")}>사이트 등록</Button>;

  return (
    <>
      <PageHeader
        title="사이트 분석"
        description="브랜드 사이트에 스크립트 한 줄을 넣으면 리드 링크로 들어온 방문의 스크롤·전환이 인플루언서 × 채널별로 묶여요. 가이드 '리드' 탭의 묶어 보기에서 함께 봐요."
        actions={add}
      />
      {!sites && <LoadingState />}
      {sites && sites.length === 0 && (
        <EmptyState icon="globe" title="아직 등록한 사이트가 없어요" description="사이트 이름과 도메인을 등록하면 설치 스니펫이 나와요. 스크립트를 넣은 뒤 첫 방문이 들어오면 여기서 바로 확인돼요." action={add} />
      )}
      {sites && sites.length > 0 && (
        <div className="stack">
          {sites.map((s) => <SiteCard key={s.id} site={s} onEdit={setEditing} onRotate={rotateKey} onRemove={remove} />)}
          <PrivacyNotice />
        </div>
      )}
      {editing && (
        <SiteFormModal
          site={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </>
  );
}
