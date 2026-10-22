import { useParams } from "react-router-dom";
import { Button, LoadingState } from "../../ui";
import { api } from "../../lib/api";
import { DocViewer } from "./DocViewer";
import { usePublicDoc, useViewTracking } from "./usePublicDoc";
import "../links/lead-tools.css";

// 자료를 받기 전 자리 표시, 또는 열 수 없을 때 이유
function DocStatusScreen({ error }: { error: string }) {
  return (
    <div className="visitor">
      <div className="visitor-card text-center">
        {error ? (
          <>
            <h3>자료를 열 수 없어요</h3>
            <p className="text-secondary">{error}</p>
          </>
        ) : (
          <LoadingState label="자료를 불러오는 중" />
        )}
      </div>
    </div>
  );
}

// 공개 자료 뷰어 /d/:slug. 쪽 체류(화면이 보일 때만), 스크롤 깊이, 완독을 5초마다 보낸다
export function PublicDocPage() {
  const { token: slug = "" } = useParams();
  const { meta, error, load } = usePublicDoc(slug);
  const onProgress = useViewTracking(meta, slug);

  if (error || !meta) return <DocStatusScreen error={error} />;

  const passed = meta.gatePassed;
  const open = passed || meta.gate.position === "none" || meta.gate.scrollPct > 0;
  const v = encodeURIComponent(meta.viewToken);
  const fileUrl = `/api/public/doc/${slug}/file?v=${v}`;
  return (
    <DocViewer
      title={meta.title}
      brandName={meta.brandName}
      sourceType={meta.sourceType}
      pages={meta.pages}
      html={meta.html}
      fileUrl={open && meta.sourceType === "pdf" ? fileUrl : null}
      snapshotUrl={open && meta.hasSnapshot ? `/api/public/doc/${slug}/snapshot?v=${v}` : null}
      sourceUrl={meta.sourceUrl}
      gate={meta.gate}
      passed={passed}
      onProgress={onProgress}
      onSubmit={async (values) => {
        await api.post(`/public/doc/${slug}/gate`, { ...values, viewToken: meta.viewToken }, { redirectOn401: false });
        // 0% 게이트는 통과 뒤에야 본문을 받으므로 다시 읽는다
        await load(meta.viewToken);
      }}
      barRight={
        meta.allowDownload && meta.sourceType === "pdf" && passed ? (
          <Button size="sm" variant="secondary" onClick={() => location.assign(`${fileUrl}&download=1`)}>PDF 내려받기</Button>
        ) : null
      }
    />
  );
}
