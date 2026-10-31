import { useEffect, useState, type FormEvent } from "react";
import { Badge, Button, Input, LoadingState, PageHeader, SectionCard, useToast } from "../../ui";
import { api, errorMessage } from "../../lib/api";
import { InstagramCard } from "../../features/performance/InstagramCard";

type Settings = { senderName: string; senderContact: string; workspaceName: string; fromAddress: string; alimtalk: { status: "not_connected" | "pending" | "connected" } };

function AlimtalkCard({ status }: { status: Settings["alimtalk"]["status"] }) {
  const connected = status === "connected";
  return (
    <SectionCard title="카카오톡 채널 · 알림톡" description="알림톡은 아래 준비가 끝나면 연결할 수 있어요. 지금은 연결 기능을 준비 중이에요." actions={<Badge tone={connected ? "success" : "neutral"}>{connected ? "연결됨" : "미연결"}</Badge>}>
      <ol className="list-plain text-secondary">
        <li>카카오톡 비즈니스 채널을 만들고 비즈니스 인증을 받아요.</li>
        <li>알림톡 대행사(딜러사)를 통해 발신 프로필을 등록해요.</li>
        <li>보낼 메시지를 정보성 템플릿으로 만들어 사전 심사를 받아요.</li>
        <li>심사를 통과한 템플릿을 여기서 불러와 자동 발송·1회성 발송에 써요.</li>
      </ol>
      <p className="text-caption">알림톡은 정보성 메시지만 보낼 수 있고, 발송 비용은 크레딧으로 차감돼요.</p>
    </SectionCard>
  );
}

function EmailDomainCard({ s }: { s: Settings }) {
  return (
    <SectionCard title="이메일 발신 도메인">
      <p>현재 발신 주소: <b>{s.fromAddress || "설정 대기"}</b> (보낸 사람 이름: {s.senderName || s.workspaceName})</p>
      <p className="text-secondary">브랜드 도메인으로 보내려면 도메인 DNS에 SPF와 DKIM 레코드를 추가해 인증해야 해요. 인증 전에는 위 주소에 브랜드 이름을 붙여 보내요. 도메인 인증 기능은 준비 중이에요.</p>
    </SectionCard>
  );
}

function SenderCard({ s, setS }: { s: Settings; setS: (s: Settings) => void }) {
  const toast = useToast();
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.patch("/messaging/settings", { senderName: s.senderName, senderContact: s.senderContact });
      toast("저장했어요.", "success");
    } catch (err) {
      toast(errorMessage(err), "danger");
    }
  };
  return (
    <SectionCard title="전송자 정보" description="모든 발송 메일 하단에 수신 거부 링크와 함께 들어가요. 광고성 메일에는 법에 따라 반드시 표시돼요.">
      <form className="stack" onSubmit={save}>
        <Input label="전송자 명칭" value={s.senderName} onChange={(e) => setS({ ...s, senderName: e.target.value })} placeholder={s.workspaceName} hint="비우면 워크스페이스 이름을 써요." />
        <Input label="연락처" value={s.senderContact} onChange={(e) => setS({ ...s, senderContact: e.target.value })} placeholder="예: help@brand.com, 02-123-4567, 서울시 ..." />
        <div><Button type="submit">전송자 정보 저장</Button></div>
      </form>
    </SectionCard>
  );
}

// /settings/integrations: 연동. 카드는 기능별 워커가 한 장씩 붙인다
export function IntegrationsPage() {
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => void api.get<Settings>("/messaging/settings").then(setS), []);
  return (
    <>
      <PageHeader title="연동" description="인스타그램, 카카오톡 채널, 이메일 발신 정보를 관리해요." />
      {s ? (
        <div className="stack-loose content-narrow">
          <InstagramCard />
          <AlimtalkCard status={s.alimtalk.status} />
          <EmailDomainCard s={s} />
          <SenderCard s={s} setS={setS} />
        </div>
      ) : (
        <LoadingState pattern="card" />
      )}
    </>
  );
}
