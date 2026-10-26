import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { AppEnv } from "../types";
import type { Db } from "../db";
import { guideInfluencers, guides, igConnections, influencers, workspaces } from "../db/schema";
import { ApiError, parse } from "../lib/errors";
import { base64url, fromBase64url, newId, newToken, now } from "../lib/ids";
import { logEvent } from "../lib/events";
import { decryptToken, encryptToken, hmacHex, safeEqual } from "../lib/crypto";
import { authorizeUrl, exchangeCode, igConfigured, isFake, recentMedia, tokenKey, verifySignature } from "../lib/instagram";
import { handleComment, type IgComment } from "../lib/keyword-dm";
import { editorsOnly, workspaceCtx } from "../middleware/auth";
import { IG_SCOPES, type IgTarget } from "../../shared/performance";

// OAuth state = base64url(JSON) + "." + HMAC. 10분 유효
type State = { t: IgTarget; k: string | null; w: string; e: number };
const stateSecret = (env: Env) => env.META_APP_SECRET || env.TOKEN_ENC_KEY || "dev-only-state-secret";
async function signState(env: Env, s: State) {
  const body = base64url(new TextEncoder().encode(JSON.stringify(s)));
  return `${body}.${await hmacHex(stateSecret(env), body)}`;
}
async function readState(env: Env, raw: string): Promise<State | null> {
  const [body, sig] = raw.split(".");
  if (!body || !sig || !safeEqual(sig, await hmacHex(stateSecret(env), body))) return null;
  const s = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as State;
  return s.e > now() ? s : null;
}

// 공개 연결 토큰 → 대상. influencer 는 guide_influencers.connect_token, client_brand 는 ig_connections.connect_token
async function resolveConnectToken(db: Db, token: string) {
  const gi = await db
    .select({ influencerId: guideInfluencers.influencerId, ws: guides.workspaceId, name: influencers.displayName, lang: influencers.lang, wsName: workspaces.name })
    .from(guideInfluencers)
    .innerJoin(guides, eq(guides.id, guideInfluencers.guideId))
    .innerJoin(influencers, eq(influencers.id, guideInfluencers.influencerId))
    .innerJoin(workspaces, eq(workspaces.id, guides.workspaceId))
    .where(eq(guideInfluencers.connectToken, token))
    .get();
  if (gi) {
    const conn = await db
      .select()
      .from(igConnections)
      .where(and(eq(igConnections.workspaceId, gi.ws), eq(igConnections.influencerId, gi.influencerId), eq(igConnections.target, "influencer"), isNull(igConnections.revokedAt)))
      .get();
    return { target: "influencer" as const, workspaceId: gi.ws, workspaceName: gi.wsName, influencerId: gi.influencerId, name: gi.name, lang: gi.lang, conn: conn ?? null };
  }
  const cb = await db.select({ conn: igConnections, wsName: workspaces.name }).from(igConnections).innerJoin(workspaces, eq(workspaces.id, igConnections.workspaceId)).where(eq(igConnections.connectToken, token)).get();
  if (cb && !cb.conn.revokedAt) return { target: "client_brand" as const, workspaceId: cb.conn.workspaceId, workspaceName: cb.wsName, influencerId: null, name: cb.conn.label ?? "", lang: "ko" as const, conn: cb.conn };
  throw new ApiError(404, "connect_not_found", "연결 링크를 찾을 수 없어요.");
}

const publicConn = (c: typeof igConnections.$inferSelect) => ({
  id: c.id,
  target: c.target,
  label: c.label,
  username: c.username,
  accountType: c.accountType,
  scopes: c.scopes,
  connected: Boolean(c.connectedAt && !c.revokedAt),
  expired: Boolean(c.connectedAt && (c.expiresAt ?? 0) < now()),
  connectedAt: c.connectedAt,
  expiresAt: c.expiresAt,
  revokedAt: c.revokedAt,
  influencerId: c.influencerId,
});

export async function brandSender(db: Db, workspaceId: string) {
  return (
    (await db
      .select()
      .from(igConnections)
      .where(and(eq(igConnections.workspaceId, workspaceId), eq(igConnections.target, "brand_sender"), isNull(igConnections.revokedAt)))
      .orderBy(desc(igConnections.connectedAt))
      .get()) ?? null
  );
}

// 같은 대상의 기존 연결이 있으면 갱신한다 (인플루언서 본인, 대행 브랜드 요청, 브랜드 발송 계정)
async function existingConnection(db: Db, state: State): Promise<{ existing: typeof igConnections.$inferSelect | null; influencerId: string | null }> {
  if (state.t === "influencer") {
    const { influencerId } = await resolveConnectToken(db, state.k!);
    const existing = await db.select().from(igConnections).where(and(eq(igConnections.workspaceId, state.w), eq(igConnections.influencerId, influencerId!), eq(igConnections.target, "influencer"))).get();
    return { existing: existing ?? null, influencerId };
  }
  if (state.t === "client_brand") return { existing: (await db.select().from(igConnections).where(eq(igConnections.connectToken, state.k!)).get()) ?? null, influencerId: null };
  return { existing: await brandSender(db, state.w), influencerId: null };
}

