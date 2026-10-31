import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../index";
import type { PipelineMessage } from "../jobs";
import { countD1Calls, createSqliteD1 } from "../test/sqlite-d1";
import { enqueuePrivacyPurges } from "./privacy-jobs";

const NOW = Date.parse("2026-10-31T18:00:00Z");
const controller = { scheduledTime: NOW, cron: "*/15 * * * *", noRetry() {} } as ScheduledController;
const cleanups: (() => void)[] = [];
afterEach(() => { for (const close of cleanups.splice(0)) close(); vi.restoreAllMocks(); });

async function setup() {
  const { db, d1, close } = await createSqliteD1();
  cleanups.push(close);
  const counted = countD1Calls(d1);
  const messages: { body: PipelineMessage }[] = [];
  const sendBatch = vi.fn(async (batch: Iterable<{ body: PipelineMessage }>) => { messages.push(...batch); });
  const env = { DB: counted.d1, PIPELINE: { sendBatch } } as unknown as Env;
  return { db, env, messages, sendBatch, counted };
}
async function scheduled(env: Env) {
  const pending: Promise<unknown>[] = [];
  await worker.scheduled(controller, env, { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } } as unknown as ExecutionContext);
  return Promise.allSettled(pending);
}
async function queued(env: Env, body: PipelineMessage) {
  const ack = vi.fn(), retry = vi.fn();
  await worker.queue({ queue: "avocado-pipeline", messages: [{ body, ack, retry }] } as unknown as MessageBatch<PipelineMessage>, env);
  return { ack, retry };
}

