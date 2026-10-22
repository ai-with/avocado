import { lazy, Suspense } from "react";
import type { JSONContent } from "@tiptap/react";
import { Badge, Button, Card, Input, LoadingState } from "../../../ui";
import { DOC_SOURCE_LABELS } from "../../../../shared/leads";
import { dateTime, type DocumentDetail } from "../../links/common";
import type { DocumentEditState } from "../useDocumentEdit";

// 에디터(Tiptap)는 무거워서 편집 화면에서만 불러온다
const BlockEditor = lazy(() => import("../BlockEditor").then((m) => ({ default: m.BlockEditor })));

const saveStatus = (s: DocumentEditState) => (s.saving ? "저장하는 중" : s.typing ? "입력 중" : s.savedAt ? `${dateTime(s.savedAt)} 저장됨` : "입력하면 자동으로 저장돼요");

function UrlSourceCard({ doc, s }: { doc: DocumentDetail; s: DocumentEditState }) {
  return (
    <Card className="stack">
      <a className="lt-mono" href={doc.sourceUrl ?? "#"} target="_blank" rel="noopener noreferrer">{doc.sourceUrl}</a>
      <p className="text-secondary">
        {doc.fetchedHtmlKey
          ? `${dateTime(doc.fetchedAt)}에 떠 둔 화면을 보여 줘요. 원래 페이지를 고쳤다면 다시 불러오세요.`
          : "이 주소는 불러올 수 없어요. 읽는 사람에게는 열자마자 정보 입력을 받고 새 창으로 열기 링크만 보여 줘요."}
      </p>
      <div><Button size="sm" variant="secondary" disabled={s.refetching} onClick={() => void s.refetch()}>{s.refetching ? "불러오는 중" : "페이지 다시 불러오기"}</Button></div>
    </Card>
  );
}

// 편집 화면 왼쪽: 원본 유형, 저장 상태, 제목, 원본별 본문
export function DocSourcePanel({ doc, s }: { doc: DocumentDetail; s: DocumentEditState }) {
  return (
    <div className="stack">
      <div className="row">
        <Badge tone="info">{DOC_SOURCE_LABELS[doc.sourceType]}</Badge>
        {doc.sourceType === "editor" && <span className="text-caption" role="status">{saveStatus(s)}</span>}
      </div>
      <Input label="제목" defaultValue={doc.title} onBlur={(e) => void s.saveTitle(e.target.value)} />
      {doc.sourceType === "editor" && (
        <Card>
          <Suspense fallback={<LoadingState label="에디터를 여는 중" />}>
            <BlockEditor content={(doc.contentJson ?? { type: "doc" }) as JSONContent} onChange={s.onContent} />
          </Suspense>
        </Card>
      )}
      {doc.sourceType === "pdf" && (
        <Card className="stack">
          <b>PDF {doc.pages}페이지 · {doc.sizeMb}MB</b>
          <p className="text-secondary">파일을 바꾸려면 새 자료로 올려 주세요. 미리보기에서 읽는 사람 화면을 확인할 수 있어요.</p>
        </Card>
      )}
      {doc.sourceType === "url" && <UrlSourceCard doc={doc} s={s} />}
    </div>
  );
}
