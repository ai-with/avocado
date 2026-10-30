import { useState } from "react";
import { LoadingState, PageHeader, Tabs, ButtonLink } from "../../ui";
import { LinkAnalytics } from "./LinkAnalytics";
import { LinkDetailModal } from "./LinkDetailModal";
import { DocumentList } from "./sections/DocumentList";
import { LinksTable } from "./sections/LinksTable";
import { useLinksPage } from "./useLinksPage";
import type { LinkRow } from "./common";
import "./lead-tools.css";

type Tab = "links" | "documents" | "analytics";
const TABS: { value: Tab; label: string }[] = [{ value: "links", label: "전체 링크" }, { value: "documents", label: "자료" }, { value: "analytics", label: "분석" }];

// /links: 워크스페이스 전체 링크·자료 목록, 자료 업로드와 분석
export function LinksPage() {
  const [tab, setTab] = useState<Tab>("links");
  const [open, setOpen] = useState<LinkRow | null>(null);
  const { links, channels, docs, loaded, load, removeDoc } = useLinksPage();

  return (
    <>
      <PageHeader
        title="리드 링크"
        description="인플루언서 × 채널마다 다른 링크로 클릭, 자료 열람, 리드를 나눠 봐요. 링크는 가이드의 '리드 링크' 탭에서 만들어요."
        actions={<ButtonLink variant="primary" to="/dashboard/documents/new">자료 만들기</ButtonLink>}
      />
      <Tabs<Tab> tabs={TABS} value={tab} onChange={setTab} label="리드 링크 보기" />
      {!loaded && tab !== "analytics" && <LoadingState pattern="table" />}
      {loaded && tab === "links" && <LinksTable links={links} channels={channels} docs={docs} onOpen={setOpen} />}
      {loaded && tab === "documents" && <DocumentList docs={docs} channels={channels} onRemove={(d) => void removeDoc(d)} />}
      {tab === "analytics" && <LinkAnalytics channels={channels} />}
      {open && <LinkDetailModal link={open} channels={channels} onClose={() => setOpen(null)} onChanged={() => void load()} />}
    </>
  );
}
