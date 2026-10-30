import { useParams } from "react-router-dom";
import { Button, ButtonAnchor, LoadingState } from "../../ui";
import { DocViewer } from "./DocViewer";
import { usePublicDoc, useViewTracking, type DocMeta } from "./usePublicDoc";
import { useDocGate } from "./useDocGate";
import { VerifyNotice } from "./sections/VerifyNotice";
import "../links/lead-tools.css";

// 자료를 받기 전 자리 표시, 또는 열 수 없을 때 이유(인증 링크 만료 등은 링크 없이 다시 열게 한다)
function DocStatusScreen({ error }: { error: string }) {
  return (
    <div className="visitor">
      <div className="visitor-card text-center">
        {error ? (
          <>
            <h3>자료를 열 수 없어요</h3>
            <p className="text-secondary">{error}</p>
            <div><ButtonAnchor variant="secondary" href={location.pathname}>자료 다시 열기</ButtonAnchor></div>
          </>
        ) : (
          <LoadingState pattern="detail" label="자료를 불러오는 중" />
        )}
      </div>
    </div>
  );
}

// 원본 주소. 게이트가 있으면 열람 토큰(t)을 붙여야 서버가 파일을 준다
function sourceUrls(slug: string, meta: DocMeta, unlock: string) {
  const open = meta.gatePassed || meta.gate.position === "none" || meta.gate.scrollPct >= 100;
  const q = `v=${encodeURIComponent(meta.viewToken)}${unlock ? `&t=${encodeURIComponent(unlock)}` : ""}`;
  const fileUrl = `/api/public/doc/${slug}/file?${q}`;
  return {
    fileUrl,
    pdfUrl: open && meta.sourceType === "pdf" ? fileUrl : null,
    snapshotUrl: open && meta.hasSnapshot ? `/api/public/doc/${slug}/snapshot?${q}` : null,
  };
}

function LoadedDoc({ slug, meta, unlock, load }: { slug: string; meta: DocMeta; unlock: string; load: (v: string | null, t: string) => Promise<void> }) {
  const onProgress = useViewTracking(meta, slug);
  const gate = useDocGate(slug, meta.viewToken, (t) => load(meta.viewToken, t));
  const { fileUrl, pdfUrl, snapshotUrl } = sourceUrls(slug, meta, unlock);
  const passed = meta.gatePassed;
  return (
    <DocViewer
      title={meta.title}
      brandName={meta.brandName}
      sourceType={meta.sourceType}
      pages={meta.pages}
      html={meta.html}
      fileUrl={pdfUrl}
      snapshotUrl={snapshotUrl}
      sourceUrl={meta.sourceUrl}
      gate={meta.gate}
      passed={passed}
      onProgress={onProgress}
      onSubmit={gate.submit}
      gateNotice={gate.pendingEmail ? <VerifyNotice brandName={meta.brandName} email={gate.pendingEmail} onResend={gate.resend} resending={gate.resending} message={gate.resendMsg} /> : undefined}
      barRight={
        meta.allowDownload && meta.sourceType === "pdf" && passed ? (
          <Button size="sm" variant="secondary" onClick={() => location.assign(`${fileUrl}&download=1`)}>PDF 내려받기</Button>
        ) : null
      }
    />
  );
}

// 공개 자료 뷰어 /d/:slug. 쪽 체류(화면이 보일 때만), 스크롤 깊이, 완독을 5초마다 보낸다
export function PublicDocPage() {
  const { token: slug = "" } = useParams();
  const { meta, unlock, error, load } = usePublicDoc(slug);
  if (error || !meta) return <DocStatusScreen error={error} />;
  return <LoadedDoc slug={slug} meta={meta} unlock={unlock} load={load} />;
}
