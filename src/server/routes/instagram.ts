import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import type { AppEnv } from "../types";
import type { Db } from "../db";
import { igConnections } from "../db/schema";
import { ApiError, parse } from "../lib/errors";
import { newId, newToken, now } from "../lib/ids";
import { logEvent } from "../lib/events";
import { decryptToken } from "../lib/crypto";
import { isFake, recentMedia, tokenKey, verifySignature } from "../lib/instagram";
import { handleComment, type IgComment } from "../lib/keyword-dm";
import { editorsOnly, workspaceCtx } from "../middleware/auth";
import { definitiveIgDisconnect, igConnectionState, igGrantVerified } from "../lib/ig-connection-state";
import { disconnectIgConnection } from "../lib/ig-disconnect-mail";
import { assertInstagramOrigin, finishInstagramOAuth, instagramConnectInfo, instagramEditorPredicate, instagramOAuthConfigured, instagramStartBody, latestInstagramConnection, startInstagramOAuth } from "../lib/instagram-oauth";

const publicConn = (connection: typeof igConnections.$inferSelect) => ({
  id: connection.id, target: connection.target, label: connection.label, username: connection.username, accountType: connection.accountType,
  scopes: connection.scopes, ...igConnectionState(connection), connectedAt: connection.connectedAt, expiresAt: connection.expiresAt,
  revokedAt: connection.revokedAt, influencerId: connection.influencerId,
});
export const brandSender = (db: Db, workspaceId: string) => latestInstagramConnection(db, workspaceId, "brand_sender");

