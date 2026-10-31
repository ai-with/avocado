import { Hono } from "hono";
import type { AppEnv } from "./types";
import { getDb } from "./db";
import { ApiError, errorBody } from "./lib/errors";
import { loadSession } from "./middleware/auth";
import { registerRoutes } from "./routes";
import { batchQueueHandlers, queueHandlers, scheduledTasks, type PipelineMessage } from "./jobs";
import { isPublicGuideJoinRequest } from "./lib/guide-join";
import { isPublicAnalysisCompleteRequest, readAnalysisReceipt } from "./routes/public-guide/media";

const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  c.set("db", getDb(c.env.DB));
  await next();
});
app.use("/api/*", async (c, next) => {
  if (isPublicAnalysisCompleteRequest(c.req.method, c.req.path)) await readAnalysisReceipt(c.req.raw);
  if (isPublicGuideJoinRequest(c.req.method, c.req.path)) { c.set("auth", null); await next(); }
  else await loadSession(c, next);
});
registerRoutes(app);

app.notFound((c) => c.json(errorBody("not_found", "요청한 주소를 찾을 수 없어요."), 404));
app.onError((err, c) => {
  if (err instanceof ApiError) return c.json(errorBody(err.code, err.message, err.fields), err.status);
  if (err instanceof SyntaxError) return c.json(errorBody("invalid_json", "요청 본문이 JSON 형식이 아니에요."), 400);
  console.error(err);
  return c.json(errorBody("internal_error", "일시적인 오류가 발생했어요. 잠시 후 다시 시도해 주세요."), 500);
});

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    for (const task of scheduledTasks) {
      ctx.waitUntil(task(env, controller).catch((e: unknown) => {
        console.error("[cron]", e);
        throw e; // Past Cron Events에도 실패가 표시되도록 waitUntil에 전파한다
      }));
    }
  },
  async queue(batch, env) {
    const batchHandler = batchQueueHandlers[batch.queue];
    if (batchHandler) {
      try {
        await batchHandler(batch, env);
        batch.ackAll();
      } catch (e) {
        console.error("[queue]", batch.queue, e);
        batch.retryAll();
      }
      return;
    }
    for (const msg of batch.messages) {
      const handler = queueHandlers[msg.body.type];
      if (!handler) {
        console.error("[queue] 알 수 없는 메시지 유형", msg.body.type);
        msg.ack();
        continue;
      }
      try {
        await handler(msg.body.payload, env);
        msg.ack();
      } catch (e) {
        console.error("[queue]", msg.body.type, e);
        msg.retry();
      }
    }
  },
} satisfies ExportedHandler<Env, PipelineMessage>;
