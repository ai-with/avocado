import { ButtonAnchor } from "../../ui";
import { useRef, useState, type ReactNode, type RefObject } from "react";
import type { DocumentSourceType, GateQuestion } from "../../../shared/leads";
import { sanitizeHtml } from "../../../shared/sanitize";
import type { VisitorValues } from "../forms/VisitorForm";
import { GateDialog } from "./GateDialog";
import { useGateScroll } from "./useGateScroll";
import { useViewerContent } from "./usePdfPages";
import "./docs.css";

export type ViewerGate = { position: "none" | "scroll"; scrollPct: number; fields: { name: boolean; company: boolean; phone: boolean }; questions: GateQuestion[]; companyEmailOnly: boolean; requireVerify?: boolean };

type Props = {
  title: string;
  brandName: string;
  sourceType: DocumentSourceType;
  pages: number;
  // 원본 유형별 본문. 통과 전이면 서버가 게이트 앞부분만 주고(0% 는 비어 있음), 통과하면 전체를 준다
  html: string | null;
  fileUrl: string | null;
  snapshotUrl: string | null;
  sourceUrl: string | null;
  gate: ViewerGate;
  passed: boolean;
  // 없으면 미리보기(제출 안 됨, 닫으면 계속 읽기)
  onSubmit?: (v: VisitorValues) => Promise<void>;
  onProgress?: (p: { pct: number; page: number }) => void;
  barRight?: ReactNode;
  // 있으면 다이얼로그에서 입력 폼 대신 보여 준다(인증 메일 대기 등)
  gateNotice?: ReactNode;
};

type BodyProps = Pick<Props, "title" | "sourceType" | "html" | "snapshotUrl" | "sourceUrl"> & {
  error: string;
  bodyRef: RefObject<HTMLDivElement | null>;
  pagesRef: RefObject<HTMLDivElement | null>;
  frameRef: RefObject<HTMLIFrameElement | null>;
  onFrameLoad: () => void;
};

function UnembeddableNote({ sourceUrl }: { sourceUrl: string | null }) {
  return (
    <div className="dv-note visitor-card">
      <b>이 주소는 화면 안에서 보여 줄 수 없어요</b>
      <p className="text-secondary">원래 페이지를 새 창에서 열어 볼 수 있어요.</p>
      {sourceUrl && <ButtonAnchor variant="primary" href={sourceUrl} target="_blank" rel="noopener noreferrer">새 창으로 열기</ButtonAnchor>}
    </div>
  );
}

function ViewerBody({ title, sourceType, html, snapshotUrl, sourceUrl, error, bodyRef, pagesRef, frameRef, onFrameLoad }: BodyProps) {
  return (
    <div className={`dv-body dv-${sourceType}`} ref={bodyRef}>
      {error && <p className="dv-note" role="alert">{error}</p>}
      {sourceType === "editor" && html !== null && <article className="doc-prose dv-article" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />}
      {sourceType === "pdf" && <div className="viewer-pages" ref={pagesRef} />}
      {sourceType === "url" && snapshotUrl && (
        <iframe
          ref={frameRef}
          className="dv-frame"
          title={title}
          src={snapshotUrl}
          // 스크립트 없이 같은 출처로만 띄워 부모가 스크롤을 읽고 막는다. 링크는 새 창으로 연다
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          onLoad={onFrameLoad}
        />
      )}
      {sourceType === "url" && !snapshotUrl && <UnembeddableNote sourceUrl={sourceUrl} />}
    </div>
  );
}

// 자료 뷰어. 본문이 바로 보이고, 보인 최하단이 게이트 비율에 닿으면 본문 위에 정보 입력 다이얼로그를 띄우고 그 아래로는 못 내려가게 막는다
export function DocViewer({ title, brandName, sourceType, html, fileUrl, snapshotUrl, sourceUrl, gate, passed, onSubmit, onProgress, barRight, gateNotice }: Props) {
  const preview = !onSubmit;
  const [previewPassed, setPreviewPassed] = useState(false);
  const needGate = gate.position === "scroll" && !passed && !previewPassed;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const refs = { bodyRef: useRef<HTMLDivElement>(null), pagesRef: useRef<HTMLDivElement>(null), frameRef: useRef<HTMLIFrameElement>(null) };
  const page = useRef(1);
  const { dialog, setDialog } = useGateScroll({ sourceType, needGate, scrollPct: gate.scrollPct, ready, page, onProgress, bodyRef: refs.bodyRef, frameRef: refs.frameRef });
  useViewerContent({ sourceType, html, fileUrl, snapshotUrl, page, setReady, setError, bodyRef: refs.bodyRef, pagesRef: refs.pagesRef });

  return (
    <div className="dv">
      <div className="viewer-bar">
        <div className="dv-bar-text">
          <span className="visitor-brand">{brandName}</span>
          <b className="dv-title">{title}</b>
        </div>
        {barRight}
      </div>
      <ViewerBody title={title} sourceType={sourceType} html={html} snapshotUrl={snapshotUrl} sourceUrl={sourceUrl} error={error} {...refs} onFrameLoad={() => setReady(true)} />
      {dialog && needGate && (
        <GateDialog brandName={brandName} title={title} gate={gate} preview={preview} onSubmit={onSubmit} onPreviewPass={() => setPreviewPassed(true)} onClose={() => setDialog(false)}>
          {gateNotice}
        </GateDialog>
      )}
    </div>
  );
}
