import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyIgFailure, discoverMedia, mediaById, mediaMatches, type DiscoveryAuth } from "./instagram";

const env = {} as Env;
const auth: DiscoveryAuth = { host: "fb", token: "FB_TEST_TOKEN", igUserId: "system-user" };
const media = { id: "cached-id", permalink: "https://www.instagram.com/reel/OLD/", timestamp: "2026-10-01T00:00:00Z", media_type: "VIDEO", view_count: 0, like_count: 12, comments_count: 3 };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const provider = (body: unknown = media, status = 200) => {
  const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.redirect === "error") throw new TypeError("Workers does not support redirect:error");
    return Response.json(body, { status });
  });
  vi.stubGlobal("fetch", fetch); return fetch;
};

describe("미디어 조회 실패와 물리 삭제를 구별한다", () => {
  it.each([
    [400, 100, 33, false, "private_or_unavailable"], [404, 100, 33, false, "private_or_unavailable"],
    [400, 190, undefined, false, "token_expired"], [429, 190, undefined, false, "api_error"],
    [503, 100, 33, false, "api_error"], [400, 100, 33, true, "api_error"],
    [400, 10, undefined, false, "not_supported"], [400, 200, undefined, false, "not_supported"],
    [404, undefined, undefined, false, "api_error"],
  ])("HTTP%s code%s/sub%s transient%s는 %s이며 deleted가 아니다", (status, code, subcode, transient, reason) => {
    const result = classifyIgFailure(Number(status), { error: { code: code as number | undefined, error_subcode: subcode as number | undefined, is_transient: Boolean(transient) } });
    expect(result.reason).toBe(reason); expect(result.reason).not.toBe("deleted");
  });
});

describe("known media ID의 고정 host·token·게시물 정합성", () => {
  it.each(["fb", "ig"] as const)("%s host와 해당 token만 사용하고 다른 API로 redirect하지 않는다", async (host) => {
    const fetch = provider(); const result = await mediaById(env, { ...auth, host, token: `${host}-ONLY-TOKEN` }, "cached-id", "OLD");
    expect(result.ok).toBe(true); const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.hostname).toBe(host === "fb" ? "graph.facebook.com" : "graph.instagram.com"); expect(url.pathname).toBe("/v26.0/cached-id");
    expect(url.searchParams.get("access_token")).toBe(`${host}-ONLY-TOKEN`); expect(fetch.mock.calls[0]![1]?.redirect).toBe("manual");
    if (host === "ig") expect(url.searchParams.get("fields")).not.toMatch(/like_count|comments_count|view_count/);
    else expect(url.searchParams.get("fields")).toContain("view_count");
    if (result.ok) expect(result.data.view_count).toBe(0);
  });

  it.each([
    { id: "different-id" }, { permalink: "https://www.instagram.com/reel/OLDER/" }, { permalink: "https://evilinstagram.com/reel/OLD/" },
    { permalink: "http://www.instagram.com/reel/OLD/" }, { permalink: "https://user:pass@www.instagram.com/reel/OLD/" },
    { timestamp: "invalid" }, { like_count: -1 }, { view_count: "123" }, { media_type: 5 }, { view_count: 0.5 }, { like_count: Number.MAX_SAFE_INTEGER + 1 },
  ])("HTTP 성공이어도 다른 게시물이나 잘못된 행을 채택하지 않는다: %j", async (patch) => {
    provider({ ...media, ...patch }); expect(await mediaById(env, auth, "cached-id", "OLD")).toEqual({ ok: false, reason: "invalid_response" });
  });

  it.each(["../me", "https://evil.example/123", "a/b", "id?fields=private", ""])("ID %s는 HTTP 전에 거절한다", async (id) => {
    const fetch = provider(); expect((await mediaById(env, auth, id, "OLD")).ok).toBe(false); expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["fb.evil", "", "facebook"])("알 수 없는 host %s에 token을 보내지 않는다", async (host) => {
    const fetch = provider(); expect((await mediaById(env, { ...auth, host } as DiscoveryAuth, "cached-id", "OLD")).ok).toBe(false); expect(fetch).not.toHaveBeenCalled();
  });

  it("생략되거나 null인 지표를 0으로 추정하지 않는다", async () => {
    provider({ id: media.id, permalink: media.permalink, timestamp: media.timestamp, like_count: null });
    const result = await mediaById(env, auth, "cached-id", "OLD"); expect(result.ok).toBe(true);
    if (result.ok) { expect(result.data).not.toHaveProperty("like_count"); expect(result.data).not.toHaveProperty("view_count"); }
  });

  it("네트워크 오류에 포함된 token과 URL을 로그에 남기지 않는다", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {}); const fetch = provider(); fetch.mockRejectedValue(new Error("private-token-in-request-url"));
    const result = await mediaById(env, auth, "cached-id", "OLD"); expect(result).toMatchObject({ ok: false, reason: "api_error", transient: true });
    expect(JSON.stringify(result)).not.toContain("private-token-in-request-url"); expect(log).not.toHaveBeenCalled();
  });

  it("shortcode는 완전히 일치해야 하며 명시된 ID가 달라도 거절한다", () => {
    expect(mediaMatches(media, "OLD", "cached-id")).toBe(true); expect(mediaMatches(media, "OL", "cached-id")).toBe(false); expect(mediaMatches(media, "OLD", "other")).toBe(false);
  });

  it.each([301, 302, 307, 308])("Graph HTTP%s는 다른 주소로 credentials를 전달하지 않는다", async (status) => {
    const fetch = provider({ ...media }, status);
    expect(await mediaById(env, auth, "cached-id", "OLD")).toMatchObject({ ok: false, reason: "api_error" });
    expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0]![1]?.redirect).toBe("manual");
  });
});

