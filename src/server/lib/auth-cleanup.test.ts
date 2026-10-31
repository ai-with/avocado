import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupAuthRecords } from "./auth-cleanup";

type Value = string | number | null;
type Row = Record<string, Value>;
type Sqlite = {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): { run(...params: Value[]): { changes: number }; all(...params: Value[]): Row[] };
};

const scheduledAt = Date.parse("2026-10-30T18:00:00Z");
const cutoff = scheduledAt - 24 * 60 * 60 * 1000;
const controller = (time = scheduledAt) => ({ scheduledTime: time } as ScheduledController);
const databases: Sqlite[] = [];

async function setup() {
  const sqlite = (await import("node:sqlite" as string)) as { DatabaseSync: new (path: string) => Sqlite };
  const fs = (await import("node:fs" as string)) as { readdirSync(path: string): string[]; readFileSync(path: string, encoding: string): string };
  const db = new sqlite.DatabaseSync(":memory:");
  databases.push(db);
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of fs.readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort()) db.exec(fs.readFileSync(`migrations/${file}`, "utf8"));

  const prepare = (sql: string, params: Value[] = []): unknown => ({
    bind: (...values: Value[]) => prepare(sql, values),
    run: async () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...params).changes) } }),
  });
  const d1 = {
    prepare,
    batch: async (statements: { run(): Promise<unknown> }[]) => {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
  return { db, env: { DB: d1 } as Env };
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.restoreAllMocks();
});

describe("인증 기록 정리", () => {
  it.each(["2026-10-30T17:45:00Z", "2026-10-30T18:15:00Z", "2026-10-31T03:00:00Z"])("%s에는 정리나 완료 기록을 쓰지 않는다", async (time) => {
    const batch = vi.fn();
    await cleanupAuthRecords({ DB: { batch } } as unknown as Env, controller(Date.parse(time)));
    expect(batch).not.toHaveBeenCalled();
  });

  it("03:00 KST에 하루 경계와 유효한 재설정 토큰을 보존하고 실제 삭제 건수를 기록한다", async () => {
    const { db, env } = await setup();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    db.prepare("INSERT INTO users (id, email, password_hash, name, created_at) VALUES ('u', 'test@example.com', '', 'test', ?)").run(cutoff);
    for (const [id, created] of [["old", cutoff - 1], ["boundary", cutoff], ["new", scheduledAt]] as const) {
      db.prepare("INSERT INTO auth_attempts (id, key, created_at) VALUES (?, 'login:test@example.com', ?)").run(id, created);
      db.prepare("INSERT INTO phone_verifications (id, user_id, phone_e164, code_hash, purpose, expires_at, ip, created_at) VALUES (?, 'u', '+821000000001', 'hash', 'signup', ?, 'test-ip', ?)").run(id, created + 1000, created);
      db.prepare("INSERT INTO oauth_states (state, nonce, code_verifier, redirect_next, created_at) VALUES (?, 'nonce', 'verifier', '/', ?)").run(id, created);
      db.prepare("INSERT INTO password_resets (id, user_id, expires_at, created_at) VALUES (?, 'u', ?, ?)").run(id, created, cutoff - 1000);
    }
    await cleanupAuthRecords(env, controller());
    for (const table of ["auth_attempts", "phone_verifications", "oauth_states", "password_resets"]) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).all()[0]?.n).toBe(2);
    }
    const records = db.prepare("SELECT workspace_id, name, props FROM events").all();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ workspace_id: null, name: "auth_cleanup_completed" });
    const props = JSON.parse(records[0]?.props as string);
    expect(props).toEqual({ scheduled_at: scheduledAt, cutoff, deleted: { auth_attempts: 1, phone_verifications: 1, oauth_states: 1, password_resets: 1 } });
    expect(log).toHaveBeenCalledWith("[auth_cleanup_completed]", JSON.stringify(props));
    expect(JSON.stringify(props)).not.toMatch(/test@example|test-ip|nonce|verifier|hash/);
  });

  it("정리 배치가 실패하면 삭제를 롤백하고 성공 이력을 남기지 않는다", async () => {
    const { db, env } = await setup();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    db.prepare("INSERT INTO auth_attempts (id, key, created_at) VALUES ('old', 'test', ?)").run(cutoff - 1);
    db.exec("DROP TABLE phone_verifications");
    await expect(cleanupAuthRecords(env, controller())).rejects.toThrow();
    expect(db.prepare("SELECT COUNT(*) AS n FROM auth_attempts").all()[0]?.n).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM events").all()[0]?.n).toBe(0);
    expect(log).not.toHaveBeenCalled();
  });

  it("이력 저장이 실패해도 이미 삭제된 건수는 로그에 남기고 오류를 전파한다", async () => {
    const { db, env } = await setup();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    db.prepare("INSERT INTO auth_attempts (id, key, created_at) VALUES ('old', 'test', ?)").run(cutoff - 1);
    db.exec("DROP TABLE events");
    await expect(cleanupAuthRecords(env, controller())).rejects.toThrow();
    expect(db.prepare("SELECT COUNT(*) AS n FROM auth_attempts").all()[0]?.n).toBe(0);
    expect(log).toHaveBeenCalledWith("[auth_cleanup_completed]", JSON.stringify({
      scheduled_at: scheduledAt, cutoff,
      deleted: { auth_attempts: 1, phone_verifications: 0, oauth_states: 0, password_resets: 0 },
    }));
  });
});
