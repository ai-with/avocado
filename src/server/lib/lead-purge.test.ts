import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { getDb } from "../db";
import type { AppEnv } from "../types";
import { DEFAULT_GATE } from "../../shared/leads";
import { publicDocRoutes } from "../routes/public-lead/docs";
import { publicFormRoutes } from "../routes/public-lead/forms";
import { applyIdentify, type IdentifyJob } from "./collect/people";
import { upsertLead } from "./leads";
import { IP_HASH_RETENTION_MS, LEAD_RETENTION_MS, purgeDeletedLeads } from "./lead-purge";
import { sha256Hex } from "./ids";
import { createSqliteD1, type TestSqlite } from "../test/sqlite-d1";

type Sqlite = TestSqlite;
const databases: Sqlite[] = [];
const NOW = Date.parse("2026-10-31T08:00:00Z");
const HASH = "a".repeat(64);
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NOW); });
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.restoreAllMocks(); });

async function setup() {
  const { db, d1 } = await createSqliteD1();
  databases.push(db);
  const env = { DB: d1, APP_URL: "https://app.test", APP_ENV: "production", TOKEN_ENC_KEY: "test-key" } as Env;
  const orm = getDb(d1);
  db.exec("INSERT INTO workspaces (id, name, created_at) VALUES ('w', 'team', 1), ('other', 'other-team', 1)");
  db.prepare("INSERT INTO documents (id, workspace_id, title, file_key, pages, size_mb, gate, source_type, content_html, created_at) VALUES ('doc', 'w', 'doc', '', 1, 0, ?, 'editor', '<p>Body</p>', 1)").run(JSON.stringify({ ...DEFAULT_GATE, fields: { name: false, company: false, phone: false }, questions: [], requireVerify: false }));
  db.exec("INSERT INTO forms (id, workspace_id, title, fields, after_submit, created_at) VALUES ('form', 'w', 'form', '{\"base\":[],\"questions\":[]}', '{\"type\":\"document\",\"documentId\":\"doc\",\"text\":\"done\"}', 1)");
  db.exec("INSERT INTO short_links (id, workspace_id, channel_key, slug, destination_type, destination_id, utm, og, created_at) VALUES ('link', 'w', 'doc', 'doc-slug', 'document', 'doc', '{}', '{}', 1), ('form-link', 'w', 'form', 'form-slug', 'form', 'form', '{}', '{}', 1)");
  db.exec("INSERT INTO sites (id, workspace_id, site_key, name, allowed_domains, collect_raw_email, created_at) VALUES ('site', 'w', 'site-key', 'site', '[]', 1, 1), ('other-site', 'other', 'other-site-key', 'other-site', '[]', 1, 1)");
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("db", orm); c.set("auth", null); await next(); });
  app.route("/api/public", publicDocRoutes);
  app.route("/api/public", publicFormRoutes);
  app.onError((error, c) => c.text(String(error), 500));
  const call = (url: string, body?: unknown) => app.request(url, body ? { method: "POST", headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0", cookie: "lv=current-browser" }, body: JSON.stringify(body) } : { headers: { "user-agent": "Mozilla/5.0", cookie: "lv=current-browser" } }, env);
  return { db, d1, orm, env, call };
}

function lead(db: Sqlite, id: string, options: { deletedAt?: number | null; email?: string; workspace?: string; hash?: string } = {}) {
  db.prepare("INSERT INTO leads (id, workspace_id, email, name, phone, answers, unsubscribe_token, first_source, last_source, email_hash, created_at, deleted_at) VALUES (?, ?, ?, 'OLD-NAME', 'OLD-PHONE', '{\"old\":\"OLD-ANSWER\"}', ?, '{}', '{}', ?, 1, ?)")
    .run(id, options.workspace ?? "w", options.email ?? `${id}@example.com`, `unsubscribe-${id}`, options.hash ?? HASH, options.deletedAt === undefined ? NOW - LEAD_RETENTION_MS : options.deletedAt);
}
function view(db: Sqlite, id: string, leadId: string) {
  db.prepare("INSERT INTO document_views (id, document_id, link_id, session_id, lead_id, started_at, last_seen_at, is_member) VALUES (?, 'doc', 'link', 'current-browser', ?, 1, 2, 0)").run(id, leadId);
  db.prepare("INSERT INTO document_page_views (view_id, page, dwell_ms) VALUES (?, 1, 999)").run(id);
}
function oldData(db: Sqlite, leadId: string) {
  view(db, `view-${leadId}`, leadId);
  db.prepare("INSERT INTO form_submissions (id, form_id, lead_id, answers, at) VALUES (?, 'form', ?, '{\"private\":\"OLD-PII\"}', 1)").run(`submission-${leadId}`, leadId);
  db.prepare("INSERT INTO doc_verify_tokens (token_hash, document_id, view_id, lead_id, expires_at, created_at) VALUES (?, 'doc', ?, ?, ?, 1)").run(`verify-${leadId}`, `view-${leadId}`, leadId, NOW + 1000);
  db.exec("INSERT OR IGNORE INTO automations (id, workspace_id, name, trigger, target, delay_minutes, channel, kind, template, created_at, updated_at) VALUES ('auto', 'w', 'auto', 'form_submitted', '{}', 0, 'email', 'info', '{}', 1, 1)");
  db.prepare("INSERT INTO automation_runs (id, automation_id, lead_id, ref_id, due_at, status, created_at) VALUES (?, 'auto', ?, 'ref', 0, 'pending', 1)").run(`run-${leadId}`, leadId);
  db.prepare("INSERT INTO message_logs (id, workspace_id, lead_id, source, source_id, channel, status, recipient_email, at) VALUES (?, 'w', ?, 'automation', 'auto', 'email', 'sent', 'OLD-EMAIL', 1)").run(`message-${leadId}`, leadId);
  db.prepare("INSERT INTO lead_sources (id, lead_id, type, at) VALUES (?, ?, 'manual', 1)").run(`source-${leadId}`, leadId);
  db.exec("INSERT OR IGNORE INTO lead_tags (id, workspace_id, name) VALUES ('tag', 'w', 'tag')");
  db.prepare("INSERT INTO lead_tag_links (lead_id, tag_id) VALUES (?, 'tag')").run(leadId);
  db.prepare("INSERT INTO site_people (id, site_id, anon_ids, external_id, email_hash, lead_id, created_at) VALUES (?, 'site', ?, 'OLD-EXTERNAL', ?, ?, 1)").run(`person-${leadId}`, JSON.stringify([`anon-${leadId}`]), HASH, leadId);
  db.prepare("INSERT INTO site_sessions (site_id, id, anon_id, person_id, first_at, last_at) VALUES ('site', ?, ?, ?, 1, 2), ('site', ?, ?, NULL, 1, 2)").run(`session-${leadId}`, `anon-${leadId}`, `person-${leadId}`, `anonymous-${leadId}`, `anon-${leadId}`);
  db.prepare("INSERT INTO site_conversions (id, site_id, session_id, person_id, kind, currency, order_id, at) VALUES (?, 'site', ?, ?, 'purchase', 'KRW', 'OLD-ORDER', 1), (?, 'site', ?, NULL, 'custom', 'KRW', 'OLD-ORDER-2', 1)").run(`conversion-${leadId}`, `session-${leadId}`, `person-${leadId}`, `anonymous-conversion-${leadId}`, `anonymous-${leadId}`);
}
const n = (db: Sqlite, table: string) => Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).all()[0]!.n);
const controller = { scheduledTime: NOW } as ScheduledController;

