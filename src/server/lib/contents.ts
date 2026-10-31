import { and, eq } from "drizzle-orm";
import type { Db } from "../db";
import { contents, type Content } from "../db/schema";
import { newId, now } from "./ids";
import { logEvent } from "./events";
import { contentFormatOf } from "../../shared/review";
import { retireThumbnail } from "./content-thumbnail";
import { ApiError } from "./errors";

// F-48 게시물 URL 받기. 스냅샷 예약은 TASK-022 가 hooks.onContentRegistered 에 연결한다
export const contentHooks: { onContentRegistered?: (env: Env, db: Db, content: Content) => Promise<void> } = {};

export type RegisterResult = { content: Content; status: "created" | "same" | "conflict" | "replaced" };

// 먼저 들어온 값을 쓴다. 다른 값이 오면 conflict_url 에 남겨 브랜드가 확인한다. 브랜드는 replace 로 바꿀 수 있다
export async function registerContent(
  env: Env,
  db: Db,
  input: { workspaceId: string; guideId: string; influencerId: string; guideInfluencerId: string; url: string; by: "influencer" | "brand"; replace?: boolean },
): Promise<RegisterResult> {
  const url = input.url.trim();
  const existing = await db.select().from(contents).where(eq(contents.guideInfluencerId, input.guideInfluencerId)).get();
  let result: RegisterResult;
  if (!existing) {
    const row: Content = {
      id: newId(),
      guideId: input.guideId,
      influencerId: input.influencerId,
      guideInfluencerId: input.guideInfluencerId,
      url,
      igMediaId: null,
      format: contentFormatOf(url),
      postedAt: null,
      postedAtSource: null,
      urlSubmittedBy: input.by,
      registeredAt: now(),
      conflictUrl: null,
      deletedAt: null,
      thumbnailUrl: null,
      thumbnailKey: null,
      thumbnailFetchedAt: null,
      collectionRevision: 0,
    };
    await db.insert(contents).values(row);
    result = { content: row, status: "created" };
  } else if (existing.url === url) {
    return { content: existing, status: "same" };
  } else if (input.replace && input.by === "brand") {
    const patch = { url, format: contentFormatOf(url), conflictUrl: null, urlSubmittedBy: "brand" as const, igMediaId: null, postedAt: null, postedAtSource: null, registeredAt: now(), collectionRevision: existing.collectionRevision + 1, thumbnailUrl: null, thumbnailKey: null, thumbnailFetchedAt: null };
    const changed = await db.update(contents).set(patch).where(and(eq(contents.id, existing.id), eq(contents.collectionRevision, existing.collectionRevision))).returning({ id: contents.id });
    if (!changed.length) throw new ApiError(409, "content_changed", "게시물 URL이 바뀌었어요. 새로고침한 뒤 다시 확인해 주세요.");
    if (existing.thumbnailKey) await retireThumbnail(env, db, input.workspaceId, existing.id, existing.thumbnailKey);
    result = { content: { ...existing, ...patch }, status: "replaced" };
  } else {
    await db.update(contents).set({ conflictUrl: url }).where(eq(contents.id, existing.id));
    return { content: { ...existing, conflictUrl: url }, status: "conflict" };
  }
  await logEvent(db, input.workspaceId, "post_url_submitted", { by: input.by });
  if (contentHooks.onContentRegistered) await contentHooks.onContentRegistered(env, db, result.content).catch((e: unknown) => console.error("[content:hook]", e));
  return result;
}
