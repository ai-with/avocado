import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv, Auth } from "../types";
import { createSqliteD1 } from "../test/sqlite-d1";
import { getDb } from "../db";
import { leadPage, groupCounts, countAudienceSummary, leadPlan, queryLeadRows } from "./lead-query";
import { backfillLeadSearch, leadSearchValues } from "./lead-search";
import { upsertLead } from "./leads";
import { evaluateGroup, type LeadFacts } from "./lead-groups";
import { canSend } from "../../shared/messaging";
import type { GroupCondition, GroupRules } from "../../shared/leads";
import { ApiError } from "./errors";
import { leadRoutes } from "../routes/leads";
import { boundedLeadLookups, leadLookupPage } from "./lead-lookups";

const close: (() => void)[] = [];
afterEach(() => { close.splice(0).forEach((fn) => fn()); vi.restoreAllMocks(); });
async function setup() {
  const fixture = await createSqliteD1(); close.push(fixture.close); const { db, d1 } = fixture;
  db.exec("INSERT INTO workspaces(id,name,created_at) VALUES('w','QA',1),('other','Other',1)");
  for (const [id, workspace] of [["g", "w"], ["foreign-g", "other"]]) db.prepare("INSERT INTO guides(id,workspace_id,name,slug,extra_rules,product,deliverables,secondary_use_scope,created_at,updated_at) VALUES(?,?,?,?,'[]','{}','{}','{}',1,1)").run(id!, workspace!, id!, id!);
  db.exec("INSERT INTO influencers(id,workspace_id,display_name,created_at) VALUES('i','w','Creator',1)");
  db.exec("INSERT INTO lead_tags(id,workspace_id,name) VALUES('tag','w','Tag'),('foreign-tag','other','Other')");
  const sent: unknown[] = [], sendBatch = vi.fn(async (messages: unknown[]) => { sent.push(...messages); });
  const env = { DB: d1, APP_URL: "https://app.test", TOKEN_ENC_KEY: "fake-query-cursor-key", PIPELINE: { sendBatch } } as unknown as Env, orm = getDb(d1);
  const lead = (id: string, options: { workspace?: string; name?: string | null; company?: string | null; phone?: string | null; createdAt?: number; prepared?: boolean; marketing?: boolean; alimtalk?: boolean; unsubscribedAt?: number | null; bouncedAt?: number | null; deletedAt?: number | null } = {}) => {
    const profile = { email: `${id}@qa.invalid`, name: options.name ?? null, company: options.company ?? null, phone: options.phone ?? null }, fold = leadSearchValues(profile);
    const source = JSON.stringify({ type: "manual", guideId: null, influencerId: null, channelKey: null, linkId: null, at: options.createdAt ?? 10 });
    db.prepare("INSERT INTO leads(id,workspace_id,email,name,company,phone,answers,marketing_opt_in,alimtalk_opt_in,unsubscribe_token,first_source,last_source,created_at,search_email_v1,search_name_v1,search_company_v1,search_phone_v1,unsubscribed_at,bounced_at,deleted_at) VALUES(?,?,?,?,?,?,'{}',?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, options.workspace ?? "w", profile.email, profile.name, profile.company, profile.phone, options.marketing ? 1 : 0, options.alimtalk ? 1 : 0, `private-${id}`, source, source, options.createdAt ?? 10, ...(options.prepared === false ? [null, null, null, null] : Object.values(fold)), options.unsubscribedAt ?? null, options.bouncedAt ?? null, options.deletedAt ?? null);
    return profile;
  };
  const source = (id: string, suffix = "", channel = "threads", guide = "g") => db.prepare("INSERT INTO lead_sources(id,lead_id,type,guide_id,influencer_id,channel_key,at) VALUES(?,?,'form',?,'i',?,1)").run(`${id}-${suffix}`, id, guide, channel);
  const app = new Hono<AppEnv>(); app.use("*", async (c, next) => { c.set("db", orm); c.set("auth", { user: { id: "u", email: "qa@qa.invalid", name: "QA" }, sessionId: "sid", workspace: { id: "w", name: "QA", plan: "starter", onboardedAt: 1 }, role: "owner", phoneVerified: true, phone: null } as Auth); await next(); });
  app.route("/leads", leadRoutes); app.onError((error, c) => error instanceof ApiError ? c.json({ error: { code: error.code, message: error.message } }, error.status) : c.json({ error: { code: "failed" } }, 500));
  return { ...fixture, orm, env, lead, source, sent, sendBatch, app };
}
function meter(base: D1Database) {
  let physical = 0, maxBind = 0, returnedBytes = 0; const queries: { sql: string; params: unknown[] }[] = [];
  const wrap = (sql: string, params: unknown[] = []): D1PreparedStatement => {
    const statement = base.prepare(sql).bind(...params);
    return new Proxy(statement, { get(target, key) {
      if (key === "bind") return (...values: unknown[]) => { maxBind = Math.max(maxBind, values.length); return wrap(sql, values); };
      if (["all", "first", "run", "raw"].includes(String(key))) return async (...args: unknown[]) => { physical++; queries.push({ sql, params }); const result = await Reflect.get(target, key).apply(target, args); returnedBytes += new TextEncoder().encode(JSON.stringify(result)).length; return result; };
      return Reflect.get(target, key);
    } });
  };
  const identities = new WeakMap<D1PreparedStatement, { sql: string; params: unknown[] }>();
  const tracked = (sql: string, params: unknown[] = []): D1PreparedStatement => { const target = wrap(sql, params); const proxy = new Proxy(target, { get(t, key) { if (key === "bind") return (...values: unknown[]) => { maxBind = Math.max(maxBind, values.length); return tracked(sql, values); }; return Reflect.get(t, key); } }); identities.set(proxy, { sql, params }); return proxy; };
  return { db: { ...base, prepare: tracked, batch: async (statements: D1PreparedStatement[]) => { physical += statements.length; statements.forEach((s) => queries.push(identities.get(s)!)); const result = await base.batch(statements); returnedBytes += new TextEncoder().encode(JSON.stringify(result)).length; return result; } } as D1Database,
    value: () => ({ physical, maxBind, returnedBytes, queries }), reset: () => { physical = 0; maxBind = 0; returnedBytes = 0; queries.length = 0; } };
}

describe("SQL lead selection and stable page hydration", () => {
  it("returns a small deterministic page without answers, capability, hash or search copies", async () => {
    const { env, lead, app, db } = await setup(); for (const id of ["a", "b", "c"]) lead(id);
    db.prepare("UPDATE leads SET answers=? WHERE id='c'").run(JSON.stringify({ large: "X".repeat(500_000) }));
    const result = await app.request("/leads?limit=2", {}, env); expect(result.status).toBe(200); const body = await result.json() as { leads: Record<string, unknown>[]; nextCursor: string };
    expect(body.leads.map((row) => row.id)).toEqual(["c", "b"]); for (const field of ["answers", "unsubscribeToken", "emailHash", "searchNameV1", "search_name_v1"]) expect(body.leads[0]).not.toHaveProperty(field);
    const second = await app.request(`/leads?limit=2&cursor=${encodeURIComponent(body.nextCursor)}`, {}, env); expect((await second.json() as { leads: { id: string }[] }).leads.map((r) => r.id)).toEqual(["a"]);
  });
  it("source conditions can match separate rows, while neq requires no matching row", async () => {
    const { orm, env, lead, source } = await setup(); lead("a"); lead("empty"); source("a", "first", "ig_bio"); source("a", "second", "threads", "foreign-g");
    expect((await leadPage(orm, env, "w", { guideId: "g", channelKey: "threads" })).rows.map((r) => r.lead.id)).toEqual(["a"]);
    const counts = await groupCounts(orm, "w", [{ id: "empty-neq", rules: { all: [{ field: "guide_id", op: "neq", value: "" }] } }, { id: "none-g", rules: { all: [{ field: "guide_id", op: "neq", value: "g" }] } }]);
    expect(counts.get("empty-neq")).toBe(2); expect(counts.get("none-g")).toBe(1);
  });
  it("rejects foreign groups/cursors and never returns foreign leads or foreign tags", async () => {
    const { env, orm, lead, db } = await setup(); lead("a"); lead("b"); lead("foreign", { workspace: "other" });
    db.exec("INSERT INTO lead_groups(id,workspace_id,name,rules,created_at) VALUES('foreign','other','Other','{\"all\":[]}',1)"); db.exec("INSERT INTO lead_tag_links VALUES('a','foreign-tag')");
    await expect(leadPage(orm, env, "w", { groupId: "foreign" })).rejects.toMatchObject({ code: "group_not_found" });
    const first = await leadPage(orm, env, "w", { limit: "1" }); expect(first.rows[0]!.facts.tagIds).toEqual([]);
    await expect(leadPage(orm, env, "other", { limit: "1", cursor: first.nextCursor! })).rejects.toMatchObject({ code: "invalid_cursor" });
    await expect(leadPage(orm, env, "w", { limit: "1", cursor: `${first.nextCursor}.extra` })).rejects.toMatchObject({ code: "invalid_cursor" });
    await expect(leadPage(orm, env, "w", { q: "a", limit: "1", cursor: first.nextCursor! })).rejects.toMatchObject({ code: "invalid_cursor" });
  });
  it("same-timestamp keysets tolerate concurrent additions/deletion without duplicate rows", async () => {
    const { env, orm, lead, db } = await setup(); for (const id of ["a", "b", "c", "d"]) lead(id); const first = await leadPage(orm, env, "w", { limit: "2" });
    lead("new", { createdAt: 100 }); db.exec("UPDATE leads SET deleted_at=1 WHERE id='b'"); const next = await leadPage(orm, env, "w", { limit: "2", cursor: first.nextCursor! });
    expect(first.rows.map((r) => r.lead.id)).toEqual(["d", "c"]); expect(next.rows.map((r) => r.lead.id)).toEqual(["a"]);
  });
  it.each(["Ä", "ΟΣ", "İ", "ß", "%_", "a\0b"])("whole-field Unicode/literal %j search agrees with JS without crossing field boundaries", async (value) => {
    const { env, orm, lead } = await setup(); lead("match", { name: value }); lead("split", { name: value.slice(0, 1), company: value.slice(1) });
    for (const q of [value, value.toLowerCase(), value.toUpperCase()]) {
      const expected = ["match", "split"].filter((id) => (id === "match" ? [value] : [value.slice(0, 1), value.slice(1)]).some((v) => v.toLowerCase().includes(q.trim().toLowerCase()))).sort().reverse();
      expect((await leadPage(orm, env, "w", { q })).rows.map((r) => r.lead.id)).toEqual(expected);
    }
  });
  it("unprepared text search is explicit, while basic lists/counts remain usable", async () => {
    const { orm, env, lead } = await setup(); lead("old", { prepared: false, name: "Ä" });
    await expect(leadPage(orm, env, "w", { q: "ä" })).rejects.toMatchObject({ code: "search_preparing" }); expect((await leadPage(orm, env, "w", {})).rows).toHaveLength(1);
    expect((await groupCounts(orm, "w", [{ id: "all", rules: { all: [] } }])).get("all")).toBe(1); await backfillLeadSearch(env); expect((await leadPage(orm, env, "w", { q: "ä" })).rows).toHaveLength(1);
  });
  it("old-writer changes invalidate folds and a change after readiness cannot return false zero", async () => {
    const { orm, env, d1, db, lead } = await setup(); lead("a", { name: "OLD" }); const batch = d1.batch.bind(d1); let once = false;
    vi.spyOn(d1, "batch").mockImplementation(async (statements) => { if (!once) { once = true; db.exec("UPDATE leads SET name='NEW' WHERE id='a'"); } return batch(statements); });
    await expect(leadPage(orm, env, "w", { q: "old" })).rejects.toMatchObject({ code: "search_preparing" }); expect(db.prepare("SELECT search_name_v1 FROM leads").all()[0]!.search_name_v1).toBeNull();
  });
  it("normal merge/rejoin writes matching folds and deletes never resurrect from backfill", async () => {
    const { orm, env, db } = await setup(); const first = await upsertLead(orm, { workspaceId: "w", email: "UP@QA.INVALID", name: "ΟΣ", company: "Ä", source: { type: "manual" } });
    await upsertLead(orm, { workspaceId: "w", email: "up@qa.invalid", name: "İ", source: { type: "form" } }); expect((await leadPage(orm, env, "w", { q: "i̇" })).rows[0]!.lead.id).toBe(first.leadId);
    db.prepare("UPDATE leads SET deleted_at=1 WHERE id=?").run(first.leadId); expect(db.prepare("SELECT search_email_v1,search_name_v1 FROM leads").all()).toEqual([{ search_email_v1: null, search_name_v1: null }]);
    await backfillLeadSearch(env); const next = await upsertLead(orm, { workspaceId: "w", email: "up@qa.invalid", name: "NEW", source: { type: "manual" } }); expect(next.leadId).not.toBe(first.leadId); expect((await leadPage(orm, env, "w", { q: "Ä" })).rows).toHaveLength(0);
  });
  it.each(["name", "company", "phone", "email", "generation", "delete"])("CAS backfill ignores %s changes between read and write", async (change) => {
    const { env, d1, db, lead } = await setup(); lead("a", { prepared: false, name: "OLD" }); const prepare = d1.prepare.bind(d1);
    vi.spyOn(d1, "prepare").mockImplementation((sql) => { if (sql.startsWith("UPDATE leads AS l SET search_email_v1")) {
      if (change === "generation") db.exec("UPDATE leads SET created_at=100 WHERE id='a'");
      else if (change === "delete") db.exec("UPDATE leads SET deleted_at=1 WHERE id='a'");
      else db.prepare(`UPDATE leads SET ${change}=? WHERE id='a'`).run(change === "email" ? "new@qa.invalid" : "NEW");
    } return prepare(sql); });
    await backfillLeadSearch(env); expect(db.prepare("SELECT search_name_v1 FROM leads").all()).toEqual([{ search_name_v1: null }]);
  });
  it("backfill failure/redelivery retains dirty rows, limits each read and continues after 100 IDs", async () => {
    const { env, orm, lead, sent, sendBatch, db } = await setup(); for (let i = 0; i < 101; i++) lead(`old-${i.toString().padStart(3, "0")}`, { prepared: false, name: "Ä" });
    sendBatch.mockRejectedValueOnce(new Error("private queue error")); await expect(backfillLeadSearch(env)).rejects.toThrow(/^lead_search_backfill_failed$/);
    expect(db.prepare("SELECT count(*) AS n FROM leads WHERE search_name_v1 IS NULL").all()).toEqual([{ n: 1 }]);
    await backfillLeadSearch(env); expect(db.prepare("SELECT count(*) AS n FROM leads WHERE search_name_v1 IS NULL").all()).toEqual([{ n: 0 }]); expect((await leadPage(orm, env, "w", { q: "ä" })).rows).toHaveLength(50); expect(sent).toHaveLength(0);
    db.exec("UPDATE leads SET name='NEW'"); await backfillLeadSearch(env); expect(sent).toHaveLength(1);
    const message = sent[0] as { body: { payload: unknown } }; await backfillLeadSearch(env, message.body.payload); expect(db.prepare("SELECT count(*) AS n FROM leads WHERE search_name_v1 IS NULL").all()).toEqual([{ n: 0 }]);
  });
  it("large legacy projections use a single bounded row with separate CAS bindings", async () => {
    const { env, d1, orm, lead } = await setup(); lead("oversize", { prepared: false, name: "Ä".repeat(40_000) }); const counted = meter(d1); env.DB = counted.db;
    await backfillLeadSearch(env); expect(counted.value().physical).toBe(3); expect(counted.value().maxBind).toBe(11);
    expect((await leadPage(orm, env, "w", { q: "ä", limit: "1" })).rows).toHaveLength(1);
  });
  it("lookup prefixes and page-selected references are bounded, complete and workspace scoped", async () => {
    const { orm, db } = await setup(); for (let i = 0; i < 110; i++) db.prepare("INSERT INTO lead_tags(id,workspace_id,name) VALUES(?,'w',?)").run(`tag-${i.toString().padStart(3, "0")}`, `Tag ${i}`);
    const first = await leadLookupPage(orm, "w", "tags", "", ["tag-109", "foreign-tag"]); expect(first.items.some((r) => r.id === "tag-109")).toBe(true); expect(first.items.some((r) => r.id === "foreign-tag")).toBe(false); expect(first.nextCursor).toBeTruthy();
    const next = await leadLookupPage(orm, "w", "tags", first.nextCursor!); expect(new Set([...first.items, ...next.items].map((r) => r.id)).size).toBe(111);
  });
  it("group consumers can page all groups and restore selected own groups beyond the first fifty", async () => {
    const { app, env, db, lead } = await setup(); lead("a");
    for (let i = 0; i < 60; i++) db.prepare("INSERT INTO lead_groups(id,workspace_id,name,rules,created_at) VALUES(?,'w',?,'{\"all\":[]}',1)").run(`g-${i.toString().padStart(2, "0")}`, `Group ${i}`);
    db.exec("INSERT INTO lead_groups(id,workspace_id,name,rules,created_at) VALUES('foreign','other','Other','{\"all\":[]}',1)");
    const first = await (await app.request("/leads/groups", {}, env)).json() as { groups: { id: string }[]; nextCursor: string }; expect(first.groups).toHaveLength(50);
    const next = await (await app.request(`/leads/groups?cursor=${encodeURIComponent(first.nextCursor)}`, {}, env)).json() as { groups: { id: string }[] }; expect(next.groups).toHaveLength(10);
    const selected = await (await app.request(`/leads/groups/selected?ids=${encodeURIComponent(JSON.stringify(["g-59", "foreign"]))}`, {}, env)).json() as { groups: { id: string; count: number }[] };
    expect(selected.groups).toMatchObject([{ id: "g-59", count: 1 }]);
  });
  it("list relationship/profile budgets reject explicitly instead of silently truncating", async () => {
    const { orm, env, db, lead } = await setup(); lead("large"); db.prepare("UPDATE leads SET first_source=?").run(JSON.stringify({ padding: "x".repeat(1_048_576) }));
    await expect(leadPage(orm, env, "w", {})).rejects.toMatchObject({ code: "lead_page_too_large" });
  });
});

describe("group/reference and HTTP audience aggregation", () => {
  it("matches JS truthiness, invalid dates, boolean coercions, empty neq and union/reason priority", async () => {
    const { orm, env, lead, source, db } = await setup(); const facts = new Map<string, LeadFacts>();
    for (let i = 0; i < 30; i++) { const id = `l${i}`; lead(id, { marketing: i % 2 === 0, alimtalk: i % 3 === 0, phone: i % 4 ? " " : "", unsubscribedAt: i % 5 ? null : 1, bouncedAt: i % 7 ? null : 1, createdAt: i }); if (i % 2) source(id); if (i % 3) db.prepare("INSERT INTO lead_tag_links VALUES(?,'tag')").run(id); facts.set(id, { marketingOptIn: i % 2 === 0, alimtalkOptIn: i % 3 === 0, createdAt: i, tagIds: i % 3 ? ["tag"] : [], sources: i % 2 ? [{ type: "form", guideId: "g", influencerId: "i", channelKey: "threads" }] : [] }); }
    const rules: GroupRules[] = [{ all: [] }, ...["", "bad", "0x10", "Infinity", "-Infinity", true, false, 20].flatMap((value) => ["eq", "neq"].map((op) => ({ all: [{ field: "created_after", op, value } as GroupCondition] }))), ...["tag_id", "guide_id", "channel_key", "marketing_opt_in", "alimtalk_opt_in"].flatMap((field) => ["", true, "true", "1", 1, "tag", "g", "threads"].map((value) => ({ all: [{ field, value, op: "neq" } as GroupCondition] })))];
    for (let at = 0; at < rules.length; at += 50) { const groups = rules.slice(at, at + 50).map((rule, i) => ({ id: `${at + i}`, rules: rule })), counts = await groupCounts(orm, "w", groups); for (const group of groups) expect(counts.get(group.id)).toBe([...facts.values()].filter((f) => evaluateGroup(group.rules, f)).length); }
    const groups = [{ id: "all", rules: { all: [] } }]; db.prepare("INSERT INTO lead_groups(id,workspace_id,name,rules,created_at) VALUES('all','w','All',?,1)").run(JSON.stringify(groups[0]!.rules));
    const selected = (await queryLeadRows(orm, await leadPlan(orm, "w", {}), true)).map((r) => r.lead);
    for (const channel of ["email", "alimtalk"] as const) for (const kind of ["info", "ad"] as const) {
      const expected = { total: selected.length, eligible: 0, reasons: {} as Record<string, number> };
      for (const row of selected) { const check = canSend(row, channel, kind, Date.now(), false); if (check.ok || check.reason === "night") expected.eligible++; else expected.reasons[check.reason] = (expected.reasons[check.reason] ?? 0) + 1; }
      expect(await countAudienceSummary(orm, "w", { groupIds: ["all", "all", "foreign"], tagIds: ["tag", "tag", "foreign-tag"] }, channel, kind)).toEqual(expected);
    }
    expect(await countAudienceSummary(orm, "w", { groupIds: ["foreign"], tagIds: ["foreign-tag"] }, "email", "info")).toMatchObject({ total: 0, eligible: 0 }); expect(env.DB).toBeTruthy();
  });
  it("20,000 leads / 50 groups × 20 rules keep results, result bytes, binds and physical statements bounded", async () => {
    const { orm, env, d1, db, lead, source } = await setup(); db.exec("BEGIN"); const facts: LeadFacts[] = [];
    for (let i = 0; i < 20_000; i++) { const id = `row-${i.toString().padStart(5, "0")}`; lead(id, { name: i % 10 ? "Person" : "ΟΣ", createdAt: i, marketing: i % 2 === 0 }); source(id); facts.push({ marketingOptIn: i % 2 === 0, alimtalkOptIn: false, createdAt: i, tagIds: [], sources: [{ type: "form", guideId: "g", influencerId: "i", channelKey: "threads" }] }); } db.exec("COMMIT");
    const groups = Array.from({ length: 50 }, (_, index) => ({ id: `group-${index}`, rules: { all: Array.from({ length: 20 }, (_, n) => ({ field: n % 4 ? "created_after" : "channel_key", op: "eq", value: n % 4 ? index * 100 + n : "threads" } as GroupCondition)) } }));
    for (const group of groups) db.prepare("INSERT INTO lead_groups(id,workspace_id,name,rules,created_at) VALUES(?,'w',?,?,1)").run(group.id, group.id, JSON.stringify(group.rules));
    const counted = meter(d1), measured = getDb(counted.db); const counts = await groupCounts(measured, "w", groups);
    for (const group of groups) expect(counts.get(group.id)).toBe(facts.filter((f) => evaluateGroup(group.rules, f)).length);
    const first = await leadPage(measured, env, "w", { q: "ος" }); expect(first.rows).toHaveLength(50); expect(first.rows.every((r) => r.lead.name === "ΟΣ")).toBe(true);
    const audience = await countAudienceSummary(measured, "w", { groupIds: groups.map((g) => g.id), tagIds: [] }, "email", "ad");
    const expectedAudience = facts.filter((f) => groups.some((g) => evaluateGroup(g.rules, f))); expect(audience).toMatchObject({ total: expectedAudience.length, eligible: expectedAudience.filter((f) => f.marketingOptIn).length });
    await boundedLeadLookups(measured, "w"); const stats = counted.value(); expect(stats.physical).toBeLessThanOrEqual(50); expect(stats.maxBind).toBeLessThanOrEqual(100); expect(stats.returnedBytes).toBeLessThan(262144);
    for (const statement of stats.queries) expect(new TextEncoder().encode(statement.sql).length).toBeLessThan(100000);
    const pageStatement = stats.queries.find((q) => q.sql.includes(",page AS("))!;
    expect(db.prepare(`EXPLAIN QUERY PLAN ${pageStatement.sql}`).all(...pageStatement.params as (string | number | null)[]).some((r) => String(r.detail).includes("leads_live_seek_idx"))).toBe(true);
    expect(JSON.stringify(first)).not.toMatch(/unsubscribeToken|answers|search_name/); expect(orm).toBeTruthy();
    // D1's production expression-depth limit is lower than Node SQLite's
    // default. Replay the real captured SQL against the same synthetic data.
    const fs = await import("node:fs" as string) as { readdirSync(path: string): string[]; readFileSync(path: string, encoding: string): string };
    const child = await import("node:child_process" as string) as { spawnSync(command: string, args: string[], options: Record<string, unknown>): { status: number; stdout: string; stderr: string } };
    const tables = Object.fromEntries(["workspaces", "guides", "influencers", "lead_tags", "leads", "lead_sources", "lead_groups", "link_channels"].map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
    const replay = child.spawnSync("python3", ["-c", `import sys,json,sqlite3
data=json.load(sys.stdin); db=sqlite3.connect(':memory:')
for ddl in data['migrations']: db.executescript(ddl)
for table,rows in data['tables'].items():
 if rows:
  columns=list(rows[0]); db.executemany('INSERT INTO '+table+'('+','.join(columns)+') VALUES('+','.join('?' for _ in columns)+')',[[row[c] for c in columns] for row in rows])
db.setlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH,100); db.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH,100000)
db.setlimit(sqlite3.SQLITE_LIMIT_COMPOUND_SELECT,5); db.setlimit(sqlite3.SQLITE_LIMIT_COLUMN,100); db.setlimit(sqlite3.SQLITE_LIMIT_FUNCTION_ARG,32)
for query in data['queries']:
 sql=query['sql']; db.execute(('EXPLAIN ' if sql.lstrip().upper().startswith('INSERT') else '')+sql,query['params']).fetchall()
print(json.dumps({'checked':len(data['queries']),'depth':100,'sqlLength':100000,'compoundSelect':5,'columns':100,'functionArgs':32}))`], { input: JSON.stringify({ migrations: fs.readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort().map((f) => fs.readFileSync(`migrations/${f}`, "utf8")), tables, queries: stats.queries }), encoding: "utf8", timeout: 30000 });
    expect(replay.stderr).toBe(""); expect(replay.status).toBe(0); expect(JSON.parse(replay.stdout)).toMatchObject({ checked: stats.queries.length, depth: 100, compoundSelect: 5, columns: 100, functionArgs: 32 });
    console.info("[lead_query_budget]", JSON.stringify({ leads: 20000, groups: 50, rulesPerGroup: 20, physical: stats.physical, maxBind: stats.maxBind, resultBytes: stats.returnedBytes, maxSqlBytes: Math.max(...stats.queries.map((q) => new TextEncoder().encode(q.sql).length)), expressionDepthLimit: 100 }));
  }, 30000);
});
