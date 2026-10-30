import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../../types";
import { messageTemplates } from "../../db/schema";
import { parse } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { findTemplate, saveBodies, templatesOf } from "../../lib/message-templates";
import { editorsOnly, workspaceCtx } from "../../middleware/auth";
import { TEMPLATE_PURPOSES } from "../../../shared/message-render";

// 설정 > 메시지 템플릿 (/api/message-templates, TASK-073). 본문은 언어(ko·en)별

const MAX_BODY = 5000;
const body = z.object({
  name: z.string().trim().min(1, "템플릿 이름을 입력해 주세요.").max(60),
  purpose: z.enum(TEMPLATE_PURPOSES),
  bodies: z.object({ ko: z.string().max(MAX_BODY).optional(), en: z.string().max(MAX_BODY).optional() }),
});

export const messageTemplateRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { workspace } = workspaceCtx(c);
    return c.json({ templates: await templatesOf(c.var.db, workspace.id) });
  })
  .post("/", editorsOnly, async (c) => {
    const { bodies, ...rest } = parse(body, await c.req.json());
    const { workspace } = workspaceCtx(c);
    const id = newId();
    await c.var.db.insert(messageTemplates).values({ id, workspaceId: workspace.id, ...rest, createdAt: now(), updatedAt: now() });
    await saveBodies(c.var.db, id, bodies);
    return c.json({ id }, 201);
  })
  .patch("/:id", editorsOnly, async (c) => {
    const { bodies, ...rest } = parse(body, await c.req.json());
    const { workspace } = workspaceCtx(c);
    const t = await findTemplate(c.var.db, workspace.id, c.req.param("id"));
    await c.var.db.update(messageTemplates).set({ ...rest, updatedAt: now() }).where(eq(messageTemplates.id, t.id));
    await saveBodies(c.var.db, t.id, bodies);
    return c.json({ ok: true });
  })
  .delete("/:id", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    const t = await findTemplate(c.var.db, workspace.id, c.req.param("id"));
    await c.var.db.delete(messageTemplates).where(eq(messageTemplates.id, t.id));
    return c.json({ ok: true });
  });
