import type { Db } from "../db";
import type { GroupCondition, GroupRules } from "../../shared/leads";
import type { Audience, Channel, MessageKind } from "../../shared/messaging";
import type { LeadFacts } from "./lead-groups";
import { ApiError } from "./errors";
import { hmacHex, safeEqual } from "./crypto";
import { sha256Hex } from "./ids";
import { searchPendingSql } from "./lead-search";
import type { leads } from "../db/schema";

type Lead = typeof leads.$inferSelect;
type Rule = { field: string; value: string | number; not: boolean; kind: "source" | "tag" | "bool" | "date" | "constant" };
export function normalizeRules(rules: GroupRules): Rule[] {
  if (!rules || !Array.isArray(rules.all) || rules.all.length > 40) throw new ApiError(400, "invalid_rules", "그룹 조건을 확인해 주세요.");
  const normalized: Rule[] = rules.all.map((c) => {
    if (!c || !["eq", "neq"].includes(c.op) || !["string", "number", "boolean"].includes(typeof c.value)) throw new ApiError(400, "invalid_rules", "그룹 조건을 확인해 주세요.");
    const common = { field: c.field, not: c.op === "neq" };
    if (["marketing_opt_in", "alimtalk_opt_in"].includes(c.field)) return { ...common, kind: "bool", value: c.value === true || c.value === "true" || c.value === 1 ? 1 : 0 };
    if (c.field === "created_after") { const value = Number(c.value); return Number.isFinite(value) ? { ...common, kind: "date", value } : { ...common, kind: "constant", value: value === -Infinity ? 1 : 0 }; }
    if (c.field === "tag_id") return { ...common, kind: "tag", value: String(c.value) };
    if (["guide_id", "influencer_id", "channel_key", "source_type", "link_id"].includes(c.field)) return typeof c.value === "string" ? { ...common, kind: "source", value: c.value } : { ...common, kind: "constant", value: 0 };
    throw new ApiError(400, "invalid_rules", "지원하지 않는 그룹 조건이에요.");
  });
  const never: Rule[] = [{ field: "constant", kind: "constant", value: 0, not: false }];
  const result = new Map<string, Rule>(), booleans = new Map<string, number>(); let lower: number | null = null, upper: number | null = null;
  for (const rule of normalized) {
    if (rule.kind === "constant") { if (Boolean(rule.value) === rule.not) return never; continue; }
    if (rule.kind === "date") { if (rule.not) upper = upper === null ? Number(rule.value) : Math.min(upper, Number(rule.value)); else lower = lower === null ? Number(rule.value) : Math.max(lower, Number(rule.value)); continue; }
    if (rule.kind === "bool") { const value = rule.not ? 1 - Number(rule.value) : Number(rule.value); if (booleans.has(rule.field) && booleans.get(rule.field) !== value) return never; booleans.set(rule.field, value); continue; }
    const key = JSON.stringify([rule.kind, rule.field, rule.value]); if (result.has(key) && result.get(key)!.not !== rule.not) return never; result.set(key, rule);
  }
  if (lower !== null && upper !== null && lower >= upper) return never;
  if (lower !== null) result.set("lower", { kind: "date", field: "created_after", value: lower, not: false });
  if (upper !== null) result.set("upper", { kind: "date", field: "created_after", value: upper, not: true });
  for (const [field, value] of booleans) result.set(field, { kind: "bool", field, value, not: false });
  return [...result.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
// Each source condition has its own EXISTS. neq negates the entire match, so
// empty sources/null fields never acquire SQL's different three-valued semantics.
export function rulesPredicate(rules: string, lead = "l") {
  return `NOT EXISTS(SELECT 1 FROM json_each(${rules}) rule WHERE coalesce(CASE json_extract(rule.value,'$.kind')
    WHEN 'constant' THEN json_extract(rule.value,'$.value')
    WHEN 'date' THEN ${lead}.created_at>=json_extract(rule.value,'$.value')
    WHEN 'bool' THEN (CASE json_extract(rule.value,'$.field') WHEN 'marketing_opt_in' THEN ${lead}.marketing_opt_in=1 ELSE ${lead}.alimtalk_opt_in=1 END)=json_extract(rule.value,'$.value')
    WHEN 'tag' THEN EXISTS(SELECT 1 FROM lead_tag_links x JOIN lead_tags t ON t.id=x.tag_id WHERE x.lead_id=${lead}.id AND t.workspace_id=${lead}.workspace_id AND x.tag_id=json_extract(rule.value,'$.value'))
    WHEN 'source' THEN CASE json_extract(rule.value,'$.field')
      WHEN 'source_type' THEN EXISTS(SELECT 1 FROM lead_sources s WHERE s.lead_id=${lead}.id AND s.type=json_extract(rule.value,'$.value'))
      WHEN 'guide_id' THEN EXISTS(SELECT 1 FROM lead_sources s WHERE s.lead_id=${lead}.id AND s.guide_id=json_extract(rule.value,'$.value'))
      WHEN 'influencer_id' THEN EXISTS(SELECT 1 FROM lead_sources s WHERE s.lead_id=${lead}.id AND s.influencer_id=json_extract(rule.value,'$.value'))
      WHEN 'channel_key' THEN EXISTS(SELECT 1 FROM lead_sources s WHERE s.lead_id=${lead}.id AND s.channel_key=json_extract(rule.value,'$.value'))
      WHEN 'link_id' THEN EXISTS(SELECT 1 FROM lead_sources s WHERE s.lead_id=${lead}.id AND s.link_id=json_extract(rule.value,'$.value')) END END,0)=json_extract(rule.value,'$.not'))`;
}
const fields: [string, GroupCondition["field"]][] = [["sourceType", "source_type"], ["guideId", "guide_id"], ["influencerId", "influencer_id"], ["channelKey", "channel_key"], ["tagId", "tag_id"], ["marketing", "marketing_opt_in"], ["alimtalk", "alimtalk_opt_in"]];
type Plan = { workspace: string; rules: Rule[]; text: string; fingerprint: string; after: { at: number; id: string } | null; limit: number };
export async function readRuleGroups(db: Db, workspace: string, ids: string[], includeRaw = false) {
  if (ids.length > 50) throw new ApiError(400, "too_many_groups", "한 번에 50개 그룹까지 확인할 수 있어요.");
  if (!ids.length) return [];
  const query = "FROM lead_groups WHERE workspace_id=? AND id IN(SELECT value FROM json_each(?))", values = [workspace, JSON.stringify([...new Set(ids)])];
  const size = await db.$client.prepare(`SELECT coalesce(sum(length(CAST(rules AS BLOB))+length(CAST(name AS BLOB))),0) AS bytes ${query}`).bind(...values).first<{ bytes: number }>();
  if (size && size.bytes > 524288) throw new ApiError(413, "group_rules_too_large", "그룹 조건 자료가 커요. 조건을 줄여 주세요.");
  let result: D1Result[];
  try { result = await db.$client.batch([
    db.$client.prepare(`SELECT json(CASE WHEN coalesce(sum(length(CAST(rules AS BLOB))+length(CAST(name AS BLOB))),0)<=524288 THEN 'true' ELSE 'group_rules_too_large' END) ${query}`).bind(...values),
    db.$client.prepare(`SELECT id,name,rules,created_at ${query}`).bind(...values),
  ]); } catch { throw new ApiError(503, "groups_unavailable", "그룹 조건을 불러오지 못했어요."); }
  return (result[1]!.results as { id: string; name: string; rules: string; created_at: number }[]).map((row) => ({ id: row.id, name: row.name, rules: JSON.parse(row.rules) as GroupRules, ...(includeRaw && { rawRules: row.rules }), createdAt: row.created_at }));
}
export async function leadPlan(db: Db, workspace: string, q: Record<string, string>): Promise<Plan> {
  const all: GroupCondition[] = fields.filter(([key]) => q[key]).map(([key, field]) => ({ field, op: "eq", value: q[key]! }));
  if (q.contentLinkId) all.push({ field: "link_id" as GroupCondition["field"], op: "eq", value: q.contentLinkId });
  if (q.groupId) {
    const group = (await readRuleGroups(db, workspace, [q.groupId]))[0];
    if (!group) throw new ApiError(404, "group_not_found", "그룹을 찾을 수 없어요.");
    all.push(...group.rules.all);
  }
  const rules = normalizeRules({ all }), text = (q.q ?? "").trim().toLowerCase();
  return { workspace, rules, text, fingerprint: await sha256Hex(JSON.stringify([workspace, rules, text])), after: null, limit: 51 };
}
function where(plan: Plan, text = true) {
  return `l.workspace_id=json_extract(ctx.data,'$.workspace') AND l.deleted_at IS NULL AND ${rulesPredicate("json_extract(ctx.data,'$.rules')")}
    ${text && plan.text ? `AND (instr(CAST(l.search_email_v1 AS BLOB),CAST(json_extract(ctx.data,'$.text') AS BLOB))>0 OR instr(CAST(l.search_name_v1 AS BLOB),CAST(json_extract(ctx.data,'$.text') AS BLOB))>0 OR instr(CAST(l.search_company_v1 AS BLOB),CAST(json_extract(ctx.data,'$.text') AS BLOB))>0 OR instr(CAST(l.search_phone_v1 AS BLOB),CAST(json_extract(ctx.data,'$.text') AS BLOB))>0)` : ""}`;
}
const projection = "l.id,l.workspace_id,l.email,l.name,l.company,l.phone,l.marketing_opt_in,l.alimtalk_opt_in,l.unsubscribed_at,l.bounced_at,l.first_source,l.last_source,l.created_at";
const ctx = "WITH ctx(data) AS (VALUES(?))";
type Raw = Record<string, unknown>;
function mapLead(row: Raw): Lead {
  const { workspace_id: workspaceId, marketing_opt_in, alimtalk_opt_in, unsubscribed_at: unsubscribedAt, bounced_at: bouncedAt, first_source, last_source, created_at: createdAt, deleted_at: deletedAt, unsubscribe_token: unsubscribeToken, email_hash: emailHash, search_email_v1, search_name_v1, search_company_v1, search_phone_v1, ...rest } = row;
  return { ...rest, workspaceId, marketingOptIn: Number(marketing_opt_in) === 1, alimtalkOptIn: Number(alimtalk_opt_in) === 1, unsubscribedAt, bouncedAt, firstSource: JSON.parse(String(first_source)), lastSource: JSON.parse(String(last_source)), createdAt, ...(row.answers !== undefined && { answers: JSON.parse(String(row.answers)) }), ...(unsubscribeToken !== undefined && { unsubscribeToken }), ...(deletedAt !== undefined && { deletedAt }), ...(emailHash !== undefined && { emailHash }) } as Lead;
}
export async function assertSearchReady(db: Db, plan: Plan) {
  if (!plan.text) return;
  const missing = await db.$client.prepare(`${ctx} SELECT l.id FROM ctx CROSS JOIN leads l WHERE ${where(plan, false)} AND (${searchPendingSql()}) LIMIT 1`).bind(JSON.stringify(plan)).first();
  if (missing) throw new ApiError(503, "search_preparing", "검색 자료를 준비하고 있어요. 잠시 후 다시 검색해 주세요.");
}
export async function queryLeadRows(db: Db, plan: Plan, full = false) {
  const page = `${ctx},page AS(SELECT l.id,l.workspace_id FROM ctx CROSS JOIN leads l INDEXED BY leads_live_seek_idx WHERE ${where(plan)}
    ${plan.after ? "AND (l.created_at,l.id)<(json_extract(ctx.data,'$.after.at'),json_extract(ctx.data,'$.after.id'))" : ""}
    ORDER BY l.created_at DESC,l.id DESC ${full ? "" : "LIMIT (SELECT json_extract(data,'$.limit') FROM ctx)"})`;
  // The assertion and all hydration queries share one native snapshot. A late
  // old writer cannot turn a pending search into a falsely empty result.
  const guard = plan.text ? `${ctx} SELECT json(CASE WHEN NOT EXISTS(SELECT 1 FROM ctx CROSS JOIN leads l WHERE ${where(plan, false)} AND (${searchPendingSql()})) THEN 'true' ELSE 'lead_search_pending' END)` : "SELECT 1";
  const budget = `${page} SELECT coalesce(sum(512+${["email", "name", "company", "phone"].map((column) => `length(CAST(json_quote(l.${column}) AS BLOB))`).join("+")}
    +length(CAST(l.first_source AS BLOB))+length(CAST(l.last_source AS BLOB))),0)
    +(SELECT coalesce(sum(length(CAST(json_quote(x.tag_id) AS BLOB))+32),0) FROM lead_tag_links x JOIN page p ON p.id=x.lead_id JOIN lead_tags t ON t.id=x.tag_id AND t.workspace_id=p.workspace_id) AS bytes,
    (SELECT count(*) FROM lead_tag_links x JOIN page p ON p.id=x.lead_id JOIN lead_tags t ON t.id=x.tag_id AND t.workspace_id=p.workspace_id) AS tags FROM leads l JOIN page p ON p.id=l.id`;
  if (!full) { const size = await db.$client.prepare(budget).bind(JSON.stringify(plan)).first<{ bytes: number; tags: number }>(); if (size && (size.bytes > 1_048_576 || size.tags > 1000)) throw new ApiError(413, "lead_page_too_large", "페이지 자료가 커요. 페이지 크기나 필터를 좁혀 주세요."); }
  let result: D1Result[];
  try { result = await db.$client.batch([
    plan.text ? db.$client.prepare(guard).bind(JSON.stringify(plan)) : db.$client.prepare(guard),
    full ? db.$client.prepare("SELECT 1") : db.$client.prepare(`SELECT json(CASE WHEN bytes<=1048576 AND tags<=1000 THEN 'true' ELSE 'lead_page_too_large' END) FROM(${budget})`).bind(JSON.stringify(plan)),
    db.$client.prepare(`${page} SELECT ${full ? "l.*" : projection} FROM leads l JOIN page p ON p.id=l.id ORDER BY l.created_at DESC,l.id DESC`).bind(JSON.stringify(plan)),
    db.$client.prepare(`${page} SELECT DISTINCT s.lead_id,s.type${full ? ",s.guide_id,s.influencer_id,s.channel_key,s.link_id" : ""} FROM lead_sources s JOIN page p ON p.id=s.lead_id`).bind(JSON.stringify(plan)),
    db.$client.prepare(`${page} SELECT x.lead_id,x.tag_id FROM lead_tag_links x JOIN page p ON p.id=x.lead_id JOIN lead_tags t ON t.id=x.tag_id AND t.workspace_id=p.workspace_id`).bind(JSON.stringify(plan)),
  ]); } catch { throw new ApiError(503, plan.text ? "search_preparing" : "leads_unavailable", plan.text ? "검색 자료를 준비하고 있어요. 잠시 후 다시 검색해 주세요." : "리드 목록을 불러오지 못했어요."); }
  const sources = new Map<string, LeadFacts["sources"]>(), tags = new Map<string, string[]>();
  for (const raw of result[3]!.results as Raw[]) { const key = String(raw.lead_id); const list = sources.get(key) ?? []; list.push({ type: raw.type as LeadFacts["sources"][number]["type"], guideId: (raw.guide_id ?? null) as string | null, influencerId: (raw.influencer_id ?? null) as string | null, channelKey: (raw.channel_key ?? null) as string | null, linkId: (raw.link_id ?? null) as string | null }); sources.set(key, list); }
  for (const raw of result[4]!.results as Raw[]) { const key = String(raw.lead_id); const list = tags.get(key) ?? []; list.push(String(raw.tag_id)); tags.set(key, list); }
  return (result[2]!.results as Raw[]).map((row) => { const lead = mapLead(row); return { lead, facts: { marketingOptIn: lead.marketingOptIn, alimtalkOptIn: lead.alimtalkOptIn, createdAt: lead.createdAt, sources: sources.get(lead.id) ?? [], tagIds: tags.get(lead.id) ?? [] } }; });
}
export async function encodeLeadCursor(env: Env, value: unknown) {
  const body = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
  return `${body}.${await hmacHex(env.TOKEN_ENC_KEY!, `lead-page-v1:${body}`)}`;
}
export async function decodeLeadCursor(env: Env, cursor: string): Promise<Record<string, unknown>> {
  if (cursor.length > 4096 || cursor.split(".").length !== 2) throw new Error("invalid_cursor"); const [body, signature] = cursor.split(".");
  if (!body || !signature || !safeEqual(signature, await hmacHex(env.TOKEN_ENC_KEY!, `lead-page-v1:${body}`))) throw new Error("invalid_cursor");
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body), (v) => v.charCodeAt(0)))) as Record<string, unknown>;
}
export async function leadPage(db: Db, env: Env, workspace: string, q: Record<string, string>) {
  const plan = await leadPlan(db, workspace, q), limit = q.limit ? Number(q.limit) : 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, "invalid_page", "페이지 크기를 확인해 주세요.");
  if (q.cursor) {
    try {
      const value = await decodeLeadCursor(env, q.cursor);
      if (value.fingerprint !== plan.fingerprint || !Number.isSafeInteger(value.at) || typeof value.id !== "string" || value.id.length > 200) throw new Error();
      plan.after = { at: value.at as number, id: value.id };
    } catch { throw new ApiError(400, "invalid_cursor", "목록 조건이 바뀌었어요. 첫 페이지부터 다시 확인해 주세요."); }
  }
  plan.limit = limit + 1; await assertSearchReady(db, plan); const found = await queryLeadRows(db, plan), rows = found.slice(0, limit), last = rows.at(-1);
  let nextCursor: string | null = null;
  if (found.length > limit && last) nextCursor = await encodeLeadCursor(env, { fingerprint: plan.fingerprint, at: last.lead.createdAt, id: last.lead.id });
  return { rows, nextCursor };
}
export async function groupCounts(db: Db, workspace: string, groups: { id: string; rules: GroupRules }[]) {
  if (groups.length > 50) throw new ApiError(400, "too_many_groups", "한 번에 50개 그룹까지 확인할 수 있어요.");
  const data = JSON.stringify(groups.map((g) => ({ id: g.id, rules: normalizeRules(g.rules) })));
  const rows = await db.$client.prepare(`WITH selected AS(SELECT value FROM json_each(?)) SELECT json_extract(g.value,'$.id') AS id,count(l.id) AS n
    FROM selected g LEFT JOIN leads l ON l.workspace_id=? AND l.deleted_at IS NULL AND ${rulesPredicate("json_extract(g.value,'$.rules')")}
    GROUP BY json_extract(g.value,'$.id')`).bind(data, workspace).all<{ id: string; n: number }>();
  return new Map(rows.results.map((r) => [r.id, r.n]));
}
export function audiencePredicate(groups: string, tags: string, lead = "l") {
  return `(EXISTS(SELECT 1 FROM json_each(${groups}) g WHERE ${rulesPredicate("json_extract(g.value,'$.rules')", lead)}) OR EXISTS(SELECT 1 FROM lead_tag_links x JOIN lead_tags t ON t.id=x.tag_id WHERE x.lead_id=${lead}.id AND t.workspace_id=${lead}.workspace_id AND x.tag_id IN(SELECT value FROM json_each(${tags}))))`;
}
export async function countAudienceSummary(db: Db, workspace: string, audience: Audience, channel: Channel, kind: MessageKind) {
  const ids = [...new Set(audience.groupIds)];
  const stored = await readRuleGroups(db, workspace, ids);
  const groups = stored.map((g) => ({ id: g.id, rules: normalizeRules(g.rules) }));
  const connection = channel === "alimtalk" ? await db.$client.prepare("SELECT status FROM alimtalk_channels WHERE workspace_id=?").bind(workspace).first<{ status: string }>() : null;
  const rows = await db.$client.prepare(`WITH ctx(groups,tags) AS(VALUES(?,?)),selected AS(SELECT l.unsubscribed_at,l.bounced_at,l.phone,l.alimtalk_opt_in,l.marketing_opt_in FROM ctx CROSS JOIN leads l WHERE l.workspace_id=? AND l.deleted_at IS NULL AND ${audiencePredicate("ctx.groups", "ctx.tags")}),
    reasons AS(SELECT CASE WHEN coalesce(unsubscribed_at,0)<>0 THEN 'unsubscribed' WHEN ?='email' AND coalesce(bounced_at,0)<>0 THEN 'bounced'
      WHEN ?='alimtalk' AND (phone IS NULL OR phone='') THEN 'no_phone' WHEN ?='alimtalk' AND alimtalk_opt_in<>1 THEN 'no_alimtalk_consent'
      WHEN ?='alimtalk' AND ?=0 THEN 'alimtalk_not_connected' WHEN ?='email' AND ?='ad' AND marketing_opt_in<>1 THEN 'no_consent' ELSE 'eligible' END AS reason FROM selected)
    SELECT reason,count(*) AS n FROM reasons GROUP BY reason`).bind(JSON.stringify(groups), JSON.stringify([...new Set(audience.tagIds)]), workspace, channel, channel, channel, channel, connection?.status === "connected" ? 1 : 0, channel, kind).all<{ reason: string; n: number }>();
  return { total: rows.results.reduce((sum, row) => sum + row.n, 0), eligible: rows.results.find((r) => r.reason === "eligible")?.n ?? 0, reasons: Object.fromEntries(rows.results.filter((r) => r.reason !== "eligible").map((r) => [r.reason, r.n])) };
}