describe("리드·클릭 개인정보 보존 기한", () => {
  it("기한 리드의 자식 PII·SDK 원시 연결을 파기하고 살아있는 다른 사용자와 집계는 보존한다", async () => {
    const { db, env } = await setup();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    lead(db, "dead"); oldData(db, "dead");
    lead(db, "lookahead", { deletedAt: NOW - LEAD_RETENTION_MS + 15 * 60_000, hash: "b".repeat(64) });
    lead(db, "young", { deletedAt: NOW - LEAD_RETENTION_MS + 15 * 60_000 + 1, hash: "c".repeat(64) });
    lead(db, "alive", { deletedAt: null, hash: "d".repeat(64) });
    lead(db, "other-lead", { workspace: "other", deletedAt: null, hash: HASH });
    db.prepare("INSERT INTO site_people (id, site_id, anon_ids, email_hash, created_at) VALUES ('hash-only-old', 'site', '[]', ?, 1), ('other-person', 'other-site', '[]', ?, 1)").run(HASH, HASH);
    db.exec("INSERT INTO site_daily_stats (site_id, day, sessions, conversions) VALUES ('site', '2026-10-01', 9, 2)");
    db.prepare("INSERT INTO link_clicks (id, link_id, at, device, ip_hash, is_bot, is_member) VALUES ('old', 'link', ?, 'desktop', 'OLD-IP', 0, 0), ('recent', 'link', ?, 'desktop', 'NEW-IP', 0, 0)").run(NOW - IP_HASH_RETENTION_MS, NOW - IP_HASH_RETENTION_MS + 1);
    await purgeDeletedLeads(env, controller);
    expect(db.prepare("SELECT id FROM leads ORDER BY id").all().map((row) => row.id)).toEqual(["alive", "other-lead", "young"]);
    for (const table of ["form_submissions", "doc_verify_tokens", "document_page_views", "document_views", "automation_runs", "message_logs", "lead_sources", "lead_tag_links", "site_sessions", "site_conversions"]) expect(n(db, table)).toBe(0);
    expect(db.prepare("SELECT id FROM site_people").all()).toEqual([{ id: "other-person" }]);
    expect(n(db, "site_daily_stats")).toBe(1);
    expect(db.prepare("SELECT id, ip_hash FROM link_clicks ORDER BY id").all()).toEqual([{ id: "old", ip_hash: null }, { id: "recent", ip_hash: "NEW-IP" }]);
    const props = JSON.parse(String(db.prepare("SELECT props FROM events WHERE name='lead_privacy_cleanup_completed'").all()[0]!.props));
    expect(props).toMatchObject({ overdue_before: 1, overdue_remaining: 0, failures: 0, deleted: { leads: 2, site_people: 2, site_sessions: 2, site_conversions: 2, ip_hashes: 1 } });
    expect(JSON.stringify(props)).not.toMatch(/OLD-|example.com|person-dead|anon-dead/);
    await purgeDeletedLeads(env, controller);
    expect(log).toHaveBeenCalledTimes(2);
    expect(n(db, "leads")).toBe(3);
  });

  it("중간 삭제 실패는 앞선 삭제도 롤백하고 성공 이력을 남기지 않는다", async () => {
    const { db, env } = await setup();
    lead(db, "dead"); oldData(db, "dead");
    db.exec("CREATE TRIGGER fail_purge BEFORE DELETE ON lead_sources BEGIN SELECT RAISE(ABORT, 'failure'); END");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(purgeDeletedLeads(env, controller)).rejects.toThrow();
    expect(n(db, "leads")).toBe(1); expect(n(db, "form_submissions")).toBe(1); expect(n(db, "site_people")).toBe(1);
    expect(n(db, "events")).toBe(0);
    expect(error).toHaveBeenCalledWith("[lead_privacy_cleanup_failed]", expect.stringContaining('"failures":1'));
  });

  it("해시가 비어 있던 과거 리드의 해시 식별과 원시 세션도 파기한다", async () => {
    const { db, env } = await setup();
    lead(db, "legacy", { email: "legacy@example.com" });
    db.exec("UPDATE leads SET email_hash=NULL WHERE id='legacy'");
    db.prepare("INSERT INTO site_people (id, site_id, anon_ids, email_hash, created_at) VALUES ('legacy-person', 'site', '[\"legacy-anon\"]', ?, 1)").run(await sha256Hex("legacy@example.com"));
    db.exec("INSERT INTO site_sessions (site_id, id, anon_id, first_at, last_at) VALUES ('site', 'legacy-session', 'legacy-anon', 1, 2)");
    vi.spyOn(console, "log").mockImplementation(() => {});
    await purgeDeletedLeads(env, controller);
    expect(n(db, "leads")).toBe(0); expect(n(db, "site_people")).toBe(0); expect(n(db, "site_sessions")).toBe(0);
  });

  it("선별 뒤 복구된 세대는 파기 스냅샷이 일치하지 않아 삭제하지 않는다", async () => {
    const { db, d1, env } = await setup(); lead(db, "dead"); oldData(db, "dead");
    const batch = d1.batch.bind(d1);
    vi.spyOn(d1, "batch").mockImplementation(async (statements) => {
      db.prepare("UPDATE leads SET deleted_at=NULL, created_at=?, name='NEW' WHERE id='dead'").run(NOW);
      return batch(statements);
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    await purgeDeletedLeads(env, controller);
    expect(db.prepare("SELECT name, created_at FROM leads").all()).toEqual([{ name: "NEW", created_at: NOW }]);
    expect(n(db, "form_submissions")).toBe(1); expect(n(db, "site_people")).toBe(1);
  });
});

describe("삭제 후 새 등록", () => {
  it("새 ID·프로필·수신거부 토큰을 만들고 옛 발송/태그/SDK 연결은 되살리지 않는다", async () => {
    const { db, orm } = await setup(); lead(db, "dead", { email: "same@example.com" }); oldData(db, "dead");
    const result = await upsertLead(orm, { workspaceId: "w", email: "same@example.com", name: "NEW-NAME", source: { type: "manual" } });
    expect(result.created).toBe(true); expect(result.leadId).not.toBe("dead");
    const row = db.prepare("SELECT id, name, phone, answers, created_at, deleted_at, unsubscribe_token FROM leads").all()[0]!;
    expect(row).toMatchObject({ id: result.leadId, name: "NEW-NAME", phone: null, answers: "{}", created_at: NOW, deleted_at: null });
    expect(row.unsubscribe_token).not.toBe("unsubscribe-dead");
    for (const table of ["automation_runs", "message_logs", "lead_tag_links", "site_people", "site_sessions", "site_conversions", "document_views", "form_submissions"]) expect(n(db, table)).toBe(0);
    expect(n(db, "lead_sources")).toBe(1);
  });

  it("현재 게이트 view는 원자적으로 새 리드에 붙여 같은 v로 다시 열 수 있다", async () => {
    const { db, call } = await setup(); lead(db, "dead", { email: "same@example.com" }); oldData(db, "dead"); view(db, "current-view", "dead");
    const response = await call("/api/public/doc/doc-slug/gate", { viewToken: "current-view", email: "same@example.com", name: "NEW", privacyAgreed: true });
    expect(response.status).toBe(200);
    const body = await response.json() as { status: string; unlockToken: string };
    expect(body.status).toBe("passed");
    const current = db.prepare("SELECT lead_id FROM document_views WHERE id='current-view'").all()[0]!.lead_id;
    expect(current).not.toBe("dead"); expect(n(db, "leads")).toBe(1); expect(n(db, "document_views")).toBe(1);
    expect((await call(`/api/public/doc/doc-slug?v=current-view&t=${body.unlockToken}`)).status).toBe(200);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("공개 폼 재신청은 새 리드 ID로 답변·자료 예약을 남기고 그 자료를 열 수 있다", async () => {
    const { db, call } = await setup(); lead(db, "dead", { email: "same@example.com" }); oldData(db, "dead");
    const response = await call("/api/public/form/form-slug/submit", { email: "same@example.com", name: "FORM-NEW", privacyAgreed: true });
    expect(response.status).toBe(200);
    const body = await response.json() as { url: string };
    expect(body.url).toContain("/d/form-slug?v=");
    const newId = db.prepare("SELECT id FROM leads").all()[0]!.id;
    expect(newId).not.toBe("dead");
    expect(db.prepare("SELECT lead_id FROM form_submissions").all()).toEqual([{ lead_id: newId }]);
    const v = new URL(body.url, "https://app.test").searchParams.get("v");
    expect((await call(`/api/public/doc/form-slug?v=${v}`)).status).toBe(200);
  });

  it("새 리드 INSERT 실패는 옛 리드와 그 자식까지 복구해 반쪽 파기를 남기지 않는다", async () => {
    const { db, orm } = await setup(); lead(db, "dead", { email: "same@example.com" }); oldData(db, "dead");
    db.exec("CREATE TRIGGER fail_new BEFORE INSERT ON leads WHEN NEW.id <> 'dead' BEGIN SELECT RAISE(ABORT, 'failure'); END");
    await expect(upsertLead(orm, { workspaceId: "w", email: "same@example.com", source: { type: "manual" } })).rejects.toThrow();
    expect(db.prepare("SELECT id FROM leads").all()).toEqual([{ id: "dead" }]);
    expect(n(db, "form_submissions")).toBe(1); expect(n(db, "document_views")).toBe(1); expect(n(db, "automation_runs")).toBe(1);
  });
});

describe("삭제한 SDK 식별의 재연결 차단", () => {
  const job = (over: Partial<IdentifyJob> = {}): IdentifyJob => ({ site: { id: "site", workspaceId: "w", collectRawEmail: true }, anonId: "current-anon", sessionId: "current-session", linkId: null, receivedAt: NOW, event: { id: "event", t: "identify", ts: NOW, url: "https://shop.test", ref: null, email: "same@example.com", externalId: "OLD-EXTERNAL" }, ...over });
  const session = (db: Sqlite) => db.exec("INSERT INTO site_sessions (site_id, id, anon_id, first_at, last_at) VALUES ('site', 'current-session', 'current-anon', 1, 2)");

  it("살아있는 사이트의 현재 원문 identify는 새 리드·출처·세션 연결을 만든다", async () => {
    const { db, env } = await setup(); session(db);
    await applyIdentify(env, job({ event: { ...job().event, name: "CURRENT" } }));
    const row = db.prepare("SELECT id, email, name, created_at FROM leads").all()[0]!;
    expect(row).toMatchObject({ email: "same@example.com", name: "CURRENT", created_at: NOW });
    expect(db.prepare("SELECT lead_id FROM lead_sources").all()).toEqual([{ lead_id: row.id }]);
    const person = db.prepare("SELECT id, lead_id FROM site_people").all()[0]!;
    expect(person.lead_id).toBe(row.id);
    expect(db.prepare("SELECT person_id FROM site_sessions").all()).toEqual([{ person_id: person.id }]);
  });

  it("SDK 원문 identify는 삭제 대기 리드를 복구하지 않고, 옛 식별만으로 새 등록에 잇지 않는다", async () => {
    const { db, orm, env } = await setup(); lead(db, "dead", { email: "same@example.com", hash: await sha256Hex("same@example.com") }); oldData(db, "dead"); session(db);
    await applyIdentify(env, job());
    expect(db.prepare("SELECT deleted_at FROM leads WHERE id='dead'").all()[0]!.deleted_at).not.toBeNull();
    expect(n(db, "lead_sources")).toBe(1);
    const fresh = await upsertLead(orm, { workspaceId: "w", email: "same@example.com", source: { type: "manual" } });
    session(db);
    await applyIdentify(env, job({ event: { id: "new", t: "identify", ts: NOW, url: "https://shop.test", ref: null, externalId: "OLD-EXTERNAL" } }));
    expect(db.prepare("SELECT lead_id FROM site_people").all()).toEqual([{ lead_id: null }]);
    expect(db.prepare("SELECT lead_id FROM lead_sources").all()).toEqual([{ lead_id: fresh.leadId }]);
  });

  it("오래된 Queue와 삭제된 세션은 원문 리드를 다시 만들지 않는다", async () => {
    const { db, env } = await setup();
    await applyIdentify(env, job()); expect(n(db, "leads")).toBe(0);
    session(db);
    await applyIdentify(env, job({ receivedAt: NOW - 25 * 60 * 60_000 })); expect(n(db, "leads")).toBe(0);
  });

  it("사이트 조회 뒤 삭제가 끼어들어도 SQL 실행 시점 검사로 리드·출처·사람을 만들지 않는다", async () => {
    const { db, d1, env } = await setup(); session(db);
    const batch = d1.batch.bind(d1);
    vi.spyOn(d1, "batch").mockImplementation(async (statements) => { db.exec(`UPDATE sites SET deleted_at=${NOW} WHERE id='site'`); return batch(statements); });
    await applyIdentify(env, job());
    expect(n(db, "leads")).toBe(0); expect(n(db, "lead_sources")).toBe(0); expect(n(db, "site_people")).toBe(0);
    expect(db.prepare("SELECT person_id FROM site_sessions").all()).toEqual([{ person_id: null }]);
  });

  it("조회 뒤 원문 수집을 끄면 원문 리드를 만들지 않고 해시만 남긴다", async () => {
    const { db, d1, env } = await setup(); session(db);
    const batch = d1.batch.bind(d1);
    vi.spyOn(d1, "batch").mockImplementation(async (statements) => { db.exec("UPDATE sites SET collect_raw_email=0 WHERE id='site'"); return batch(statements); });
    await applyIdentify(env, job());
    expect(n(db, "leads")).toBe(0);
    expect(db.prepare("SELECT email_hash, lead_id FROM site_people").all()).toEqual([{ email_hash: await sha256Hex("same@example.com"), lead_id: null }]);
  });

  it("이전 세대에서 수신된 identify는 새 등록의 프로필·출처·리드 연결을 바꾸지 않는다", async () => {
    const { db, env } = await setup(); session(db);
    lead(db, "fresh", { email: "same@example.com", deletedAt: null, hash: await sha256Hex("same@example.com") });
    db.prepare("UPDATE leads SET created_at=?, name='NEW-PROFILE' WHERE id='fresh'").run(NOW);
    await applyIdentify(env, job({ receivedAt: NOW - 1000, event: { ...job().event, name: "OLD-PROFILE" } }));
    expect(db.prepare("SELECT name FROM leads").all()).toEqual([{ name: "NEW-PROFILE" }]);
    expect(n(db, "lead_sources")).toBe(0);
    expect(db.prepare("SELECT lead_id FROM site_people").all()).toEqual([{ lead_id: null }]);
  });
});
