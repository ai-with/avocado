import { Link } from "react-router-dom";
import { Badge, Input, RadioGroup, Textarea } from "../../ui";
import { CHANNEL_LABELS, isEmailTemplate, KIND_LABELS, VARIABLES, type Channel, type Check, type EmailTemplate, type MessageKind, type MessageTemplate } from "../../../shared/messaging";
import "./messaging.css";

export const EMPTY_EMAIL: EmailTemplate = { subject: "", preview: "", body: "", buttonLabel: "", buttonUrl: "" };

const CHANNELS: Channel[] = ["email", "alimtalk"];
const KINDS: MessageKind[] = ["info", "ad"];

// 알림톡은 정보성만 되고 템플릿 형식이 달라서, 채널을 바꾸면 성격과 템플릿을 같이 맞춘다
export function channelPatch(channel: Channel, kind: MessageKind): { channel: Channel; kind: MessageKind; template: MessageTemplate } {
  return { channel, kind: channel === "alimtalk" ? "info" : kind, template: channel === "alimtalk" ? { templateCode: "", variables: {} } : EMPTY_EMAIL };
}

// requireConnection: 채널이 연결되지 않았으면 알림톡을 고를 수 없게 막는다
export function ChannelChoice({ value, connected, requireConnection, onChange }: { value: Channel; connected: boolean; requireConnection?: boolean; onChange: (ch: Channel) => void }) {
  const locked = (ch: Channel) => !!requireConnection && ch === "alimtalk" && !connected;
  const options = CHANNELS.map((ch) => ({ value: ch, label: `${CHANNEL_LABELS[ch]}${locked(ch) ? " (채널 연결 후)" : ""}`, disabled: locked(ch) }));
  return <RadioGroup label="채널" direction="row" options={options} value={value} onChange={onChange} />;
}

export function KindChoice({ value, channel, onChange }: { value: MessageKind; channel: Channel; onChange: (k: MessageKind) => void }) {
  const options = KINDS.map((k) => ({ value: k, label: KIND_LABELS[k], disabled: k === "ad" && channel === "alimtalk" }));
  return <RadioGroup label="메시지 성격" direction="row" options={options} value={value} onChange={onChange} />;
}

export function ChecksList({ checks, failLabel = "켤 수 없음" }: { checks: Check[]; failLabel?: string }) {
  return (
    <ul className="msg-checks" aria-label="발송 전 점검">
      {checks.map((c, i) => (
        <li key={i} className={c.ok ? "ok" : "fail"}>
          <Badge tone={c.ok ? "success" : "danger"}>{c.ok ? "통과" : failLabel}</Badge> {c.message}
        </li>
      ))}
    </ul>
  );
}

export function AlimtalkNotice() {
  return (
    <div className="msg-notice" role="note">
      <b>카카오톡 채널 연결이 필요해요</b>
      <p className="text-secondary">알림톡은 카카오톡 비즈니스 채널과 발신 프로필을 연결하고, 템플릿 심사를 통과한 뒤에 쓸 수 있어요. 정보성 메시지만 보낼 수 있어요.</p>
      <Link to="/dashboard/settings/integrations">연결 방법 보기 (설정 &gt; 연동)</Link>
    </div>
  );
}

export function EmailEditor({ value, onChange, isAd }: { value: EmailTemplate; onChange: (v: EmailTemplate) => void; isAd: boolean }) {
  const set = (patch: Partial<EmailTemplate>) => onChange({ ...value, ...patch });
  return (
    <div className="stack">
      <Input label="제목" value={value.subject} onChange={(e) => set({ subject: e.target.value })} hint={isAd ? "광고성이라 보낼 때 제목 앞에 (광고)가 자동으로 붙어요." : undefined} />
      <Input label="미리보기 문구" value={value.preview} onChange={(e) => set({ preview: e.target.value })} hint="받은편지함에서 제목 옆에 보이는 한 줄이에요." />
      <Textarea autoGrow label="본문" rows={8} value={value.body} onChange={(e) => set({ body: e.target.value })} hint={`변수: ${VARIABLES.map((v) => `{{${v}}}`).join(", ")}. 끝에 전송자 정보와 수신 거부 링크가 자동으로 붙어요.`} />
      <div className="msg-two">
        <Input label="버튼 이름 (선택)" value={value.buttonLabel} onChange={(e) => set({ buttonLabel: e.target.value })} />
        <Input label="버튼 링크" value={value.buttonUrl} onChange={(e) => set({ buttonUrl: e.target.value })} placeholder="https://" />
      </div>
    </div>
  );
}

// 이메일 채널이면 편집기, 아니면 알림톡 연결 안내
export function TemplateEditor({ channel, kind, template, onChange }: { channel: Channel; kind: MessageKind; template: MessageTemplate; onChange: (t: EmailTemplate) => void }) {
  if (channel === "email" && isEmailTemplate(template)) return <EmailEditor value={template} onChange={onChange} isAd={kind === "ad"} />;
  return <AlimtalkNotice />;
}
