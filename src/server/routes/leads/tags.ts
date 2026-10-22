import { Hono } from "hono";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import type { AppEnv } from "../../types";
import { leadTagLinks, leadTags, leads } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newId } from "../../lib/ids";
import { logEvent } from "../../lib/events";
import { findOwned } from "../../lib/owned";
import { editorsOnly, workspaceCtx } from "../../middleware/auth";

// 리드 태그

// D1 바인딩 변수 한도(100) 안에 들도록 나눠 넣는다
const INSERT_CHUNK = 40;

export const tagRoutes = new Hono<AppEnv>()
  .get("/tags", async (c) => {
    const { workspace } = workspaceCtx(c);
    return c.json({ tags: await c.var.db.select().from(leadTags).where(eq(leadTags.workspaceId, workspace.id)).orderBy(asc(leadTags.name)) });
  })
  .post("/tags", editorsOnly, async (c) => {
    const { name } = parse(z.object({ name: z.string().trim().min(1, "태그 이름을 넣어 주세요.").max(30) }), await c.req.json());
    const { workspace } = workspaceCtx(c);
    const tag = { id: newId(), workspaceId: workspace.id, name };
    const r = await c.var.db.insert(leadTags).values(tag).onConflictDoNothing().returning();
    if (r.length === 0) throw new ApiError(409, "tag_exists", "같은 이름의 태그가 있어요.", { name: "같은 이름의 태그가 있어요." });
    return c.json({ tag }, 201);
  })
  .delete("/tags/:id", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    await c.var.db.delete(leadTags).where(and(eq(leadTags.id, c.req.param("id")), eq(leadTags.workspaceId, workspace.id)));
    return c.json({ ok: true });
  })
  .post("/tags/:id/attach", editorsOnly, async (c) => {
    const { leadIds } = parse(z.object({ leadIds: z.array(z.string()).min(1).max(1000) }), await c.req.json());
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const tag = await findOwned(db, leadTags, c.req.param("id"), workspace.id, { code: "tag_not_found", message: "태그를 찾을 수 없습니다." });
    const mine = new Set((await db.select({ id: leads.id }).from(leads).where(eq(leads.workspaceId, workspace.id))).map((l) => l.id));
    const values = leadIds.filter((id) => mine.has(id)).map((leadId) => ({ leadId, tagId: tag.id }));
    for (let i = 0; i < values.length; i += INSERT_CHUNK) await db.insert(leadTagLinks).values(values.slice(i, i + INSERT_CHUNK)).onConflictDoNothing();
    await logEvent(db, workspace.id, "lead_tagged", { count: values.length });
    return c.json({ attached: values.length });
  });
