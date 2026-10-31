import { afterEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1, type TestSqlite } from "../test/sqlite-d1";
import { purgeDeletedSites } from "./site-purge";
import { insertConversion, insertEventIds, markFirstEvent, upsertDaily, upsertSession } from "./collect/statements";
import { getDb } from "../db";
import { users, workspaces } from "../db/schema";

const NOW = Date.parse("2026-10-31T06:00:00Z");
const CUTOFF = NOW - 30 * 24 * 60 * 60 * 1000;
const closeAll: (() => void)[] = [];
const controller = { scheduledTime: NOW } as ScheduledController;
afterEach(() => { for (const close of closeAll.splice(0)) close(); vi.restoreAllMocks(); });

async function setup() {
  const result = await createSqliteD1();
  closeAll.push(result.close);
  result.db.exec("INSERT INTO workspaces(id,name,created_at) VALUES('w1','one',1),('w2','two',1)");
  return result;
}
function site(db: TestSqlite, id: string, deletedAt: number | null = null, workspace = "w1") {
  db.prepare("INSERT INTO sites(id,workspace_id,site_key,name,allowed_domains,created_at,deleted_at) VALUES(?,?,?,?,'[]',1,?)").run(id, workspace, `key-${id}`, id, deletedAt);
}
function children(db: TestSqlite, id: string) {
  db.prepare("INSERT INTO site_sessions(site_id,id,anon_id,first_at,last_at) VALUES(?,?,'anon',1,1)").run(id, `session-${id}`);
  db.prepare("INSERT INTO site_conversions(id,site_id,session_id,kind,currency,at) VALUES(?,?,?,'purchase','KRW',1)").run(`conv-${id}`, id, `session-${id}`);
  db.prepare("INSERT INTO site_people(id,site_id,anon_ids,external_id,email_hash,created_at) VALUES(?,?,'[\"anon\"]','private-id','private-hash',1)").run(`person-${id}`, id);
  db.prepare("INSERT INTO site_daily_stats(site_id,day) VALUES(?,'2026-10-01')").run(id);
  db.prepare("INSERT INTO site_event_ids(site_id,id,at) VALUES(?,'event',1)").run(id);
}
const count = (db: TestSqlite, table: string, id: string) => db.prepare(`SELECT count(*) AS n FROM ${table} WHERE site_id = ?`).all(id)[0]?.n;

