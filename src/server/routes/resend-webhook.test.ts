import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { processMessaging } from "../lib/messaging";
import { sendEmail } from "../lib/email";
import { verifyResendSignature } from "../lib/resend-webhook";
import { resendWebhookRoutes } from "./resend-webhook";

type Value = string | number | null;
type Row = Record<string, Value>;
type Sqlite = {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): { run(...params: Value[]): { changes: number }; all(...params: Value[]): Row[] };
};
const databases: Sqlite[] = [];
const NOW = Date.parse("2026-10-31T06:00:00Z");
const BOUNCED_AT = NOW - 2000;
const SECRET = `whsec_${btoa("resend-webhook-test-signing-key")}`;

beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NOW); });
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function signature(raw: string, id = "msg_bounce", timestamp = String(NOW / 1000)) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("resend-webhook-test-signing-key"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${raw}`)));
  return `v1,${btoa(String.fromCharCode(...digest))}`;
}
const bounce = (emailId = "email1", to = ["shared@example.com"], createdAt = BOUNCED_AT, tags?: Record<string, string>) => ({
  type: "email.bounced",
  created_at: new Date(createdAt).toISOString(),
  data: { email_id: emailId, to, ...(tags && { tags }) },
});

async function setup() {
  const sqlite = (await import("node:sqlite" as string)) as { DatabaseSync: new (path: string) => Sqlite };
  const fs = (await import("node:fs" as string)) as { readdirSync(path: string): string[]; readFileSync(path: string, encoding: string): string };
  const db = new sqlite.DatabaseSync(":memory:");
  databases.push(db);
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of fs.readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort()) db.exec(fs.readFileSync(`migrations/${file}`, "utf8"));
  type Statement = { run(): Promise<unknown>; all(): Promise<unknown> };
  const prepare = (sql: string, params: Value[] = []): unknown => ({
    bind: (...values: Value[]) => prepare(sql, values),
    run: async () => ({ success: true, results: [], meta: { changes: Number(db.prepare(sql).run(...params).changes) } }),
    all: async () => ({ success: true, results: db.prepare(sql).all(...params), meta: {} }),
    raw: async () => db.prepare(sql).all(...params).map((row) => Object.values(row)),
  });
  const d1 = {
    prepare,
    batch: async (statements: Statement[]) => {
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
  db.exec("INSERT INTO workspaces (id, name, created_at) VALUES ('w1', 'test1', 1), ('w2', 'test2', 1)");
  const env = { DB: d1, RESEND_WEBHOOK_SECRET: SECRET, RESEND_API_KEY: "test-key", EMAIL_FROM: "test@sender.example.test", APP_URL: "https://app.example.com" } as Env;
  const app = new Hono<AppEnv>();
  app.route("/webhooks", resendWebhookRoutes);
  app.onError((_error, c) => c.text("internal error", 500));
  const call = async (event: unknown, options: { raw?: string; secret?: string; headers?: Record<string, string> } = {}) => {
    const raw = options.raw ?? JSON.stringify(event);
    return app.request("/webhooks/resend", {
      method: "POST", body: raw,
      headers: { "content-type": "application/json", "svix-id": "msg_bounce", "svix-timestamp": String(NOW / 1000), "svix-signature": await signature(raw), ...options.headers },
    }, { ...env, ...(options.secret !== undefined && { RESEND_WEBHOOK_SECRET: options.secret }) });
  };
  return { db, env, call };
}

function lead(db: Sqlite, id: string, workspace = "w1", email = "shared@example.com", createdAt = 1000) {
  db.prepare("INSERT INTO leads (id, workspace_id, email, answers, unsubscribe_token, first_source, last_source, created_at) VALUES (?, ?, ?, '{}', ?, '{}', '{}', ?)").run(id, workspace, email, `unsubscribe-${id}`, createdAt);
}
function sent(db: Sqlite, id = "log1", leadId: string | null = "l1", emailId = "email1", recipient = "shared@example.com", workspace = "w1", leadCreatedAt: number | null = 1000) {
  db.prepare("INSERT INTO message_logs (id, workspace_id, lead_id, source, source_id, channel, status, at, provider_id, recipient_email, lead_created_at) VALUES (?, ?, ?, 'broadcast', 'b1', 'email', 'sent', ?, ?, ?, ?)").run(id, workspace, leadId, NOW, emailId, recipient, leadCreatedAt);
}
const firstRow = (rows: Row[]) => {
  const row = rows[0];
  if (!row) throw new Error("조회 결과가 없어요.");
  return row;
};
const bouncedAt = (db: Sqlite, id: string) => firstRow(db.prepare("SELECT bounced_at AS at FROM leads WHERE id = ?").all(id)).at;
const logStatus = (db: Sqlite, id = "log1") => firstRow(db.prepare("SELECT status, reason FROM message_logs WHERE id = ?").all(id));

describe("Resend/Svix 서명", () => {
  it("공식 Svix 검증 벡터와 일치한다", async () => {
    // https://docs.svix.com/receiving/verifying-payloads/how-manual 의 예제
    expect(await verifyResendSignature("whsec_plJ3nmyCDGBKInavdOK15jsl", '{"event_type":"ping","data":{"success":true}}', {
      id: "msg_loFOjxBNrRLzqYUf", timestamp: "1731705121", signature: "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=",
    }, 1731705121000)).toBe(true);
  });

  it("본문·ID·시각 변조, 누락, 잘못된 Base64를 거절하고 키 교체 중의 v1 서명은 허용한다", async () => {
    const raw = JSON.stringify(bounce());
    const headers = { id: "msg_bounce", timestamp: String(NOW / 1000), signature: await signature(raw) };
    expect(await verifyResendSignature(SECRET, `${raw} `, headers)).toBe(false);
    expect(await verifyResendSignature(SECRET, raw, { ...headers, id: "other" })).toBe(false);
    expect(await verifyResendSignature(SECRET, raw, { ...headers, timestamp: String(NOW / 1000 + 1) })).toBe(false);
    expect(await verifyResendSignature(SECRET, raw, { ...headers, signature: undefined })).toBe(false);
    expect(await verifyResendSignature("whsec_!bad", raw, headers)).toBe(false);
    expect(await verifyResendSignature(SECRET, raw, { ...headers, signature: `v2,ignored v1,!bad ${headers.signature}` })).toBe(true);
  });

  it.each([-301, 301])("%i초 밖의 유효한 서명도 거절한다", async (delta) => {
    const raw = JSON.stringify(bounce());
    const timestamp = String(NOW / 1000 + delta);
    expect(await verifyResendSignature(SECRET, raw, { id: "msg_bounce", timestamp, signature: await signature(raw, "msg_bounce", timestamp) })).toBe(false);
  });
});

describe("POST /webhooks/resend", () => {
  it("Content-Length 유무와 관계없이 64KB를 넘는 본문을 거절한다", async () => {
    const { call } = await setup();
    expect((await call({}, { raw: " ".repeat(64 * 1024 + 1) })).status).toBe(413);
    expect((await call(bounce(), { headers: { "content-length": String(64 * 1024 + 1) } })).status).toBe(413);
  });

  it("서명·설정·잘못된 이벤트는 DB에 적용하지 않고 다른 이벤트는 무시한다", async () => {
    const { db, call } = await setup();
    lead(db, "l1"); sent(db);
    expect((await call(bounce(), { secret: "" })).status).toBe(503);
    expect((await call(bounce(), { headers: { "svix-signature": "v1,invalid" } })).status).toBe(401);
    expect((await call({}, { raw: "{" })).status).toBe(400);
    expect((await call(bounce(), { raw: JSON.stringify({ ...bounce(), created_at: "invalid" }) })).status).toBe(400);
    expect((await call({ type: "email.delivered" })).status).toBe(200);
    expect(bouncedAt(db, "l1")).toBeNull();
    expect(logStatus(db)).toMatchObject({ status: "sent", reason: null });
  });

  it("다중 수신자 중 실제 발송 ID·수신자에 맞는 리드만 반송 처리하고 같은 주소의 다른 팀은 보존한다", async () => {
    const { db, call } = await setup();
    lead(db, "l1"); lead(db, "l2", "w2"); lead(db, "l3", "w1", "other@example.com");
    sent(db); sent(db, "log2", "l2", "email2", "shared@example.com", "w2"); sent(db, "log3", "l3", "email3", "other@example.com");
    expect((await call(bounce("email1", ["SHARED@example.com", "other@example.com"]))).status).toBe(200);
    expect(bouncedAt(db, "l1")).toBe(BOUNCED_AT); // API 응답 후 기록 시각(NOW)보다 이른 이벤트도 유효
    expect(bouncedAt(db, "l2")).toBeNull();
    expect(bouncedAt(db, "l3")).toBeNull();
    expect(logStatus(db)).toEqual({ status: "bounced", reason: "bounced" });
    expect(logStatus(db, "log2").status).toBe("sent");
  });

  it("발송 ID가 맞아도 수신자가 다르거나 다른 팀의 리드에 연결된 기록으로는 갱신하지 않는다", async () => {
    const { db, call } = await setup();
    lead(db, "l1"); lead(db, "l2", "w2"); sent(db);
    expect((await call(bounce("email1", ["other@example.com"]))).status).toBe(200);
    expect(logStatus(db).status).toBe("sent");
    sent(db, "corrupt", "l2", "email2");
    expect((await call(bounce("email2"))).status).toBe(200);
    expect(bouncedAt(db, "l1")).toBeNull();
    expect(bouncedAt(db, "l2")).toBeNull();
  });

  it.each(["email_changed", "deleted", "revived"])("%s인 리드에는 과거 반송을 적용하지 않는다", async (kind) => {
    const { db, call } = await setup();
    lead(db, "l1"); sent(db);
    if (kind === "email_changed") db.exec("UPDATE leads SET email = 'new@example.com' WHERE id = 'l1'");
    if (kind === "deleted") db.exec("UPDATE leads SET deleted_at = 2000 WHERE id = 'l1'");
    if (kind === "revived") db.exec("UPDATE leads SET created_at = 2000 WHERE id = 'l1'");
    expect((await call(bounce())).status).toBe(200);
    expect(bouncedAt(db, "l1")).toBeNull();
    expect(logStatus(db).status).toBe("bounced");
  });

  it("중복·순서가 뒤바뀐 이벤트도 최초 반송 시각을 유지한다", async () => {
    const { db, call } = await setup();
    lead(db, "l1"); sent(db);
    await call(bounce());
    const changes = firstRow(db.prepare("SELECT total_changes() AS n").all()).n;
    await call(bounce());
    expect(firstRow(db.prepare("SELECT total_changes() AS n").all()).n).toBe(changes);
    await call(bounce("email1", ["shared@example.com"], BOUNCED_AT + 1000));
    expect(bouncedAt(db, "l1")).toBe(BOUNCED_AT);
    await call(bounce("email1", ["shared@example.com"], BOUNCED_AT - 1000));
    expect(bouncedAt(db, "l1")).toBe(BOUNCED_AT - 1000);
  });

  it("관리 대상의 발송 기록이 늦으면 재시도하고 초대·테스트·기존 미연결 메일은 리드를 차단하지 않는다", async () => {
    const { db, call } = await setup();
    lead(db, "l1");
    expect((await call(bounce("untracked"))).status).toBe(200);
    expect((await call(bounce("deleted-log", undefined, NOW - 11 * 60_000, { message_log_id: "deleted" }))).status).toBe(200);
    expect((await call(bounce("future-log", undefined, NOW + 60 * 60_000, { message_log_id: "future" }))).status).toBe(200);
    expect((await call(bounce("email1", undefined, undefined, { message_log_id: "log1" }))).status).toBe(503);
    sent(db);
    expect((await call(bounce("email1", undefined, undefined, { message_log_id: "log1" }))).status).toBe(200);
    expect(bouncedAt(db, "l1")).toBe(BOUNCED_AT);
    db.exec("UPDATE leads SET bounced_at = NULL");
    sent(db, "test", null, "email-test");
    expect((await call(bounce("email-test"))).status).toBe(200);
    expect(bouncedAt(db, "l1")).toBeNull();
    sent(db, "legacy", "l1", "legacy-id", "shared@example.com", "w1", null);
    expect((await call(bounce("legacy-id"))).status).toBe(200);
    expect(bouncedAt(db, "l1")).toBeNull();
  });

  it("DB 갱신 중 실패하면 2xx를 반환하지 않고 전체를 롤백하며 같은 이벤트 재시도로 완료한다", async () => {
    const { db, call } = await setup();
    lead(db, "l1"); sent(db);
    db.exec("CREATE TRIGGER fail_bounce BEFORE UPDATE ON message_logs BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    expect((await call(bounce())).status).toBe(500);
    expect(bouncedAt(db, "l1")).toBeNull();
    expect(logStatus(db).status).toBe("sent");
    db.exec("DROP TRIGGER fail_bounce");
    expect((await call(bounce())).status).toBe(200);
    expect(bouncedAt(db, "l1")).toBe(BOUNCED_AT);
    expect(logStatus(db).status).toBe("bounced");
  });
});

describe("실제 발송 기록과 연결", () => {
  it("Cron no longer executes a legacy pending automation inline", async () => {
    const { db, env } = await setup(); lead(db, "l1");
    db.prepare("INSERT INTO automations (id, workspace_id, name, trigger, target, delay_minutes, channel, kind, template, enabled, created_at, updated_at) VALUES ('a1', 'w1', 'rule', 'form_submitted', '{}', 0, 'email', 'info', ?, 1, 1, 1)").run(JSON.stringify({ subject: "test", preview: "", body: "test", buttonLabel: "", buttonUrl: "" }));
    db.exec("INSERT INTO automation_runs (id, automation_id, lead_id, ref_id, due_at, status, created_at) VALUES ('r1', 'a1', 'l1', 'form1', 1, 'pending', 1)");
    const fetcher = vi.fn(), sendBatch = vi.fn(async () => {}); vi.stubGlobal("fetch", fetcher); env.PIPELINE = { sendBatch } as unknown as Queue;
    await processMessaging(env); expect(fetcher).not.toHaveBeenCalled();
    expect(sendBatch).toHaveBeenCalledWith([{ body: { type: "message_maintenance", payload: {} } }]);
    expect(db.prepare("SELECT count(*) n FROM message_logs").all()).toEqual([{ n: 0 }]);
  });

  it("Resend가 ID를 돌려주지 않는 응답을 발송 성공으로 처리하지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendEmail({ RESEND_API_KEY: "test", EMAIL_FROM: "test@sender.example.test" } as Env, { to: "a@example.com", subject: "test", text: "test", html: "test" })).toEqual({ delivered: false, reason: "provider_error" });
  });
});
