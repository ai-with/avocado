import { Hono } from "hono";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import type { AppEnv } from "../../types";
import { leadGroups } from "../../db/schema";
import { parse } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { logEvent } from "../../lib/events";
import { loadLeads } from "../../lib/leads";
import { evaluateGroup } from "../../lib/lead-groups";
import { editorsOnly, workspaceCtx } from "../../middleware/auth";

// 리드 그룹 (규칙 기반)

const conditionSchema = z.object({
  field: z.enum(["guide_id", "influencer_id", "channel_key", "source_type", "marketing_opt_in", "alimtalk_opt_in", "tag_id", "created_after"]),
  op: z.enum(["eq", "neq"]),
  value: z.union([z.string(), z.number(), z.boolean()]),
});
const rulesSchema = z.object({ all: z.array(conditionSchema).max(20) });

export const groupRoutes = new Hono<AppEnv>()
  .get("/groups", async (c) => {
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    const [groups, all] = await Promise.all([db.select().from(leadGroups).where(eq(leadGroups.workspaceId, workspace.id)).orderBy(asc(leadGroups.createdAt)), loadLeads(db, workspace.id)]);
    return c.json({ groups: groups.map((g) => ({ ...g, count: all.filter((l) => evaluateGroup(g.rules, l.facts)).length })) });
  })
  // 규칙 미리보기: 저장 전 현재 인원 수
  .post("/groups/preview", async (c) => {
    const { rules } = parse(z.object({ rules: rulesSchema }), await c.req.json());
    const { workspace } = workspaceCtx(c);
    const all = await loadLeads(c.var.db, workspace.id);
    return c.json({ count: all.filter((l) => evaluateGroup(rules, l.facts)).length });
  })
  .post("/groups", editorsOnly, async (c) => {
    const body = parse(z.object({ name: z.string().trim().min(1, "그룹 이름을 넣어 주세요.").max(40), rules: rulesSchema }), await c.req.json());
    const { workspace } = workspaceCtx(c);
    const group = { id: newId(), workspaceId: workspace.id, ...body, createdAt: now() };
    await c.var.db.insert(leadGroups).values(group);
    await logEvent(c.var.db, workspace.id, "lead_group_created", { rule_count: body.rules.all.length });
    return c.json({ group }, 201);
  })
  .patch("/groups/:id", editorsOnly, async (c) => {
    const body = parse(z.object({ name: z.string().trim().min(1).max(40).optional(), rules: rulesSchema.optional() }), await c.req.json());
    const { workspace } = workspaceCtx(c);
    await c.var.db.update(leadGroups).set(body).where(and(eq(leadGroups.id, c.req.param("id")), eq(leadGroups.workspaceId, workspace.id)));
    return c.json({ ok: true });
  })
  .delete("/groups/:id", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    await c.var.db.delete(leadGroups).where(and(eq(leadGroups.id, c.req.param("id")), eq(leadGroups.workspaceId, workspace.id)));
    return c.json({ ok: true });
  });
