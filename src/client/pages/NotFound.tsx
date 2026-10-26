import { EmptyState, ButtonLink } from "../ui";
import "./Auth.css";

export function NotFoundPage() {
  return (
    <div className="public-page">
      <EmptyState title="페이지를 찾을 수 없어요" description="주소가 바뀌었거나 삭제된 페이지예요. 주소를 다시 확인해 주세요." action={<ButtonLink to="/dashboard">홈으로 가기</ButtonLink>} />
    </div>
  );
}
