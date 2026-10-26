import { Hono } from "hono";
import { and, count, desc, eq, gt } from "drizzle-orm";
import type { AppEnv } from "../types";
import type { Db } from "../db";
import { supportRequests } from "../db/schema";
import { ApiError, parse } from "../lib/errors";
import { now } from "../lib/ids";
import { logEvent } from "../lib/events";
import { sendEmail } from "../lib/email";
import { supportEmail, toSupportRow } from "../lib/support";
import { workspaceCtx } from "../middleware/auth";
import { SUPPORT_LIST_LIMIT, SUPPORT_PER_HOUR, supportBodySchema, type SupportBody } from "../../shared/support";

const HOUR_MS = 60 * 60 * 1000;
type Who = { workspaceId: string; userId: string };
const mine = (who: Who) => and(eq(supportRequests.workspaceId, who.workspaceId), eq(supportRequests.userId, who.userId));

// 워크스페이스·사용자 기준 1시간 5건
async function checkLimit(db: Db, who: Who) {
  const recent = await db.select({ n: count() }).from(supportRequests).where(and(mine(who), gt(supportRequests.createdAt, now() - HOUR_MS))).get();
  if ((recent?.n ?? 0) >= SUPPORT_PER_HOUR) throw new ApiError(429, "too_many_requests", "문의를 너무 자주 보냈어요. 1시간 뒤에 다시 보내 주세요.");
}

// 메일이 실패해도 문의는 이미 저장됐으니 사용자에게는 성공으로 돌려준다
async function forward(env: Env, body: SupportBody, ctx: { workspaceName: string; userName: string; userEmail: string }) {
  if (!env.SUPPORT_EMAIL) return;
  try {
    await sendEmail(env, supportEmail(body, { to: env.SUPPORT_EMAIL, ...ctx }));
  } catch (e) {
    console.error("[support:email_failed]", e);
  }
}

// /api/support: 도움 받기 문의 보내기, 내가 보낸 문의 목록
export const supportRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { workspace, user } = workspaceCtx(c);
    const rows = await c.var.db
      .select({ id: supportRequests.id, type: supportRequests.type, status: supportRequests.status, createdAt: supportRequests.createdAt })
      .from(supportRequests)
      .where(mine({ workspaceId: workspace.id, userId: user.id }))
      .orderBy(desc(supportRequests.createdAt))
      .limit(SUPPORT_LIST_LIMIT);
    return c.json({ requests: rows });
  })
  .post("/", async (c) => {
    const { workspace, user } = workspaceCtx(c);
    const body = parse(supportBodySchema, await c.req.json());
    const who = { workspaceId: workspace.id, userId: user.id };
    const db = c.var.db;
    await checkLimit(db, who);
    const row = toSupportRow(body, who);
    await db.insert(supportRequests).values(row);
    await logEvent(db, workspace.id, "support_requested", { type: body.type, length: body.body.length });
    await forward(c.env, body, { workspaceName: workspace.name, userName: user.name, userEmail: user.email });
    return c.json({ request: { id: row.id, type: row.type, status: row.status, createdAt: row.createdAt } }, 201);
  });
