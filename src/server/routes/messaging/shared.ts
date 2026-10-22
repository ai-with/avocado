import type { Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { ApiError } from "../../lib/errors";
import { sendEmail } from "../../lib/email";
import { alimtalkConnected, logMessage, senderInfo } from "../../lib/messaging";
import { workspaceCtx } from "../../middleware/auth";
import { isEmailTemplate, renderEmail, validateTemplate, type Channel, type MessageKind, type MessageTemplate } from "../../../shared/messaging";

// 자동 발송·1회성 발송 공용

const emailTemplate = z.object({
  subject: z.string().max(200),
  preview: z.string().max(200).default(""),
  body: z.string().max(20000),
  buttonLabel: z.string().max(40).default(""),
  buttonUrl: z.string().max(2000).default(""),
});
const alimtalkTemplate = z.object({ templateCode: z.string().max(100), variables: z.record(z.string(), z.string().max(500)).default({}) });
export const templateSchema = z.union([emailTemplate, alimtalkTemplate]);
export const channelSchema = z.enum(["email", "alimtalk"]);
export const kindSchema = z.enum(["info", "ad"]);
export const audienceSchema = z.object({ groupIds: z.array(z.string()).max(50).default([]), tagIds: z.array(z.string()).max(50).default([]) });

type Sendable = { channel: Channel; kind: MessageKind; template: MessageTemplate };

// 1단계 알림톡은 채널 연결 전이라 저장 자체를 막는다(F-66 수용 기준)
export async function guardChannel(db: Db, workspaceId: string, channel: Channel, template: MessageTemplate) {
  if (channel === "alimtalk" && !(await alimtalkConnected(db, workspaceId)))
    throw new ApiError(400, "alimtalk_not_connected", "카카오톡 채널 연결이 필요해요. 설정 > 연동에서 연결 방법을 확인해 주세요.", { channel: "카카오톡 채널 연결이 필요해요." });
  if (channel === "email" && !isEmailTemplate(template)) throw new ApiError(400, "validation_error", "이메일 내용을 넣어 주세요.");
}

export async function checksFor(db: Db, workspaceId: string, r: Sendable, targetOk: boolean) {
  // 1단계는 우리 발신 주소 + 브랜드 이름으로 보내므로 발신 주소는 항상 준비됨 [추론]
  return validateTemplate({ ...r, hasTarget: targetOk, alimtalkConnected: await alimtalkConnected(db, workspaceId), senderReady: true });
}

// 테스트 발송: 로그인한 본인 이메일로만. 리드 기록에는 붙이지 않고 source test 로 남긴다
export async function sendTest(c: Context<AppEnv>, r: Sendable & { id: string }) {
  const { workspace, user } = workspaceCtx(c);
  const db = c.var.db;
  if (r.channel !== "email" || !isEmailTemplate(r.template)) throw new ApiError(400, "test_email_only", "테스트 발송은 이메일만 돼요.");
  const vars = { 이름: user.name, 가이드명: "(가이드명)", 인플루언서명: "(인플루언서명)" };
  const msg = renderEmail(r.template, vars, { kind: r.kind, ...(await senderInfo(db, workspace.id)), unsubscribeUrl: `${c.env.APP_URL}/unsubscribe/test` });
  const res = await sendEmail(c.env, { to: user.email, ...msg, subject: `[테스트] ${msg.subject}` });
  const status = res.delivered ? "sent" : res.reason === "no_provider" ? "skipped" : "failed";
  const reason = res.delivered ? null : res.reason;
  await logMessage(db, { workspaceId: workspace.id, leadId: null, source: "test", sourceId: r.id, channel: "email", status, reason });
  return { to: user.email, delivered: res.delivered, reason };
}
