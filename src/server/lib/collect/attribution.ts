import type { AttributionTouch, Envelope } from "../../../shared/sdk-events";
import type { SessionMatch } from "../../db/schema";

// 새 세션의 링크 연결 (docs/14 4-1, 4-3). 클릭 ID 가 먼저, 없으면 UTM 역매칭(한 링크로 유일할 때만)

export type SessionAttribution = { linkId: string | null; clickToken: string | null; match: SessionMatch; isMember: boolean };
const NONE: SessionAttribution = { linkId: null, clickToken: null, match: "none", isMember: false };

// 세션 귀속은 마지막 터치(last non-direct). 없으면 첫 터치
export const touchOf = (env: Envelope): AttributionTouch | null => env.attr.last ?? env.attr.first;

async function byClickToken(db: D1Database, workspaceId: string, token: string): Promise<SessionAttribution | null> {
  const row = await db
    .prepare("SELECT c.link_id AS linkId, c.is_member AS isMember FROM link_clicks c JOIN short_links l ON l.id = c.link_id WHERE c.click_token = ? AND l.workspace_id = ?")
    .bind(token, workspaceId)
    .first<{ linkId: string; isMember: number }>();
  return row ? { linkId: row.linkId, clickToken: token, match: "click", isMember: row.isMember === 1 } : null;
}

// F-50 UTM 배치: campaign = 가이드 슬러그, content = 인플루언서 핸들, term = 채널 ID. 링크의 utm json 과 그대로 비교한다
async function byUtm(db: D1Database, workspaceId: string, utm: AttributionTouch["utm"]): Promise<SessionAttribution | null> {
  if (!utm.campaign || !utm.content || !utm.term) return null;
  const { results } = await db
    .prepare(
      "SELECT id FROM short_links WHERE workspace_id = ? AND json_extract(utm, '$.campaign') = ? AND json_extract(utm, '$.content') = ? AND json_extract(utm, '$.term') = ? LIMIT 2",
    )
    .bind(workspaceId, utm.campaign, utm.content, utm.term)
    .all<{ id: string }>();
  const only = results.length === 1 ? results[0] : undefined;
  return only ? { linkId: only.id, clickToken: null, match: "utm", isMember: false } : null;
}

export async function resolveAttribution(db: D1Database, workspaceId: string, env: Envelope): Promise<SessionAttribution> {
  const touch = touchOf(env);
  if (!touch) return NONE;
  const byClick = touch.clickId ? await byClickToken(db, workspaceId, touch.clickId) : null;
  return byClick ?? (await byUtm(db, workspaceId, touch.utm)) ?? NONE;
}
