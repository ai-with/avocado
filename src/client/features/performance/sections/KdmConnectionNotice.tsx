import { Link } from "react-router-dom";
import { Card } from "../../../ui";
import type { KdmData } from "../kdmTypes";

// 브랜드 계정 연결 상태 안내. 연결돼 있으면 계정과 발송 조건만 짧게 보인다
export function KdmConnectionNotice({ data }: { data: KdmData }) {
  if (!data.configured)
    return <Card><p>연결 준비 중이에요. Meta 앱 검수가 끝나면 브랜드 계정을 연결하고 규칙을 켤 수 있어요. 검수 전에는 테스터로 등록된 브랜드 계정만 쓸 수 있어요.</p></Card>;
  if (!data.connection)
    return <Card><p>규칙을 켜려면 먼저 브랜드 인스타그램 계정을 연결해야 해요. <Link to="/dashboard/settings/integrations">연동에서 연결하기</Link></p></Card>;
  if (data.connection.expired || data.connection.disconnected)
    return <Card><p>브랜드 계정 연결이 끊겼어요. 켜진 규칙은 일시정지됐어요. <Link to="/dashboard/settings/integrations">다시 연결하기</Link></p></Card>;
  if (!data.connection.connected)
    return <Card><p>계정과 허용한 권한을 다시 확인해야 해요. <Link to="/dashboard/settings/integrations">연결 확인하기</Link></p></Card>;
  return <p className="text-caption">연결된 계정: @{data.connection.username}{data.sendPolicy?.configured === true && " · 댓글 작성 후 7일 안, 한 사람에게 한 번만 보내요."}</p>;
}
