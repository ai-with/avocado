import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge, Button, CopyButton, Input, LoadingState, SectionCard, Table, useToast } from "../../ui";
import { api } from "../../lib/api";
import { useMe } from "../../lib/me";
import { fmtDateTime } from "../guides/types";
import type { IgTarget } from "../../../shared/performance";
import type { Act } from "./kdmTypes";
import { useAction } from "./useAction";
import "../guides/guides.css";

type Conn = {
  id: string;
  target: IgTarget;
  label: string | null;
  username: string | null;
  scopes: string[];
  connected: boolean;
  expired: boolean;
  connectedAt: number | null;
  revokedAt: number | null;
  connectUrl: string | null;
};
type IgData = { configured: boolean; fake: boolean; connections: Conn[] };

const SCOPE_LABELS: Record<string, string> = {
  instagram_business_basic: "기본 정보",
  instagram_business_manage_insights: "인사이트",
  instagram_business_manage_comments: "댓글 관리",
  instagram_business_manage_messages: "메시지",
};
const CARD_TITLE = "인스타그램 (브랜드 계정)";

function useOAuthResultToast() {
  const toast = useToast();
  const [sp] = useSearchParams();
  useEffect(() => {
    if (sp.get("done") === "1") toast("인스타그램 계정을 연결했어요.", "success");
    const err = sp.get("error");
    if (err) toast(err === "personal_account" ? "개인 계정은 연결할 수 없어요. 프로페셔널 계정으로 바꿔 주세요." : err === "not_configured" ? "연결 준비 중이에요." : "연결하지 못했어요.", "danger");
  }, [sp]);
}

function SenderStatus({ sender }: { sender: Conn | undefined }) {
  const tone = sender?.connected && !sender.expired ? "success" : sender?.expired ? "danger" : "neutral";
  return <Badge tone={tone}>{sender?.connected ? (sender.expired ? "연결 끊김" : "연결됨") : "미연결"}</Badge>;
}

function SenderActions({ data, sender, act }: { data: IgData; sender: Conn | undefined; act: Act }) {
  const disconnect = () => confirm("연결을 해제할까요? 켜진 댓글 키워드 DM 규칙이 멈춰요.") && void act(() => api.del(`/ig/connections/${sender!.id}`), "연결을 해제했어요.");
  return (
    <div className="row">
      {!data.configured ? (
        <Button disabled>연결 준비 중</Button>
      ) : (
        <Button onClick={() => location.assign("/api/ig/oauth/start?target=brand_sender")}>{sender?.connected ? "다시 연결" : "브랜드 계정 연결"}</Button>
      )}
      {sender && <Button variant="ghost" onClick={disconnect}>연결 해제</Button>}
    </div>
  );
}

function ClientTable({ clients, canEdit, act }: { clients: Conn[]; canEdit: boolean; act: Act }) {
  return (
    <Table>
      <thead><tr><th>고객사</th><th>상태</th><th>계정</th><th>링크</th>{canEdit && <th><span className="sr-only">동작</span></th>}</tr></thead>
      <tbody>
        {clients.map((c) => (
          <tr key={c.id}>
            <td>{c.label}</td>
            <td>{c.connected ? <Badge tone={c.expired ? "danger" : "success"}>{c.expired ? "연결 끊김" : "연결됨"}</Badge> : <Badge>연결 안 됨</Badge>}</td>
            <td>{c.username ? `@${c.username}` : ""}</td>
            <td>{c.connectUrl && <CopyButton text={c.connectUrl} label="링크 복사" variant="ghost" />}</td>
            {canEdit && <td className="text-right"><Button size="sm" variant="ghost" onClick={() => void act(() => api.del(`/ig/connections/${c.id}`), "해제했어요.")}>해제</Button></td>}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function ClientRequests({ clients, canEdit, act }: { clients: Conn[]; canEdit: boolean; act: Act }) {
  const [label, setLabel] = useState("");
  const requestClient = () =>
    act(async () => {
      const r = await api.post<{ connectUrl: string }>("/ig/connections/client-request", { label });
      setLabel("");
      await navigator.clipboard.writeText(r.connectUrl).catch(() => undefined);
    }, "고객사 연결 링크를 만들고 복사했어요.");
  return (
    <div className="stack mt-section">
      <h4>고객사 계정 연결 요청 (대행사용)</h4>
      <p className="text-secondary">고객사 담당자가 본인 인스타그램 로그인으로 직접 허락해요. 대행사가 대신 로그인하지 않아요.</p>
      {canEdit && (
        <div className="row row-bottom">
          <Input aria-label="고객사 이름" placeholder="고객사 이름" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Button size="xl" variant="secondary" onClick={() => void requestClient()} disabled={!label.trim()}>연결 링크 만들기</Button>
        </div>
      )}
      {clients.length > 0 && <ClientTable clients={clients} canEdit={canEdit} act={act} />}
    </div>
  );
}

// /settings/integrations 의 '인스타그램(브랜드 계정)' 카드 (F-64 발송 계정, F-54 고객사 연결 요청)
export function InstagramCard() {
  const { me } = useMe();
  const canEdit = me?.role === "owner" || me?.role === "editor";
  const [data, setData] = useState<IgData | null>(null);
  const load = useCallback(async () => setData(await api.get("/ig/connections")), []);
  useEffect(() => void load(), [load]);
  useOAuthResultToast();
  const act = useAction(load);
  if (!data) return <SectionCard title={CARD_TITLE}><LoadingState pattern="table" lines={2} /></SectionCard>;

  const sender = data.connections.find((c) => c.target === "brand_sender" && !c.revokedAt);
  const clients = data.connections.filter((c) => c.target === "client_brand" && !c.revokedAt);
  return (
    <SectionCard title={CARD_TITLE} actions={<SenderStatus sender={sender} />}>
      <div className="stack">
        <p className="text-secondary">브랜드 계정을 연결하면 브랜드 게시물의 댓글 키워드 자동 DM을 쓸 수 있고, 미연결 인플루언서 게시물의 공개 지표도 이 계정으로 조회해요.</p>
        <p className="text-caption">Meta 앱 검수 전에는 테스터로 등록된 계정만 연결할 수 있어요.{data.fake && " (지금은 가짜 응답 모드예요)"}</p>
        {sender?.connected && (
          <dl className="kv">
            <dt>계정</dt><dd>@{sender.username}</dd>
            <dt>권한</dt><dd>{sender.scopes.map((s) => SCOPE_LABELS[s] ?? s).join(", ")}</dd>
            <dt>연결 시각</dt><dd>{fmtDateTime(sender.connectedAt)}</dd>
          </dl>
        )}
        {canEdit && <SenderActions data={data} sender={sender} act={act} />}
      </div>
      <ClientRequests clients={clients} canEdit={canEdit} act={act} />
    </SectionCard>
  );
}