export const igRoutes = new Hono<AppEnv>()
  .get("/status", (c) => c.json({ configured: igConfigured(c.env), fake: isFake(c.env) }))
  // 공개 연결 안내 화면 (F-54)
  .get("/connect/:token", async (c) => {
    const t = await resolveConnectToken(c.var.db, c.req.param("token"));
    await logEvent(c.var.db, t.workspaceId, "ig_connect_viewed", { target: t.target });
    return c.json({
      target: t.target,
      name: t.name,
      lang: t.lang,
      agencyName: t.target === "client_brand" ? t.workspaceName : null,
      brandName: t.workspaceName,
      configured: igConfigured(c.env),
      connected: Boolean(t.conn?.connectedAt && !t.conn.revokedAt),
      username: t.conn?.username ?? null,
      scopes: IG_SCOPES[t.target],
    });
  })
  .get("/oauth/start", async (c) => {
    const target = c.req.query("target") as IgTarget | undefined;
    const token = c.req.query("token") ?? null;
    let back = "/dashboard/settings/integrations";
    let ws: string;
    if (target === "brand_sender") {
      const ctx = workspaceCtx(c);
      if (ctx.role !== "owner" && ctx.role !== "editor") throw new ApiError(403, "forbidden", "이 작업을 할 권한이 없어요.");
      ws = ctx.workspace.id;
    } else if ((target === "influencer" || target === "client_brand") && token) {
      const t = await resolveConnectToken(c.var.db, token);
      ws = t.workspaceId;
      back = `/connect/${token}`;
    } else throw new ApiError(400, "invalid_target", "연결 대상을 확인해 주세요.");
    if (!igConfigured(c.env)) return c.redirect(`${back}?error=not_configured`);
    const state = await signState(c.env, { t: target, k: token, w: ws, e: now() + 10 * 60_000 });
    return c.redirect(authorizeUrl(c.env, state, IG_SCOPES[target]));
  })
  .get("/oauth/callback", async (c) => {
    const db = c.var.db;
    const state = await readState(c.env, c.req.query("state") ?? "");
    if (!state) return c.redirect("/dashboard/settings/integrations?error=invalid_state");
    const back = state.t === "brand_sender" ? "/dashboard/settings/integrations" : `/connect/${state.k}`;
    const code = c.req.query("code");
    if (!code) {
      await logEvent(db, state.w, "ig_connect_failed", { reason: c.req.query("error") ?? "denied", target: state.t });
      return c.redirect(`${back}?error=denied`);
    }
    const r = await exchangeCode(c.env, code);
    if (!r.ok) {
      await logEvent(db, state.w, "ig_connect_failed", { reason: r.reason, target: state.t });
      return c.redirect(`${back}?error=${r.reason}`);
    }
    const a = r.data;
    // 개인 계정은 인사이트를 못 받는다 (F-54 예외)
    if (a.accountType && !["BUSINESS", "MEDIA_CREATOR", "CREATOR"].includes(a.accountType.toUpperCase())) {
      await logEvent(db, state.w, "ig_connect_failed", { reason: "personal_account", target: state.t });
      return c.redirect(`${back}?error=personal_account`);
    }
    const values = {
      igUserId: a.igUserId,
      username: a.username,
      accountType: a.accountType,
      scopes: IG_SCOPES[state.t],
      tokenEnc: await encryptToken(tokenKey(c.env)!, a.token),
      expiresAt: a.expiresAt,
      revokedAt: null,
      connectedAt: now(),
    };
    const { existing, influencerId } = await existingConnection(db, state);
    if (existing) await db.update(igConnections).set(values).where(eq(igConnections.id, existing.id));
    else await db.insert(igConnections).values({ id: newId(), workspaceId: state.w, influencerId, target: state.t, createdAt: now(), ...values });
    await logEvent(db, state.w, "ig_connect_completed", { account_type: a.accountType, target: state.t });
    return c.redirect(`${back}?done=1`);
  })
  // 브랜드 화면용
  .get("/connections", async (c) => {
    const { workspace } = workspaceCtx(c);
    const rows = await c.var.db.select().from(igConnections).where(eq(igConnections.workspaceId, workspace.id)).orderBy(desc(igConnections.createdAt));
    return c.json({
      configured: igConfigured(c.env),
      fake: isFake(c.env),
      connections: rows.map((r) => ({ ...publicConn(r), connectUrl: r.connectToken ? `${c.env.APP_URL}/connect/${r.connectToken}` : null })),
    });
  })
  // 대행사 → 고객사 계정 연결 요청 링크
  .post("/connections/client-request", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    const body = parse(z.object({ label: z.string().trim().min(1).max(80) }), await c.req.json());
    const row = { id: newId(), workspaceId: workspace.id, target: "client_brand" as const, connectToken: newToken(), label: body.label, scopes: IG_SCOPES.client_brand, createdAt: now() };
    await c.var.db.insert(igConnections).values(row);
    await logEvent(c.var.db, workspace.id, "ig_connect_link_sent", { target: "client_brand" });
    return c.json({ id: row.id, connectUrl: `${c.env.APP_URL}/connect/${row.connectToken}` }, 201);
  })
  .delete("/connections/:id", editorsOnly, async (c) => {
    const { workspace } = workspaceCtx(c);
    const row = await c.var.db.select().from(igConnections).where(and(eq(igConnections.id, c.req.param("id")), eq(igConnections.workspaceId, workspace.id))).get();
    if (!row) throw new ApiError(404, "connection_not_found", "연결을 찾을 수 없어요.");
    await c.var.db.update(igConnections).set({ revokedAt: now(), tokenEnc: null }).where(eq(igConnections.id, row.id));
    await logEvent(c.var.db, workspace.id, "ig_connect_revoked", { target: row.target });
    return c.json({ ok: true });
  })
  // 브랜드 계정 최근 게시물 (키워드 DM 게시물 선택)
  .get("/media", async (c) => {
    const { workspace } = workspaceCtx(c);
    const conn = await brandSender(c.var.db, workspace.id);
    const key = tokenKey(c.env);
    if (!conn?.tokenEnc || !conn.connectedAt || !key) return c.json({ media: [], reason: "not_connected" });
    const r = await recentMedia(c.env, await decryptToken(key, conn.tokenEnc));
    return c.json(r.ok ? { media: r.data, reason: null } : { media: [], reason: r.reason });
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
