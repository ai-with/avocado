import { useState } from "react";
import { useParams } from "react-router-dom";
import { Button, LoadingState, PageHeader } from "../../ui";
import { useMe } from "../../lib/me";
import type { DocumentGate } from "../../../shared/leads";
import { docSize, type DocumentDetail } from "../links/common";
import { DocumentSettingsModal } from "../links/DocumentPanel";
import { DocViewer } from "./DocViewer";
import { DocSourcePanel } from "./sections/DocSourcePanel";
import { GatePanel } from "./sections/GatePanel";
import { useDocumentEdit } from "./useDocumentEdit";
import "../links/lead-tools.css";
import "./docs.css";

type PreviewProps = { id: string; doc: DocumentDetail; gate: DocumentGate; html: string; onClose: () => void };

// 읽는 사람 화면 그대로(제출은 안 됨). 불러오지 못한 주소는 열자마자 묻는 것으로 보여 준다
function DocPreview({ id, doc, gate, html, onClose }: PreviewProps) {
  const { me } = useMe();
  return (
    <DocViewer
      title={doc.title}
      brandName={me?.workspace?.name ?? ""}
      sourceType={doc.sourceType}
      pages={doc.pages}
      html={doc.sourceType === "editor" ? html : null}
      fileUrl={doc.sourceType === "pdf" ? `/api/documents/${id}/file` : null}
      snapshotUrl={doc.fetchedHtmlKey ? `/api/documents/${id}/snapshot?t=${doc.fetchedAt ?? 0}` : null}
      sourceUrl={doc.sourceUrl}
      gate={doc.sourceType === "url" && !doc.fetchedHtmlKey ? { ...gate, scrollPct: 0 } : gate}
      passed={false}
      barRight={<Button size="sm" variant="secondary" onClick={onClose}>미리보기 닫기</Button>}
    />
  );
}

// /documents/:id: 본문 편집(직접 쓰기), 주소 다시 불러오기, 정보 입력 다이얼로그 노출 시점과 미리보기
export function DocumentEditPage() {
  const { id = "" } = useParams();
  const s = useDocumentEdit(id);
  const [settings, setSettings] = useState(false);
  const [preview, setPreview] = useState(false);
  const { doc, gate } = s;
  if (!doc || !gate) return <LoadingState />;
  return (
    <>
      <PageHeader
        title={doc.title}
        description={docSize(doc)}
        back={{ to: "/dashboard/links", label: "리드 링크" }}
        actions={<Button variant="secondary" onClick={() => setPreview(true)}>미리보기</Button>}
      />
      <div className="lt-split">
        <DocSourcePanel doc={doc} s={s} />
        <GatePanel doc={doc} gate={gate} onChange={s.changeGate} onPreview={() => setPreview(true)} onSettings={() => setSettings(true)} />
      </div>
      {settings && <DocumentSettingsModal doc={{ ...doc, gate }} onClose={() => setSettings(false)} onSaved={() => void s.load()} />}
      {preview && <DocPreview id={id} doc={doc} gate={gate} html={s.html} onClose={() => setPreview(false)} />}
    </>
  );
}
