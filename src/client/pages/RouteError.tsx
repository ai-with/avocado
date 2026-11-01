import { useState } from "react";
import { useRouteError } from "react-router-dom";
import { Button, ButtonAnchor, EmptyState } from "../ui";
import { createPageRecovery, isChunkLoadFailure } from "../lib/route-recovery";
import "./Auth.css";

// This view receives only safe classifications, never an error object, URL,
// response data or stack. Keep it in the entry bundle, outside lazy pages.
export function RouteErrorView({ chunk, available, failed, onReopen }: { chunk: boolean; available: boolean; failed: boolean; onReopen: () => void }) {
  return (
    <main className="public-page" role="alert" aria-label="페이지 열기 오류">
      <EmptyState title={chunk ? "화면을 불러오지 못했어요" : "페이지를 표시하지 못했어요"}
        description={chunk ? "화면을 여는 중 연결에 문제가 생겼어요. 페이지를 다시 열어 확인해 주세요." : "일시적인 문제가 생겼어요. 페이지를 다시 열거나 홈으로 이동해 주세요."}
        action={<>
          <Button disabled={!available} onClick={onReopen}>페이지 다시 열기</Button>
          <ButtonAnchor href="/dashboard">홈으로 가기</ButtonAnchor>
        </>} />
      {failed && <p className="text-caption text-center" role="status">다시 열기를 시작하지 못했어요. 다시 시도하거나 홈으로 이동해 주세요.</p>}
    </main>
  );
}

export function RouteErrorPage() {
  const error = useRouteError();
  const [recovery] = useState(() => createPageRecovery(typeof window === "undefined" ? null : {
    reload: () => window.location.reload(),
  }));
  const [failed, setFailed] = useState(false);
  return <RouteErrorView chunk={isChunkLoadFailure(error)} available={recovery.available} failed={failed} onReopen={() => setFailed(!recovery.reopen())} />;
}
