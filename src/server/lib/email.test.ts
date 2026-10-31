import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sendEmail } from "./email";

const message = { to: "recipient@example.invalid", subject: "private subject", text: "private-reset-token", html: "private-reset-token" };
beforeEach(() => { vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([{}, { RESEND_API_KEY: "key" }, { RESEND_API_KEY: "key", EMAIL_FROM: " " }, { EMAIL_FROM: "sender@example.invalid" }])("missing sender/provider does not transmit a message or log contacts/capabilities", async (env) => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect(await sendEmail(env as Env, message)).toEqual({ delivered: false, reason: "no_provider" });
  expect(fetcher).not.toHaveBeenCalled(); expect(console.log).toHaveBeenCalledExactlyOnceWith("[email:no_provider]");
  expect(console.error).not.toHaveBeenCalled();
});

it("keeps explicit frozen sender, idempotency and tags without following redirects", async () => {
  const fetcher = vi.fn(async () => Response.json({ id: "provider-id" })); vi.stubGlobal("fetch", fetcher);
  expect(await sendEmail({ RESEND_API_KEY: "key" } as Env, { ...message, tags: [{ name: "job", value: "fake" }] }, { from: "frozen@sender.example.test", idempotencyKey: "stable-job" })).toEqual({ delivered: true, id: "provider-id" });
  const [url, init] = (fetcher.mock.calls as unknown as [string, RequestInit][])[0]!;
  expect(url).toBe("https://api.resend.com/emails"); expect(init.redirect).toBe("manual");
  expect(init.headers).toMatchObject({ "Idempotency-Key": "stable-job" });
  expect(JSON.parse(String(init.body))).toMatchObject({ from: "frozen@sender.example.test", tags: [{ name: "job", value: "fake" }] });
});

it.each([302, 400, 503])("HTTP %i records only status and never consumes a private error body", async (status) => {
  const text = vi.fn(async () => "recipient@example.invalid private-reset-token key");
  const response = new Response("recipient@example.invalid private-reset-token key", { status }); response.text = text;
  const fetcher = vi.fn(async () => response); vi.stubGlobal("fetch", fetcher);
  expect(await sendEmail({ RESEND_API_KEY: "key", EMAIL_FROM: "sender@sender.example.test" } as Env, message)).toEqual({ delivered: false, reason: "provider_error" });
  expect(text).not.toHaveBeenCalled(); expect(console.error).toHaveBeenCalledExactlyOnceWith("[email:provider_error]", status);
});
