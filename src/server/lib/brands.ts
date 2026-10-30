import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db";
import { brands, campaigns, guides, workspaces } from "../db/schema";
import { ApiError } from "./errors";
import { newId, now } from "./ids";
import { findLive } from "./owned";

export { brandDeleteBlock } from "../../shared/campaigns";

// 브랜드·캠페인 공용 (TASK-070). 캠페인과 브랜드 가이드는 1:1 이고 id 를 같게 쓴다

// 인플루언서·리드 방문자에게 보이는 브랜드 이름. 캠페인 브랜드가 없으면 워크스페이스 이름
export const resolveBrandName = (brandName: string | null | undefined, workspaceName: string) => brandName?.trim() || workspaceName;

// 가이드(캠페인)에 붙은 브랜드 이름. guideId 가 없으면 워크스페이스 이름
export async function brandNameOf(db: Db, workspaceId: string, guideId: string | null | undefined): Promise<string> {
  const row = await db
    .select({ workspaceName: workspaces.name, brandName: brands.name })
    .from(workspaces)
    .leftJoin(guides, and(eq(guides.id, guideId ?? ""), eq(guides.workspaceId, workspaces.id)))
    .leftJoin(campaigns, eq(campaigns.id, guides.campaignId))
    .leftJoin(brands, and(eq(brands.id, campaigns.brandId), isNull(brands.deletedAt)))
    .where(eq(workspaces.id, workspaceId))
    .get();
  return row ? resolveBrandName(row.brandName, row.workspaceName) : "";
}

// 새 워크스페이스의 기본 브랜드. db.batch 안에 넣을 수 있게 문장만 돌려준다
export const defaultBrandInsert = (db: Db, workspaceId: string, name: string) => db.insert(brands).values({ id: newId(), workspaceId, name, createdAt: now() });

export const findBrand = (db: Db, workspaceId: string, id: string) => findLive(db, brands, id, workspaceId, { code: "brand_not_found", message: "브랜드를 찾을 수 없어요." });

// 가장 먼저 만든 브랜드. 없으면(이관 뒤 만든 워크스페이스 등) 워크스페이스 이름으로 만든다
export async function defaultBrandId(db: Db, workspaceId: string): Promise<string> {
  const first = await db.select({ id: brands.id }).from(brands).where(and(eq(brands.workspaceId, workspaceId), isNull(brands.deletedAt))).orderBy(asc(brands.createdAt)).get();
  if (first) return first.id;
  const ws = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId)).get();
  if (!ws) throw new ApiError(404, "workspace_not_found", "워크스페이스를 찾을 수 없어요.");
  const row = await defaultBrandInsert(db, workspaceId, ws.name).returning({ id: brands.id }).get();
  return row.id;
}

// 가이드와 같은 id 로 캠페인을 만든다. 가이드 insert 와 함께 batch 로 넣는다
export const campaignInsert = (db: Db, v: { id: string; workspaceId: string; brandId: string; name: string }) =>
  db.insert(campaigns).values({ ...v, status: "active", createdAt: now(), updatedAt: now() });

// 가이드 상세 머리에 보이는 캠페인·브랜드
export async function campaignOf(db: Db, campaignId: string | null) {
  if (!campaignId) return null;
  const row = await db
    .select({ id: campaigns.id, name: campaigns.name, status: campaigns.status, brandId: campaigns.brandId, brandName: brands.name })
    .from(campaigns)
    .innerJoin(brands, eq(brands.id, campaigns.brandId))
    .where(eq(campaigns.id, campaignId))
    .get();
  return row ?? null;
}
