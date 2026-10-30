import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../types";
import type { Db } from "../../db";
import { ApiError, errorBody } from "../../lib/errors";
import type { EmailResult } from "../../lib/email";

const logs: unknown[] = [];
let emailResult: EmailResult = { delivered: false, reason: "no_provider" };

vi.mock("../../lib/email", () => ({ sendEmail: async () => emailResult }));
vi.mock("../../lib/guides", () => ({ findGuide: async () => ({}) }));
vi.mock("../../lib/message-templates", () => ({
  findTemplate: async () => null,
  participantValues: async () => ({ values: {}, lang: "ko", email: "a@b.com", brandName: "브랜드" }),
}));
vi.mock("../../lib/participation", () => ({ addContactLog: async (_db: Db, _w: string, _g: string, log: unknown) => (logs.push(log), log) }));
vi.mock("./participation", () => ({ ownRow: async () => ({ workspaceId: "w1", userId: "u1", gi: { id: "gi1" } }) }));
vi.mock("../../middleware/auth", () => ({ editorsOnly: async (_c: unknown, next: () => Promise<void>) => next() }));

import { messageRoutes } from "./messages";

function send(appEnv: string) {
  const app = new Hono<AppEnv>();
  app.route("/api/guides", messageRoutes);
  app.onError((err, c) => (err instanceof ApiError ? c.json(errorBody(err.code, err.message, err.fields), err.status) : c.json({}, 500)));
  const body = JSON.stringify({ channel: "email", lang: "ko", body: "안녕하세요", templateId: null });
  return app.request("/api/guides/g1/influencers/gi1/messages", { method: "POST", body, headers: { "content-type": "application/json" } }, { APP_ENV: appEnv });
}

describe("이메일로 보내기 기록", () => {
  beforeEach(() => {
    logs.length = 0;
    emailResult = { delivered: false, reason: "no_provider" };
  });

  it("발송 설정이 없으면 기록 0건, 409", async () => {
    expect((await send("production")).status).toBe(409);
    expect(logs).toHaveLength(0);
  });

  it("발송에 성공하면 기록 1건", async () => {
    emailResult = { delivered: true, id: "m1" };
    expect((await send("production")).status).toBe(201);
    expect(logs).toHaveLength(1);
  });

  it("로컬 개발은 표시를 붙여 기록한다", async () => {
    expect((await send("development")).status).toBe(201);
    expect(JSON.stringify(logs)).toContain("실제 발송 안 됨");
  });
});