describe("recent50의 미발견을 pagination 완료나 삭제로 오인하지 않는다", () => {
  it.each([false, true])("paging.next=%s여도 51번째 게시물을 deleted로 바꾸거나 next URL을 따라가지 않는다", async (next) => {
    const recent = Array.from({ length: 50 }, (_, n) => ({ ...media, id: `recent-${n}`, permalink: `https://www.instagram.com/reel/RECENT${n}/` }));
    const fetch = provider({ business_discovery: { media: { data: recent, ...(next ? { paging: { next: "https://evil.example/?access_token=SHOULD_NOT_LEAK", cursors: { after: "untrusted-cursor" } } } : {}) } } });
    expect(await discoverMedia(env, auth, "creator", "OLD")).toEqual({ ok: true, data: null }); expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]![0])).not.toContain("evil.example");
  });

  it.each([{}, { business_discovery: {} }, { business_discovery: { media: { data: {} } } }, { business_discovery: { media: { data: Array.from({ length: 51 }, () => media) } } }])("잘못된 성공 응답을 빈 목록으로 변환하지 않는다", async (body) => {
    provider(body); expect(await discoverMedia(env, auth, "creator", "OLD")).toEqual({ ok: false, reason: "invalid_response" });
  });

  it("Graph fields로의 handle 주입과 잘못된 shortcode를 HTTP 전에 거절한다", async () => {
    const fetch = provider(); expect((await discoverMedia(env, auth, "creator){private_field}", "OLD")).ok).toBe(false);
    expect((await discoverMedia(env, auth, "creator", "bad?code")).ok).toBe(false); expect(fetch).not.toHaveBeenCalled();
  });

  it("최근 목록에서 정확히 일치하는 게시물만 채택한다", async () => {
    provider({ business_discovery: { media: { data: [{ ...media, permalink: "https://www.instagram.com/reel/OLDER/" }, media] } } });
    expect(await discoverMedia(env, auth, "@creator", "OLD")).toEqual({ ok: true, data: media });
  });
});