describe("사이트 개인정보 파기", () => {
  it("30일 경계가 된 사이트와 SDK 자식 전체를 지우고 다른 사이트는 보존한다", async () => {
    const { db, d1 } = await setup();
    vi.spyOn(console, "log").mockImplementation(() => {});
    for (const id of ["due", "future", "active", "other"]) { site(db, id, null, id === "other" ? "w2" : "w1"); children(db, id); }
    db.prepare("UPDATE sites SET deleted_at = ? WHERE id = 'due'").run(CUTOFF);
    db.prepare("UPDATE sites SET deleted_at = ? WHERE id = 'future'").run(CUTOFF + 1);
    await purgeDeletedSites({ DB: d1 } as Env, controller);
    expect(db.prepare("SELECT count(*) AS n FROM sites WHERE id = 'due'").all()[0]?.n).toBe(0);
    for (const table of ["site_sessions", "site_conversions", "site_people", "site_daily_stats", "site_event_ids"]) {
      expect(count(db, table, "due")).toBe(0);
      for (const id of ["future", "active", "other"]) expect(count(db, table, id)).toBe(1);
    }
    const record = db.prepare("SELECT props FROM events WHERE name='site_privacy_cleanup_completed'").all()[0];
    expect(JSON.parse(String(record?.props))).toMatchObject({ sites_deleted: 1, event_ids_deleted: 1, overdue_remaining: 0, failures: 0, analytics_engine: "provider_retention_unresolved" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    await purgeDeletedSites({ DB: d1 } as Env, controller);
    expect(db.prepare("SELECT count(*) AS n FROM sites").all()[0]?.n).toBe(3);
  });

  it("사이트 삭제 실패는 event id 삭제까지 롤백하며 성공 이력을 남기지 않는다", async () => {
    const { db, d1 } = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    site(db, "due"); children(db, "due");
    db.prepare("UPDATE sites SET deleted_at=? WHERE id='due'").run(CUTOFF);
    db.exec("CREATE TRIGGER fail_site_delete BEFORE DELETE ON sites BEGIN SELECT RAISE(ABORT,'test'); END");
    await expect(purgeDeletedSites({ DB: d1 } as Env, controller)).rejects.toThrow();
    expect(count(db, "site_event_ids", "due")).toBe(1);
    expect(db.prepare("SELECT count(*) AS n FROM events WHERE name='site_privacy_cleanup_completed'").all()[0]?.n).toBe(0);
    db.exec("DROP TRIGGER fail_site_delete");
    vi.spyOn(console, "log").mockImplementation(() => {});
    await purgeDeletedSites({ DB: d1 } as Env, controller);
    expect(count(db, "site_event_ids", "due")).toBe(0);
  });

  it("배치 상한 때문에 남은 기한 초과 사이트 수를 숨기지 않는다", async () => {
    const { db, d1 } = await setup();
    vi.spyOn(console, "log").mockImplementation(() => {});
    for (let i = 0; i < 101; i++) site(db, `s${i}`, CUTOFF);
    await purgeDeletedSites({ DB: d1 } as Env, controller);
    const props = JSON.parse(String(db.prepare("SELECT props FROM events WHERE name='site_privacy_cleanup_completed'").all()[0]?.props));
    expect(props).toMatchObject({ sites_deleted: 100, overdue_before: 101, overdue_remaining: 1 });
    await purgeDeletedSites({ DB: d1 } as Env, controller);
    expect(db.prepare("SELECT count(*) AS n FROM sites").all()[0]?.n).toBe(0);
  });

  it.each(["soft", "hard"])("%s 삭제 뒤 이미 준비된 SDK SQL도 새 개인정보나 집계를 쓰지 못한다", async (kind) => {
    const { db, d1 } = await setup();
    site(db, "s"); children(db, "s");
    const session = upsertSession(d1, { siteId: "s", sessionId: "late", anonId: "old-anon" }, { firstAt: 1, lastAt: 2, pageviews: 1, maxScroll: 0, visibleMs: 0, clicks: 0, conversions: [], identifies: [] }, { attr: { linkId: null, clickToken: null, match: "none", isMember: false }, isMember: false, country: null, device: "other" });
    const conversion = insertConversion(d1, { siteId: "s", sessionId: "late", anonId: "old-anon" }, null, { id: "event-conv", t: "conversion", ts: 1, url: "https://shop.example.com", ref: null, kind: "signup" }, "KRW", 1);
    const stats = upsertDaily(d1, "s", "late", null, { sessions: 1, pageviews: 1, scroll: [], conversions: 0, conversionValue: 0, membersExcluded: 0 });
    db.prepare("UPDATE sites SET deleted_at=? WHERE id='s'").run(CUTOFF);
    if (kind === "hard") {
      vi.spyOn(console, "log").mockImplementation(() => {});
      await purgeDeletedSites({ DB: d1 } as Env, controller);
    }
    await d1.batch([session, conversion, stats, insertEventIds(d1, "s", ["late"], NOW), markFirstEvent(d1, "s", NOW),
      d1.prepare("INSERT INTO site_people(id,site_id,anon_ids,email_hash,created_at) VALUES('late','s','[]','stale-hash',1)"),
      d1.prepare("UPDATE site_people SET email_hash='changed' WHERE site_id='s'"),
      d1.prepare("UPDATE site_sessions SET person_id='changed' WHERE site_id='s'"),
      d1.prepare("UPDATE site_conversions SET person_id='changed' WHERE site_id='s'")]);
    expect(db.prepare("SELECT count(*) AS n FROM site_event_ids WHERE id='late'").all()[0]?.n).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM site_sessions WHERE id='late'").all()[0]?.n).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM site_people WHERE email_hash IN ('changed','stale-hash')").all()[0]?.n).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM site_daily_stats WHERE day='late'").all()[0]?.n).toBe(0);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("공통 SQLite 어댑터는 ORM 조인의 중복 열도 순서대로 돌려준다", async () => {
    const { db, d1 } = await setup();
    db.exec("INSERT INTO users(id,email,password_hash,name,created_at) VALUES('u1','u@example.com','','person',1)");
    const row = await getDb(d1).select({ user: users, workspace: workspaces }).from(users).innerJoin(workspaces, undefined).get();
    expect(row?.user.id).toBe("u1");
    expect(row?.workspace.id).toBe("w1");
  });
});
