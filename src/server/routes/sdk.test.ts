import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { sdkRoutes } from "./sdk";
import manifest from "../../../sdk/releases/manifest.json";
import { createSqliteD1, type TestSqlite } from "../test/sqlite-d1";

const databases: TestSqlite[] = [];
afterEach(() => { databases.splice(0).forEach((db) => db.close()); vi.restoreAllMocks(); });
const archive = (name: string) => new Uint8Array(readFileSync(new NodeURL(`../../../sdk/releases/${name}`, import.meta.url)));
function object(bytes: Uint8Array): R2ObjectBody {
  return { size: bytes.byteLength, body: new Response(bytes).body!, arrayBuffer: async () => bytes.slice().buffer } as R2ObjectBody;
}
async function setup() {
  const { db, d1 } = await createSqliteD1(); databases.push(db);
  db.exec("INSERT INTO workspaces(id,name,created_at) VALUES('w','SDK',1)");
  db.exec(`INSERT INTO sites(id,workspace_id,site_key,name,allowed_domains,consent_mode,created_at) VALUES('s','w','site_test','Shop','["shop.example.com"]','require',1)`);
  const objects = new Map<string, Uint8Array>();
  let race: (() => void) | undefined;
  const get = vi.fn(async (key: string) => objects.has(key) ? object(objects.get(key)!) : null);
  const put = vi.fn(async (key: string, bytes: Uint8Array, options: R2PutOptions) => {
    expect(options.onlyIf).toBeInstanceOf(Headers);
    expect((options.onlyIf as Headers).get("If-None-Match")).toBe("*");
    race?.();
    if (objects.has(key)) return null;
    objects.set(key, bytes.slice()); return { key } as R2Object;
  });
  const fetchAsset = vi.fn(async (request: Request) => {
    expect(request.redirect).toBe("manual"); expect(request.headers.has("authorization")).toBe(false); expect(request.headers.has("cookie")).toBe(false);
    return new Response(archive(new URL(request.url).pathname.split("/").at(-1)!));
  });
  const env = { DB: d1, FILES: { get, put }, ASSETS: { fetch: fetchAsset } } as unknown as Env;
  const app = new Hono<AppEnv>(); app.route("/sdk", sdkRoutes);
  const call = (path: string, init?: RequestInit) => app.request(`https://app.example.com/sdk/${path}`, init, env);
  return { db, call, get, put, fetchAsset, objects, setRace: (value: () => void) => { race = value; } };
}

describe("공개 SDK 동의 설정", () => {
  it("허용 Origin에 공개 site/동의 모드만 no-store로 반환한다", async () => {
    const { call, get } = await setup(); const response = await call("config?site=site_test", { headers: { Origin: "https://shop.example.com" } });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ site: "site_test", consentMode: "require" });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://shop.example.com"); expect(response.headers.get("Vary")).toBe("Origin"); expect(response.headers.get("Cache-Control")).toBe("no-store"); expect(response.headers.has("Set-Cookie")).toBe(false); expect(get).not.toHaveBeenCalled();
  });
  it.each([undefined, "null", "https://evil.example.com"])("허용하지 않은 Origin %s 를 거부한다", async (origin) => {
    const { call } = await setup(); expect((await call("config?site=site_test", { headers: origin ? { Origin: origin } : {} })).status).toBe(403);
  });
  it("설정 변경은 다음 요청에 반영하고 삭제/재발급된 키는 404다", async () => {
    const { db, call } = await setup(), headers = { Origin: "https://shop.example.com" };
    db.exec("UPDATE sites SET consent_mode='auto'"); expect(await (await call("config?site=site_test", { headers })).json()).toEqual({ site: "site_test", consentMode: "auto" });
    db.exec("UPDATE sites SET site_key='rotated'"); expect((await call("config?site=site_test", { headers })).status).toBe(404);
    db.exec("UPDATE sites SET deleted_at=2"); expect((await call("config?site=rotated", { headers })).status).toBe(404);
  });
});

describe("불변 SDK 파일", () => {
  it.each(["v1.0.0.js", "v1.0.0.mjs"])("%s 는 exact bundle bytes만 조건부 archive하고 CORS/immutable로 서빙한다", async (name) => {
    const { call, put, fetchAsset } = await setup(); const response = await call(name, { headers: { Authorization: "private", Cookie: "sid=private" } });
    expect(response.status).toBe(200); expect(new Uint8Array(await response.arrayBuffer())).toEqual(archive(name));
    expect(response.headers.get("Cache-Control")).toContain("immutable"); expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*"); expect(response.headers.get("Content-Type")).toContain("javascript"); expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff"); expect(put).toHaveBeenCalledTimes(1); expect(fetchAsset).toHaveBeenCalledTimes(1);
    expect((await call(name, { method: "HEAD" })).body).toBeNull(); expect(put).toHaveBeenCalledTimes(1);
  });
  it("동시 생성은 conditional create로 경합하고 같은 해시만 재사용한다", async () => {
    const { call, objects, setRace, put } = await setup(); setRace(() => objects.set("sdk-releases/v1.0.0.js", archive("v1.0.0.js")));
    const responses = await Promise.all([call("v1.0.0.js"), call("v1.0.0.js")]); expect(responses.map((r) => r.status)).toEqual([200, 200]); expect(put).toHaveBeenCalled();
  });
  it.each(["existing", "race"])("%s 객체 해시 불일치는 overwrite/fallback 없이 503으로 닫는다", async (kind) => {
    const { call, objects, setRace, put, fetchAsset } = await setup(); const bad = archive("v1.0.0.js"); bad[0] = bad[0]! ^ 1;
    if (kind === "existing") objects.set("sdk-releases/v1.0.0.js", bad); else setRace(() => objects.set("sdk-releases/v1.0.0.js", bad));
    const response = await call("v1.0.0.js"); expect(response.status).toBe(503); expect(await response.text()).toBe(""); expect(objects.get("sdk-releases/v1.0.0.js")).toEqual(bad);
    if (kind === "existing") { expect(put).not.toHaveBeenCalled(); expect(fetchAsset).not.toHaveBeenCalled(); }
  });
  it.each([new Response("redirect", { status: 302 }), new Response("SPA html"), new Response("x".repeat(20_000))])("bundled asset redirect/해시/크기 오류는 archive하지 않는다 %#", async (asset) => {
    const { call, fetchAsset, put } = await setup(); fetchAsset.mockResolvedValue(asset);
    expect((await call("v1.0.0.js")).status).toBe(503); expect(put).not.toHaveBeenCalled();
  });
  it.each(["v99.0.0.js", "v1.0.0.js.map", "v01.0.0.js", "v99.js", "unknown", "v1.0.0.js%2Fother"])("알 수 없는 %s 는 latest/SPA로 fallback하지 않는다", async (name) => {
    const { call, get, put, fetchAsset } = await setup(); expect((await call(name)).status).toBe(404); expect(get).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled(); expect(fetchAsset).not.toHaveBeenCalled();
  });
  it("latest alias만 재검증 cache이며 pinned ETag는 304를 지원한다", async () => {
    const { call } = await setup(); const alias = await call("v1.js"); expect(alias.status).toBe(200); expect(alias.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
    expect(new Uint8Array(await alias.arrayBuffer())).toEqual(archive(`v${manifest.latest["1"]}.js`));
    const pinned = await call("v1.0.0.js"), etag = pinned.headers.get("ETag")!;
    const cached = await call("v1.0.0.js", { headers: { "If-None-Match": etag } }); expect(cached.status).toBe(304); expect(cached.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
