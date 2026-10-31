import { afterEach, expect, it, vi } from "vitest";
import { sendQueuedEmail } from "./message-provider";
const env = { RESEND_API_KEY: "local-provider-key", TOKEN_ENC_KEY: "local-encryption-key", EMAIL_FROM: "Local <sender@sender.company.dev>" } as Env;
const body = JSON.stringify({ from: env.EMAIL_FROM, to: ["local@example.invalid"], subject: "LOCAL", text: "LOCAL" });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("uses the exact frozen bytes and stable official idempotency header without following redirects", async () => {
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ id: "accepted" })); vi.stubGlobal("fetch", fetcher);
  expect(await sendQueuedEmail(env, body, "delivery")).toEqual({ kind: "accepted", id: "accepted" });
  await sendQueuedEmail(env, body, "delivery");
  expect(fetcher.mock.calls.map((call) => ({ url: call[0], body: (call as unknown as [string, RequestInit])[1].body, headers: (call as unknown as [string, RequestInit])[1].headers }))[0]).toEqual(fetcher.mock.calls.map((call) => ({ url: call[0], body: (call as unknown as [string, RequestInit])[1].body, headers: (call as unknown as [string, RequestInit])[1].headers }))[1]);
  expect(fetcher).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({ redirect: "manual", method: "POST", body, headers: expect.objectContaining({ "Idempotency-Key": "message/delivery" }) }));
});
it.each([{}, { ...env, EMAIL_FROM: "" }, { ...env, EMAIL_FROM: "fake@example.invalid" }, { ...env, TOKEN_ENC_KEY: "" }])("missing provider configuration means zero HTTP", async (config) => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); expect(await sendQueuedEmail(config as Env, body, "d")).toEqual({ kind: "rejected", code: "no_provider" }); expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  [409, "invalid_idempotent_request", "conflict"], [409, "concurrent_idempotent_requests", "retry"], [429, "rate_limit_exceeded", "retry"], [503, "service_unavailable", "uncertain"], [302, "private-provider-text", "uncertain"], [400, "validation_error", "rejected"], [401, "private-key", "rejected"],
])("classifies status%s and keeps provider payload private", async (status, name, kind) => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {}); vi.stubGlobal("fetch", vi.fn(async () => Response.json({ name, message: "private-api-key local@example.invalid" }, { status, headers: { "Retry-After": "60" } })));
  const result = await sendQueuedEmail(env, body, "delivery"); expect(result.kind).toBe(kind); expect(JSON.stringify(result)).not.toContain("private"); expect(log).not.toHaveBeenCalled();
});
it("missing/oversized success ID or timeout never proves success", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(Response.json({ id: "x".repeat(17000) })).mockRejectedValueOnce(new Error("private transport")); vi.stubGlobal("fetch", fetcher);
  for (let i = 0; i < 3; i++) expect(await sendQueuedEmail(env, body, "d")).toMatchObject({ kind: "uncertain" });
});
