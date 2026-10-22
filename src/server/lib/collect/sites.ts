import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../../db";
import { sites } from "../../db/schema";

// 워크스페이스의 살아 있는 사이트 허용 도메인 전체
export async function workspaceSiteDomains(db: Db, workspaceId: string): Promise<string[]> {
  const rows = await db.select({ domains: sites.allowedDomains }).from(sites).where(and(eq(sites.workspaceId, workspaceId), isNull(sites.deletedAt)));
  return rows.flatMap((r) => r.domains);
}
