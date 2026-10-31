import { sql } from "drizzle-orm";
import type { Db } from "../db";
import { contents, type Content } from "../db/schema";
import { now } from "./ids";

export const COLLECTION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export type CollectionStoppedReason = "campaign_ended" | "campaign_end_unknown" | "campaign_missing";
export type CampaignCollection = { status: string; endsAt: number | null };

export function collectionState(campaign: CampaignCollection | null, at = now()): { endsAt: number | null; stoppedReason: CollectionStoppedReason | null } {
  if (!campaign) return { endsAt: null, stoppedReason: "campaign_missing" };
  if (campaign.endsAt !== null) {
    const endsAt = campaign.endsAt + COLLECTION_GRACE_MS;
    return { endsAt, stoppedReason: at >= endsAt ? "campaign_ended" : null };
  }
  return { endsAt: null, stoppedReason: campaign.status === "active" ? null : "campaign_end_unknown" };
}

export type ContentIdentity = Pick<Content, "id" | "url" | "collectionRevision">;

// URL 세대와 현재 캠페인 정책을 최종 쓰기 시점에도 검사한다. 업로드 마감일은 종료일로 추정하지 않는다.
export const collectionAllowed = (content: ContentIdentity, workspaceId: string, at = now()) => sql`EXISTS (
  SELECT 1 FROM contents cc JOIN guides cg ON cg.id = cc.guide_id
  JOIN campaigns cp ON cp.id = cg.campaign_id AND cp.workspace_id = cg.workspace_id
  WHERE cc.id = ${content.id} AND cc.url = ${content.url} AND cc.collection_revision = ${content.collectionRevision}
    AND cc.deleted_at IS NULL AND cg.workspace_id = ${workspaceId}
    AND ((cp.ends_at IS NULL AND cp.status = 'active') OR (cp.ends_at IS NOT NULL AND cp.ends_at + ${COLLECTION_GRACE_MS} > ${at}))
)`;

export async function collectionContent(db: Db, contentId: string) {
  const rows = await db.all<{ workspaceId: string; status: string | null; endsAt: number | null }>(sql`
    SELECT g.workspace_id AS workspaceId, p.status, p.ends_at AS endsAt FROM contents c JOIN guides g ON g.id = c.guide_id
    LEFT JOIN campaigns p ON p.id = g.campaign_id AND p.workspace_id = g.workspace_id WHERE c.id = ${contentId} AND c.deleted_at IS NULL`);
  const row = rows[0];
  if (!row) return null;
  const content = await db.select().from(contents).where(sql`${contents.id} = ${contentId} AND ${contents.deletedAt} IS NULL`).get();
  if (!content) return null;
  return { content, workspaceId: row.workspaceId, state: collectionState(row.status ? { status: row.status, endsAt: row.endsAt } : null) };
}
