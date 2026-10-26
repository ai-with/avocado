import type { EmailMessage } from "./email";
import { escapeHtml } from "./html";
import { newId, now } from "./ids";
import { supportTypeLabel, type SupportBody } from "../../shared/support";
import type { supportRequests } from "../db/schema";

type SupportRow = typeof supportRequests.$inferInsert;
type Who = { workspaceId: string; userId: string };

// 검증을 마친 입력을 저장할 행으로. 상태는 항상 접수로 시작한다
export function toSupportRow(body: SupportBody, who: Who): SupportRow {
  return { id: newId(), ...who, type: body.type, body: body.body, replyEmail: body.replyEmail, status: "received", createdAt: now() };
}

type MailContext = { to: string; workspaceName: string; userName: string; userEmail: string };

// 운영 담당자에게 보내는 문의 메일. 회신은 replyEmail 로 한다
export function supportEmail(body: SupportBody, ctx: MailContext): EmailMessage {
  const lines = [
    `유형: ${supportTypeLabel(body.type)}`,
    `워크스페이스: ${ctx.workspaceName}`,
    `보낸 사람: ${ctx.userName} (${ctx.userEmail})`,
    `회신 이메일: ${body.replyEmail}`,
    "",
    body.body,
  ];
  return {
    to: ctx.to,
    subject: `[avocado 문의] ${supportTypeLabel(body.type)} · ${ctx.workspaceName}`,
    text: lines.join("\n"),
    html: `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(lines.join("\n"))}</pre>`,
  };
}
