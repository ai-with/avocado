import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../../types";
import { messageVariables } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { findVariable, userVariablesOf, variableUsage } from "../../lib/message-templates";
import { editorsOnly, workspaceCtx } from "../../middleware/auth";
import { varKeyProblem } from "../../../shared/message-render";

// 설정 > 메시지 템플릿 > 변수 (/api/message-variables, TASK-073). 기본 변수는 코드 상수라 여기 없다

const MAX_VALUE = 500;
const editBody = z.object({
  label: z.string().trim().min(1, "변수 이름표를 입력해 주세요.").max(40),
  defaultValue: z.string().trim().max(MAX_VALUE),
});
const createBody = editBody.extend({ key: z.string().trim() });

export const messageVariableRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { workspace } = workspaceCtx(c);
    return c.json({ variables: await userVariablesOf(c.var.db, workspace.id) });
  })
  .post("/", editorsOnly, async (c) => {
    const body = parse(createBody, await c.req.json());
    const { workspace } = workspaceCtx(c);
    const taken = (await userVariablesOf(c.var.db, workspace.id)).map((v) => v.key);
    const problem = varKeyProblem(body.key, taken);
    if (problem) throw new ApiError(400, "validation_error", problem, { key: problem });
    const id = newId();
    await c.var.db.insert(messageVariables).values({ id, workspaceId: workspace.id, ...body, createdAt: now(), updatedAt: now() });
    return c.json({ id }, 201);
  })
  // key 는 템플릿 본문이 가리키므로 바꾸지 않는다. 이름표와 기본값만
  .patch("/:id", editorsOnly, async (c) => {
    const body = parse(editBody, await c.req.json());
    const { workspace } = workspaceCtx(c);
    const v = await findVariable(c.var.db, workspace.id, c.req.param("id"));
    await c.var.db.update(messageVariables).set({ ...body, updatedAt: now() }).where(eq(messageVariables.id, v.id));
    return c.json({ ok: true });
  })
  // 삭제 전 확인용: 이 변수를 쓰는 템플릿 이름
  .get("/:id/usage", async (c) => {
    const { workspace } = workspaceCtx(c);
    const v = await findVariable(c.var.db, workspace.id, c.req.param("id"));
    return c.json({ templates: await variableUsage(c.var.db, workspace.id, v.key) });
  })
  // 쓰는 템플릿이 있어도 지운다(화면이 이름을 보여 주고 확인받는다). 본문의 {{key}} 는 없는 변수 경고로 남는다
  .delete("/:id", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    const v = await findVariable(c.var.db, workspace.id, c.req.param("id"));
    await c.var.db.delete(messageVariables).where(eq(messageVariables.id, v.id));
    return c.json({ ok: true });
  });
