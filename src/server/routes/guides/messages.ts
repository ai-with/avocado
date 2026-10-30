import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../types";
import { ApiError, parse } from "../../lib/errors";
import { findGuide } from "../../lib/guides";
import { addContactLog } from "../../lib/participation";
import { findTemplate, participantValues } from "../../lib/message-templates";
import { sendEmail } from "../../lib/email";
import { escapeHtml } from "../../lib/html";
import { editorsOnly } from "../../middleware/auth";
import { MESSAGE_LANGS } from "../../../shared/message-render";
import { ownRow } from "./participation";

// 인플루언서 한 명에게 템플릿을 채워 보내기 (/api/guides/:id/influencers/:giId/messages, TASK-073)
// 인스타 DM 은 공식 API 로 먼저 보낼 수 없어 복사 후 '보냄'으로 기록한다 (findings/instagram-dm-api.md)

const MAX_BODY = 5000;
const sendBody = z.object({
  channel: z.enum(["dm", "email"]),
  lang: z.enum(MESSAGE_LANGS),
  body: z.string().trim().min(1, "보낼 내용을 입력해 주세요.").max(MAX_BODY),
  templateId: z.string().nullable(),
});

const mailHtml = (text: string) => text.split("\n").map((line) => escapeHtml(line)).join("<br>");

export const messageRoutes = new Hono<AppEnv>()
  // 언어별 값 사전. 미리보기는 화면이 shared/message-render 로 그린다
  .get("/:id/influencers/:giId/message-values", async (c) => {
    const { workspaceId, gi } = await ownRow(c);
    const g = await findGuide(c.var.db, workspaceId, c.req.param("id"));
    const { values, lang, email } = await participantValues(c.env, c.var.db, g, gi);
    return c.json({ values, lang, hasEmail: Boolean(email) });
  })
  .post("/:id/influencers/:giId/messages", editorsOnly, async (c) => {
    const input = parse(sendBody, await c.req.json());
    const { workspaceId, userId, gi } = await ownRow(c);
    const db = c.var.db;
    const template = input.templateId ? await findTemplate(db, workspaceId, input.templateId) : null;
    const meta: Record<string, unknown> = { template_id: template?.id ?? null };
    let logBody = input.body;
    if (input.channel === "email") {
      const g = await findGuide(db, workspaceId, c.req.param("id"));
      const { email, brandName } = await participantValues(c.env, db, g, gi);
      if (!email) throw new ApiError(400, "no_email", "인플루언서 이메일이 없어요. 복사해서 DM으로 보내 주세요.");
      const subject = template ? `[${brandName}] ${template.name}` : `[${brandName}]`;
      const result = await sendEmail(c.env, { to: email, subject, text: input.body, html: mailHtml(input.body) });
      // 실제로 안 나갔으면 기록하지 않는다. 발송 설정이 없는 로컬 개발만 흐름 확인용으로 표시를 붙여 기록한다
      if (!result.delivered && result.reason === "provider_error") throw new ApiError(502, "email_failed", "이메일을 보내지 못했어요. 잠시 뒤 다시 시도해 주세요.");
      if (!result.delivered) {
        if (c.env.APP_ENV !== "development") throw new ApiError(409, "email_not_configured", "이메일 발송이 아직 설정되지 않았어요. 복사해서 DM이나 메일로 보내 주세요.");
        logBody = `${input.body}\n\n(로컬, 실제 발송 안 됨)`;
      }
      meta.delivered = result.delivered;
      meta.subject = subject;
    }
    const log = await addContactLog(db, workspaceId, gi.id, { kind: "message", channel: input.channel, lang: input.lang, body: logBody, meta, createdBy: userId });
    return c.json({ log }, 201);
  });
