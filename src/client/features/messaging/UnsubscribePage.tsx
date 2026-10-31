import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { PublicUnsubscribe } from "../../../shared/unsubscribe";
import { Button, LoadingState } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import "../links/lead-tools.css";

// 공개 수신 거부 화면 /unsubscribe/:token. 확인 버튼을 눌러야 처리한다(메일 보안 스캐너의 자동 열람 방지)
export function UnsubscribePage() {
  const { token = "" } = useParams();
  return <UnsubscribeForToken key={token} token={token} />;
}

function useUnsubscribe(token: string) {
  const path = `/public/unsubscribe/${encodeURIComponent(token)}`;
  const [metadata, setMetadata] = useState<PublicUnsubscribe | null>(null);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"idle" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false), pending = useRef(false);
  useEffect(() => {
    let live = true;
    setLoadError("");
    void api.get<PublicUnsubscribe>(path, { redirectOn401: false }).then((data) => {
      if (!data || typeof data.workspaceName !== "string") throw new Error("수신 거부 링크를 확인하지 못했어요. 다시 불러와 주세요.");
      if (live) setMetadata(data);
    }).catch((cause: unknown) => { if (live) setLoadError(errorMessage(cause)); });
    return () => { live = false; };
  }, [path, attempt]);
  const submit = async () => {
    if (!metadata || pending.current) return;
    pending.current = true; setBusy(true);
    try {
      await api.post(path, {}, { redirectOn401: false });
      setState("done");
    } catch (e) {
      setError(errorMessage(e));
      setState("error");
    } finally {
      pending.current = false; setBusy(false);
    }
  };
  return { metadata, loadError, reload: () => setAttempt((value) => value + 1), state, error, busy, submit };
}

function UnsubscribeForToken({ token }: { token: string }) {
  const { metadata, loadError, reload, state, error, busy, submit } = useUnsubscribe(token);
  return (
    <div className="visitor">
      <div className="visitor-card text-center">
        {metadata && <p className="visitor-brand">{metadata.workspaceName}</p>}
        {loadError ? (
          <>
            <h3>수신 거부 링크를 확인할 수 없어요</h3>
            <p className="field-error" role="alert">{loadError}</p>
            <div><Button onClick={reload}>다시 불러오기</Button></div>
          </>
        ) : !metadata ? <LoadingState label="브랜드를 불러오는 중이에요" lines={2} /> : state === "done" ? (
          <>
            <h3>수신 거부했어요</h3>
            <p className="text-secondary">앞으로 이 브랜드의 이메일과 알림톡을 보내지 않아요.</p>
          </>
        ) : (
          <>
            <h3>메시지 수신을 그만할까요?</h3>
            <p className="text-secondary">확인을 누르면 이 브랜드가 보내는 안내·광고 메시지를 더 받지 않아요.</p>
            {state === "error" && <p className="field-error" role="alert">{error}</p>}
            <div><Button onClick={() => void submit()} loading={busy}>수신 거부</Button></div>
          </>
        )}
      </div>
    </div>
  );
}
