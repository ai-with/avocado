import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Card, Input, PageHeader, useToast } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import type { DocumentSourceType } from "../../../shared/leads";
import { uploadPdf, type DocumentDetail } from "../links/common";
import { FilePickButton } from "../links/FilePickButton";
import "./docs.css";

const SOURCES: { type: DocumentSourceType; title: string; body: string }[] = [
  { type: "editor", title: "직접 쓰기", body: "노션처럼 블록으로 소개 글을 써요. / 를 누르면 제목, 목록, 이미지를 넣을 수 있어요." },
  { type: "pdf", title: "PDF 올리기", body: "회사 소개서나 제품 자료 PDF를 그대로 보여 줘요. 50MB까지." },
  { type: "url", title: "홈페이지 주소", body: "이미 있는 랜딩 페이지 주소를 넣으면 화면을 떠서 보여 줘요." },
];

function SourceCards({ type, onChange }: { type: DocumentSourceType; onChange: (t: DocumentSourceType) => void }) {
  return (
    <div className="source-cards" role="group" aria-label="자료 원본">
      {SOURCES.map((s) => (
        <button key={s.type} type="button" className="source-card" aria-pressed={type === s.type} onClick={() => onChange(s.type)}>
          <b>{s.title}</b>
          <p>{s.body}</p>
        </button>
      ))}
    </div>
  );
}

// 만든 뒤 편집 화면으로 이동. 실패는 토스트로 알린다
function useCreateDocument(guideId: string | undefined) {
  const toast = useToast();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      nav(`/dashboard/documents/${await fn()}`);
    } catch (e) {
      toast(errorMessage(e), "danger");
    } finally {
      setBusy(false);
    }
  };
  const create = (type: DocumentSourceType, title: string, url: string) =>
    run(async () => {
      const { document: d } = await api.post<{ document: DocumentDetail }>("/documents/new", type === "url" ? { sourceType: "url", title, url, guideId } : { sourceType: "editor", title, guideId });
      if (d.sourceType === "url" && !d.fetchedHtmlKey) toast("이 주소는 불러올 수 없어요. 새 창으로 열기 링크만 제공할게요.", "danger");
      return d.id;
    });
  const upload = (f: File | undefined) => {
    if (f) void run(async () => (await uploadPdf(f, guideId)).id);
  };
  return { busy, create, upload };
}

type FieldsProps = { type: DocumentSourceType; busy: boolean; title: string; setTitle: (v: string) => void; url: string; setUrl: (v: string) => void; onCreate: () => void };

function NewDocFields({ type, busy, title, setTitle, url, setUrl, onCreate }: FieldsProps) {
  return (
    <>
      <Input label="제목" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={type === "url" ? "예: 제품 소개 페이지" : "예: 우리 팀이 이 도구를 만든 이유"} />
      {type === "url" && <Input label="홈페이지 주소" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" hint="자바스크립트로만 그려지는 페이지는 비어 보일 수 있어요." />}
      <div>
        <Button disabled={busy || !title.trim() || (type === "url" && !url.trim())} onClick={onCreate}>
          {busy ? (type === "url" ? "페이지를 불러오는 중" : "만드는 중") : "자료 만들기"}
        </Button>
      </div>
    </>
  );
}

// /documents/new: 원본 유형을 고르고 만든 뒤 편집 화면으로 간다
export function DocumentNewPage() {
  const guideId = useSearchParams()[0].get("guideId") ?? undefined;
  const [type, setType] = useState<DocumentSourceType>("editor");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const { busy, create, upload } = useCreateDocument(guideId);
  return (
    <>
      <PageHeader title="자료 만들기" description="인플루언서 링크로 들어온 사람이 읽을 자료예요. 원본을 고르면 읽는 도중 정보 입력을 받을 수 있어요." back={{ to: "/dashboard/links", label: "리드 링크" }} />
      <div className="stack-loose content-medium">
        <SourceCards type={type} onChange={setType} />
        <Card className="stack">
          {type === "pdf" ? (
            <div><FilePickButton variant="primary" size="md" label={busy ? "올리는 중" : "PDF 파일 고르기"} accept="application/pdf" disabled={busy} onFile={upload} /></div>
          ) : (
            <NewDocFields type={type} busy={busy} title={title} setTitle={setTitle} url={url} setUrl={setUrl} onCreate={() => void create(type, title, url)} />
          )}
        </Card>
      </div>
    </>
  );
}
