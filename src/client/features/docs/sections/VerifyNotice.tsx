import { Button } from "../../../ui";
import { withJosa } from "../../../../shared/josa";

type Props = { brandName: string; email: string; onResend: () => void; resending: boolean; message: string };

// 인증 메일을 보낸 뒤 게이트 다이얼로그에 입력 폼 대신 보이는 안내
export function VerifyNotice({ brandName, email, onResend, resending, message }: Props) {
  return (
    <div className="visitor-card">
      <div className="stack-tight">
        <span className="visitor-brand">{brandName}</span>
        <h3>메일함에서 인증 링크를 눌러 주세요</h3>
        <p className="text-secondary">
          {withJosa(email, "으로/로")} 인증 메일을 보냈어요. 링크를 누르면 이 자료로 돌아와 나머지를 볼 수 있어요. 링크는 24시간 동안 한 번 쓸 수 있어요.
        </p>
      </div>
      <div>
        <Button variant="secondary" onClick={onResend} disabled={resending}>
          {resending ? "보내는 중" : "메일 다시 보내기"}
        </Button>
      </div>
      {message && <p className="text-caption" role="status">{message}</p>}
    </div>
  );
}
