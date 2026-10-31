import { Hono } from "hono";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import type { AppEnv } from "../../types";
import { leadGroups } from "../../db/schema";
import { ApiError, parse } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { logEvent } from "../../lib/events";
import { decodeLeadCursor, encodeLeadCursor, groupCounts, readRuleGroups } from "../../lib/lead-query";
import { editorsOnly, workspaceCtx } from "../../middleware/auth";

// 리드 그룹 (규칙 기반)

const conditionSchema = z.object({
  field: z.enum(["guide_id", "influencer_id", "channel_key", "source_type", "marketing_opt_in", "alimtalk_opt_in", "tag_id", "created_after"]),
  op: z.enum(["eq", "neq"]),
  value: z.union([z.string().max(200), z.number(), z.boolean()]),
});
const rulesSchema = z.object({ all: z.array(conditionSchema).max(20) });

export const groupRoutes = new Hono<AppEnv>()
  .get("/groups", async (c) => {
    const { workspace } = workspaceCtx(c);
    const db = c.var.db;
    let after = { at: -1, id: "" };
    if (c.req.query("cursor")) { try { const value = await decodeLeadCursor(c.env, c.req.query("cursor")!); if (value.workspace !== workspace.id || value.kind !== "groups" || !Number.isSafeInteger(value.at) || typeof value.id !== "string" || value.id.length > 200) throw new Error(); after = { at: value.at as number, id: value.id }; } catch { throw new ApiError(400, "invalid_cursor", "그룹 목록을 다시 열어 주세요."); } }
    const query = "SELECT id,name,rules,created_at FROM lead_groups WHERE workspace_id=? AND (created_at,id)>(?,?) ORDER BY created_at,id LIMIT 51";
    const size = await db.$client.prepare(`SELECT coalesce(sum(length(CAST(rules AS BLOB))+length(CAST(name AS BLOB))),0) AS bytes FROM(${query})`).bind(workspace.id, after.at, after.id).first<{ bytes: number }>();
    if (size && size.bytes > 524288) throw new ApiError(413, "group_rules_too_large", "그룹 조건 자료가 커요. 조건을 줄여 주세요.");
    const results = await db.$client.batch([
      db.$client.prepare(`SELECT json(CASE WHEN coalesce(sum(length(CAST(rules AS BLOB))+length(CAST(name AS BLOB))),0)<=524288 THEN 'true' ELSE 'group_rules_too_large' END) FROM(${query})`).bind(workspace.id, after.at, after.id),
      db.$client.prepare(query).bind(workspace.id, after.at, after.id),
    ]);
    const found = (results[1]!.results as { id: string; name: string; rules: string; created_at: number }[]), groups = found.slice(0, 50).map((g) => ({ id: g.id, name: g.name, rules: JSON.parse(g.rules), createdAt: g.created_at }));
    const counts = await groupCounts(db, workspace.id, groups), last = groups.at(-1);
    return c.json({ groups: groups.map((g) => ({ ...g, count: counts.get(g.id) ?? 0 })), nextCursor: found.length > 50 && last ? await encodeLeadCursor(c.env, { kind: "groups", workspace: workspace.id, at: last.createdAt, id: last.id }) : null });
  })
  // 규칙 미리보기: 저장 전 현재 인원 수
  .post("/groups/preview", async (c) => {
    const { rules } = parse(z.object({ rules: rulesSchema }), await c.req.json());
    const { workspace } = workspaceCtx(c);
    const counts = await groupCounts(c.var.db, workspace.id, [{ id: "preview", rules }]);
    return c.json({ count: counts.get("preview") ?? 0 });
  })
  .get("/groups/selected", async (c) => {
    const { workspace } = workspaceCtx(c); let ids: string[];
    try { ids = parse(z.array(z.string().max(200)).max(50), JSON.parse(c.req.query("ids") ?? "[]")); } catch { throw new ApiError(400, "invalid_groups", "선택한 그룹을 확인해 주세요."); }
    const groups = await readRuleGroups(c.var.db, workspace.id, ids), counts = await groupCounts(c.var.db, workspace.id, groups);
    return c.json({ groups: groups.map((g) => ({ ...g, count: counts.get(g.id) ?? 0 })) });
  })
  .get("/groups/:id", async (c) => {
    const { workspace } = workspaceCtx(c), db = c.var.db;
    const row = (await readRuleGroups(db, workspace.id, [c.req.param("id")]))[0];
    if (!row) throw new ApiError(404, "group_not_found", "그룹을 찾을 수 없어요.");
    const counts = await groupCounts(db, workspace.id, [row]);
    return c.json({ group: { ...row, count: counts.get(row.id) ?? 0 } });
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
