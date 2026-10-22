import type { ReactNode } from "react";
import { Card } from "../ui";
import "./Auth.css";

type Props = { title?: ReactNode; description?: ReactNode; children?: ReactNode };

// 로그인·가입·인증 화면이 함께 쓰는 가운데 카드 틀
export function AuthCard({ title, description, children }: Props) {
  return (
    <div className="auth">
      <Card className="auth-card">
        {title && <h3>{title}</h3>}
        {description && <p className="text-secondary">{description}</p>}
        {children}
      </Card>
    </div>
  );
}

// 폼 전체 오류. 필드별 오류는 Input 의 error 로 칸 바로 아래에 보인다
export function FormError({ message }: { message: string }) {
  if (!message) return null;
  return <p className="form-error" role="alert">{message}</p>;
}
