import { useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import "../links/lead-tools.css";

// 공개 수신 거부 화면 /unsubscribe/:token. 확인 버튼을 눌러야 처리한다(메일 보안 스캐너의 자동 열람 방지)
export function UnsubscribePage() {
  const { token = "" } = useParams();
  const [state, setState] = useState<"idle" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const submit = async () => {
    try {
      await api.post(`/public/unsubscribe/${token}`, {}, { redirectOn401: false });
      setState("done");
    } catch (e) {
      setError(errorMessage(e));
      setState("error");
    }
  };
  return (
    <div className="visitor">
      <div className="visitor-card text-center">
        {state === "done" ? (
          <>
            <h3>수신 거부했어요</h3>
            <p className="text-secondary">앞으로 이 브랜드의 이메일과 알림톡을 보내지 않아요.</p>
          </>
        ) : (
          <>
            <h3>메시지 수신을 그만할까요?</h3>
            <p className="text-secondary">확인을 누르면 이 브랜드가 보내는 안내·광고 메시지를 더 받지 않아요.</p>
            {state === "error" && <p className="field-error" role="alert">{error}</p>}
            <div><Button onClick={() => void submit()}>수신 거부</Button></div>
          </>
        )}
      </div>
    </div>
  );
}