export const igRoutes = new Hono<AppEnv>()
  .get("/status", (c) => c.json({ configured: instagramOAuthConfigured(c.env), fake: isFake(c.env) }))
  .get("/connect/:token", async (c) => {
    const info = await instagramConnectInfo(c.var.db, c.env, c.req.param("token"), c.req.query());
    return c.json(info);
  })
  // 외부 링크의 GET만으로 OAuth를 시작하지 않는다. 공개 흐름도 명시적 버튼의 same-origin POST를 쓴다.
  .post("/oauth/start", async (c) => {
    try { return c.json(await startInstagramOAuth(c, parse(instagramStartBody, await c.req.json()))); }
    catch (error) {
      if (error instanceof ApiError || error instanceof SyntaxError) throw error;
      // Drizzle 오류의 SQL params에 공개 capability가 있을 수 있어 원문·cause를 상위 logger로 넘기지 않는다.
      console.error("[ig:oauth_start_failed]");
      throw new ApiError(503, "oauth_unavailable", "인스타그램 연결을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  })
  .get("/oauth/callback", async (c) => {
    try {
      const result = await finishInstagramOAuth(c, c.req.query());
      const target = new URL(result.returnPath, c.env.APP_URL);
      target.searchParams.set("ig", result.outcome);
      if (result.outcome === "connected") target.searchParams.set("done", "1");
      if (result.error) target.searchParams.set("error", result.error);
      return c.redirect(target.pathname + target.search);
    } catch {
      console.error("[ig:oauth_callback_failed]");
      return c.redirect("/connect/invalid?ig=failed&error=api_error");
    }
  })
  .get("/connections", async (c) => {
    const { workspace } = workspaceCtx(c);
    const rows = await c.var.db.select().from(igConnections).where(eq(igConnections.workspaceId, workspace.id))
      .orderBy(desc(igConnections.connectedAt), desc(igConnections.createdAt), desc(igConnections.id));
    return c.json({ configured: instagramOAuthConfigured(c.env), fake: isFake(c.env), connections: rows.map((row) => ({ ...publicConn(row),
      connectUrl: row.connectToken && row.connectExpiresAt && row.connectExpiresAt > now() ? `${c.env.APP_URL}/connect/${row.connectToken}` : null })) });
  })
  .post("/connections/client-request", editorsOnly, async (c) => {
    assertInstagramOrigin(c);
    const auth = workspaceCtx(c);
    const body = parse(z.object({ label: z.string().trim().min(1).max(80) }), await c.req.json());
    const id = newId(), token = newToken(), at = now();
    const inserted = await c.var.db.all<{ id: string }>(sql`INSERT INTO ig_connections (id,workspace_id,target,connect_token,connect_expires_at,label,scopes,generation,created_at)
      SELECT ${id},${auth.workspace.id},'client_brand',${token},${at + 30 * 86_400_000},${body.label},'[]',${newToken(18)},${at}
      WHERE ${instagramEditorPredicate(auth, auth.workspace.id)} RETURNING id`);
    if (!inserted.length) throw new ApiError(403, "forbidden", "이 작업을 할 권한이 없어요.");
    await logEvent(c.var.db, auth.workspace.id, "ig_connect_link_sent", { target: "client_brand" });
    return c.json({ id, connectUrl: `${c.env.APP_URL}/connect/${token}` }, 201);
  })
  .delete("/connections/:id", editorsOnly, async (c) => {
    assertInstagramOrigin(c);
    const auth = workspaceCtx(c), db = c.var.db;
    const row = await db.select().from(igConnections).where(and(eq(igConnections.id, c.req.param("id")), eq(igConnections.workspaceId, auth.workspace.id))).get();
    if (!row) throw new ApiError(404, "connection_not_found", "연결을 찾을 수 없어요.");
    const at = now();
    const updated = await db.all<{ id: string }>(sql`UPDATE ig_connections SET generation=${newToken(18)},revoked_at=${at},disconnected_at=${at},disconnected_reason='manual',token_enc=NULL,
      connect_token=CASE WHEN target='client_brand' THEN NULL ELSE connect_token END WHERE id=${row.id} AND generation=${row.generation} AND workspace_id=${auth.workspace.id}
      AND ${instagramEditorPredicate(auth, auth.workspace.id)} RETURNING id`);
    if (!updated.length) throw new ApiError(409, "connection_changed", "연결 상태가 바뀌었어요. 화면을 새로 열어 주세요.");
    await logEvent(db, auth.workspace.id, "ig_connect_revoked", { target: row.target });
    return c.json({ ok: true });
  })
  .get("/media", async (c) => {
    const { workspace } = workspaceCtx(c);
    const connection = await brandSender(c.var.db, workspace.id), key = tokenKey(c.env);
    const state = igConnectionState(connection);
    if (!connection || !state.connected || !key) {
      if (connection && igGrantVerified(connection) && (state.reason === "expired" || state.reason === "token_missing")) await disconnectIgConnection(c.env, c.var.db, connection, state.reason);
      return c.json({ media: [], reason: state.reason ?? "not_connected" });
    }
    try {
      const response = await recentMedia(c.env, await decryptToken(key, connection.tokenEnc!));
      if (!response.ok) {
        const reason = definitiveIgDisconnect(response);
        if (reason) await disconnectIgConnection(c.env, c.var.db, connection, reason);
      }
      return c.json(response.ok ? { media: response.data, reason: null } : { media: [], reason: response.reason });
    } catch { return c.json({ media: [], reason: "api_error" }); }
  });

// 댓글 웹훅 (F-64). GET 은 구독 확인, POST 는 서명 확인 후 comments 처리
export const igWebhookRoutes = new Hono<AppEnv>()
  .get("/instagram", (c) => {
    const mode = c.req.query("hub.mode");
    const token = c.req.query("hub.verify_token");
    if (mode === "subscribe" && c.env.META_VERIFY_TOKEN && token === c.env.META_VERIFY_TOKEN) return c.text(c.req.query("hub.challenge") ?? "");
    return c.text("forbidden", 403);
  })
  .post("/instagram", async (c) => {
    const raw = await c.req.text();
    if (!(await verifySignature(c.env, raw, c.req.header("x-hub-signature-256")))) return c.text("invalid signature", 401);
    const body = JSON.parse(raw) as { entry?: { id: string; time?: number; changes?: { field: string; value: IgComment }[] }[] };
    const work = async () => {
      for (const e of body.entry ?? []) {
        for (const ch of e.changes ?? []) {
          if (ch.field !== "comments" || !ch.value?.id || !ch.value.media?.id || !ch.value.from?.id) continue;
          await handleComment(c.var.db, c.env, e.id, { ...ch.value, text: ch.value.text ?? "" }, e.time ? e.time * 1000 : now());
        }
      }
    };
    c.executionCtx.waitUntil(work().catch((err: unknown) => console.error("[webhook:instagram]", err)));
    return c.text("ok");
  });
