import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db";
import { documents, forms, linkClicks, shortLinks } from "../db/schema";

type Link = Pick<typeof shortLinks.$inferSelect, "id" | "workspaceId" | "destinationType" | "destinationId">;

// 폼 뒤에 자료가 있으면 그 자료까지 도달하는 클릭으로 기록한다. 나중에 링크·폼을 고쳐도 이 값은 바뀌지 않는다.
export async function clickDestinationSnapshot(db: Db, link: Link) {
  if (link.destinationType === "form" && link.destinationId) {
    const form = await db.select({ after: forms.afterSubmit }).from(forms)
      .where(and(eq(forms.id, link.destinationId), eq(forms.workspaceId, link.workspaceId), isNull(forms.deletedAt))).get();
    if (form?.after.type === "document" && form.after.documentId) return { destinationType: "document" as const, destinationId: form.after.documentId };
  }
  return { destinationType: link.destinationType, destinationId: link.destinationId };
}

// 브라우저가 보내 준 avc는 신뢰하지 않는다. 다른 링크·워크스페이스·목적지, 봇·구성원·과거 클릭은 연결하지 않는다.
export async function documentClickToken(db: Db, link: Pick<Link, "id" | "workspaceId">, documentId: string, token: string | null | undefined, excluded: boolean): Promise<string | null> {
  if (excluded || !token || !/^[\w-]{16}$/.test(token)) return null;
  const row = await db.select({ token: linkClicks.clickToken }).from(linkClicks)
    .innerJoin(shortLinks, eq(shortLinks.id, linkClicks.linkId))
    .innerJoin(documents, and(eq(documents.id, linkClicks.destinationId), eq(documents.workspaceId, shortLinks.workspaceId)))
    .where(and(eq(linkClicks.clickToken, token), eq(linkClicks.linkId, link.id), eq(shortLinks.workspaceId, link.workspaceId),
      eq(linkClicks.destinationType, "document"), eq(documents.id, documentId), eq(linkClicks.isBot, false), eq(linkClicks.isMember, false))).get();
  return row?.token ?? null;
}
