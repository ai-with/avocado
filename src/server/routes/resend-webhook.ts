import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../types";
import { bounceSchema, recordEmailBounce, verifyResendSignature } from "../lib/resend-webhook";

const MAX_BODY_BYTES = 64 * 1024;

export const resendWebhookRoutes = new Hono<AppEnv>().post("/resend", bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.body(null, 413) }), async (c) => {
  if (!c.env.RESEND_WEBHOOK_SECRET) return c.text("webhook not configured", 503);
  if (Number(c.req.header("content-length") ?? 0) > MAX_BODY_BYTES) return c.body(null, 413);
  const body = await c.req.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) return c.body(null, 413);
  const raw = new TextDecoder().decode(body);
  if (!(await verifyResendSignature(c.env.RESEND_WEBHOOK_SECRET, raw, {
    id: c.req.header("svix-id"),
    timestamp: c.req.header("svix-timestamp"),
    signature: c.req.header("svix-signature"),
  }))) return c.text("invalid signature", 401);

  let event: unknown;
  try { event = JSON.parse(raw); } catch { return c.text("invalid event", 400); }
  if (!event || typeof event !== "object" || !("type" in event) || typeof event.type !== "string") return c.text("invalid event", 400);
  if (event.type !== "email.bounced") return c.text("ok");
  const parsed = bounceSchema.safeParse(event);
  if (!parsed.success) return c.text("invalid event", 400);
  const result = await recordEmailBounce(c.env.DB, parsed.data, c.env.TOKEN_ENC_KEY);
  return result === "retry" ? c.text("send record not ready", 503) : c.text("ok");
});