describe("개인정보 Queue 실행", () => {
  it("Cron은 개인정보 작업 세 건만 Queue에 넣고 실제 파기는 별도 호출에서 한다", async () => {
    const { db, env, messages, sendBatch, counted } = await setup();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    db.exec("INSERT INTO workspaces(id,name,created_at) VALUES('w','team',1)");
    db.prepare("INSERT INTO leads(id,workspace_id,email,answers,unsubscribe_token,first_source,last_source,created_at,deleted_at) VALUES('old','w','old@example.com','{}','old','{}','{}',1,?)").run(NOW - 7 * 86_400_000);
    expect((await scheduled(env)).every((result) => result.status === "fulfilled")).toBe(true);
    expect(sendBatch.mock.calls.filter(([batch]) => [...batch].some((message) => message.body.type === "privacy_purge"))).toHaveLength(1);
    const privacy = messages.filter((message) => message.body.type === "privacy_purge");
    expect(privacy.map((message) => message.body)).toEqual(["leads", "sites", "media"].map((kind) => ({ type: "privacy_purge", payload: { kind, scheduledTime: NOW, cron: controller.cron } })));
    expect(messages.filter((message) => message.body.type === "cleanup_google_sheets")).toHaveLength(1);
    expect(messages.filter((message) => message.body.type === "ig_connection_maintenance")).toEqual([{ body: { type: "ig_connection_maintenance", payload: {} } }]);
    expect(db.prepare("SELECT count(*) AS n FROM leads").all()[0]?.n).toBe(1);
    expect(counted.getCalls()).toBe(10); // 기존 조회 7회 + 03시 인증 정리 2회 + NULL 해시 보완 1회
    const expectedCalls = [5, 4, 4];
    for (const [i, message] of privacy.entries()) {
      counted.reset();
      const result = await queued(env, message.body);
      expect(result.ack).toHaveBeenCalledTimes(1);
      expect(result.retry).not.toHaveBeenCalled();
      expect(counted.getCalls()).toBe(expectedCalls[i]);
    }
    counted.reset();
    const cleanup = await queued(env, { type: "cleanup_google_sheets", payload: {} });
    expect(cleanup.ack).toHaveBeenCalledTimes(1);
    expect(cleanup.retry).not.toHaveBeenCalled();
    expect(counted.getCalls()).toBe(2); // Sheets 임시 자료 1 batch + 공개 참여 counter 1 bounded DELETE
    counted.reset();
    const igMaintenance = await queued(env, { type: "ig_connection_maintenance", payload: {} });
    expect(igMaintenance.ack).toHaveBeenCalledTimes(1);
    expect(igMaintenance.retry).not.toHaveBeenCalled();
    expect(counted.getCalls()).toBe(1);
    expect(db.prepare("SELECT count(*) AS n FROM leads").all()[0]?.n).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM events WHERE name IN ('lead_privacy_cleanup_completed','site_privacy_cleanup_completed','media_purge_run')").all()[0]?.n).toBe(3);
  });

  it("enqueue 실패는 Cron 실패로 전파하고 다음 주기에는 다시 넣는다", async () => {
    const { env, sendBatch, messages } = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    sendBatch.mockRejectedValueOnce(new Error("queue unavailable"));
    expect((await scheduled(env)).some((result) => result.status === "rejected")).toBe(true);
    expect(messages.filter((message) => message.body.type === "privacy_purge")).toHaveLength(0);
    expect((await scheduled(env)).every((result) => result.status === "fulfilled")).toBe(true);
    expect(messages.filter((message) => message.body.type === "privacy_purge")).toHaveLength(3);
    expect(messages.filter((message) => message.body.type === "cleanup_google_sheets")).toHaveLength(2);
  });

  it("실행 실패는 ack하지 않고 기존 consumer가 retry하며 같은 메시지로 복구한다", async () => {
    const { db, env } = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const message = { type: "privacy_purge", payload: { kind: "sites", scheduledTime: NOW, cron: controller.cron } };
    db.exec("CREATE TRIGGER fail_site_delete BEFORE DELETE ON site_event_ids BEGIN SELECT RAISE(ABORT,'test'); END");
    db.exec("INSERT INTO workspaces(id,name,created_at) VALUES('w','team',1)");
    db.exec("INSERT INTO sites(id,workspace_id,site_key,name,allowed_domains,created_at) VALUES('s','w','key','site','[]',1)");
    db.exec("INSERT INTO site_event_ids(site_id,id,at) VALUES('s','event',1)");
    db.prepare("UPDATE sites SET deleted_at=? WHERE id='s'").run(NOW - 30 * 86_400_000);
    const failed = await queued(env, message);
    expect(failed.retry).toHaveBeenCalledTimes(1);
    expect(failed.ack).not.toHaveBeenCalled();
    expect(db.prepare("SELECT count(*) AS n FROM sites").all()[0]?.n).toBe(1);
    db.exec("DROP TRIGGER fail_site_delete");
    const recovered = await queued(env, message);
    expect(recovered.ack).toHaveBeenCalledTimes(1);
    expect(recovered.retry).not.toHaveBeenCalled();
    expect(db.prepare("SELECT count(*) AS n FROM sites").all()[0]?.n).toBe(0);
  });

  it("기존 process_submission 메시지도 영상 handler로 전달하고 ack한다", async () => {
    const { env, counted } = await setup();
    const result = await queued(env, { type: "process_submission", payload: { submissionId: "missing-submission" } });
    expect(result.ack).toHaveBeenCalledTimes(1);
    expect(result.retry).not.toHaveBeenCalled();
    expect(counted.getCalls()).toBe(1); // 기존 영상 컨텍스트 조회가 수행됨
  });

  it("Instagram Queue DB 실패는 retry하면서 bound parameter 원문을 로그에 남기지 않는다", async () => {
    const { env } = await setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    env.DB = { prepare: () => { throw new Error("bound params: private-recipient@example.invalid private-connect-token"); } } as unknown as D1Database;
    const result = await queued(env, { type: "ig_disconnect_mail", payload: { id: "mail" } });
    expect(result.retry).toHaveBeenCalledTimes(1);
    expect(result.ack).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("[queue]", "ig_disconnect_mail", expect.objectContaining({ message: "instagram_queue_job_failed" }));
    expect(JSON.stringify(error.mock.calls)).not.toContain("private-recipient");
    expect(JSON.stringify(error.mock.calls)).not.toContain("private-connect-token");
  });

  it("작업 종류가 틀린 Queue 메시지는 실행하거나 ack하지 않는다", async () => {
    const { env, counted } = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await queued(env, { type: "privacy_purge", payload: { kind: "unknown", scheduledTime: NOW, cron: controller.cron } });
    expect(result.retry).toHaveBeenCalledTimes(1);
    expect(result.ack).not.toHaveBeenCalled();
    expect(counted.getCalls()).toBe(0);
    await enqueuePrivacyPurges(env, controller);
    expect(counted.getCalls()).toBe(0);
  });
});
