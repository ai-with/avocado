import { useState } from "react";
import { Badge, Button, CopyButton, SectionCard, Stat, StatGrid } from "../../../ui";
import { dateTime } from "../../links/common";
import type { Site } from "../api";
import { SiteAlertModal } from "./SiteAlertModal";

type Props = { site: Site; onEdit: (s: Site) => void; onRotate: (s: Site) => void; onRemove: (s: Site) => void };

const won = (n: number, currency: string) => (currency === "KRW" ? `${n.toLocaleString("ko-KR")}원` : `${n.toLocaleString("ko-KR")} ${currency}`);

function InstallStatus({ site }: { site: Site }) {
  if (site.firstEventAt) return <Badge tone="success">첫 이벤트 수신됨 · {dateTime(site.firstEventAt)}</Badge>;
  return <Badge tone="warn">설치 확인 대기 중</Badge>;
}

function Summary({ site }: { site: Site }) {
  const { sessions, pageviews, conversions, conversionValue, conversionValuePending, conversionValueConverted } = site.summary;
  const empty = "스크립트를 설치하면 쌓여요";
  const valueHint = [won(conversionValue, site.currency), conversionValueConverted ? "ECB 참조 환율 적용" : "", conversionValuePending ? `환산 대기 ${conversionValuePending}건` : ""].filter(Boolean).join(" · ");
  return (
    <StatGrid>
      <Stat label="최근 7일 세션" value={sessions} hint={sessions ? "구성원 방문 제외" : empty} />
      <Stat label="페이지뷰" value={pageviews} />
      <Stat label="전환" value={conversions} hint={conversions ? valueHint : undefined} />
    </StatGrid>
  );
}

function Snippet({ site }: { site: Site }) {
  return (
    <div className="stack-tight">
      <div className="row row-between">
        <h5>설치 스니펫</h5>
        <CopyButton text={site.snippet} label="스니펫 복사" doneMessage="스니펫을 복사했어요. 사이트의 </head> 앞에 붙여 넣어 주세요." />
      </div>
      <pre className="site-snippet"><code>{site.snippet}</code></pre>
      <p className="text-caption">모든 페이지의 &lt;/head&gt; 앞에 넣거나 GTM 사용자 정의 HTML 태그로 넣어요. 전환은 결제·가입 완료 화면에서 avocado('conversion', {"{"} type: 'purchase', value: 39000, orderId: '주문번호' {"}"})로 보내요.</p>
    </div>
  );
}

// 사이트 한 곳: 설치 상태, 최근 7일 요약, 스니펫, 설정
export function SiteCard({ site, onEdit, onRotate, onRemove }: Props) {
  const [alertsOpen, setAlertsOpen] = useState(false);
  const actions = (
    <>
      <Button size="sm" variant="secondary" onClick={() => onEdit(site)}>설정</Button>
      <Button size="sm" variant="secondary" onClick={() => setAlertsOpen(true)}>급감 알림</Button>
      <Button size="sm" variant="ghost" onClick={() => onRotate(site)}>키 재발급</Button>
      <Button size="sm" variant="ghost" onClick={() => onRemove(site)}>삭제</Button>
    </>
  );
  return (
    <SectionCard title={site.name} description={site.domains.join(", ")} actions={actions}>
      <div className="stack">
        <div className="row row-wrap">
          <InstallStatus site={site} />
          <Badge>{site.consentMode === "require" ? "동의 필요" : "고지 기반"}</Badge>
          <Badge tone={site.collectRawEmail ? "info" : "neutral"}>{site.collectRawEmail ? "이메일 원문 받음" : "이메일 해시만"}</Badge>
        </div>
        <Summary site={site} />
        <Snippet site={site} />
        {alertsOpen && <SiteAlertModal siteId={site.id} name={site.name} onClose={() => setAlertsOpen(false)} />}
      </div>
    </SectionCard>
  );
}
