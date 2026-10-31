import { and, eq } from "drizzle-orm";
import type { Db } from "../db";
import { processingJobs, type guides, type submissions } from "../db/schema";
import type { JobStage } from "../../shared/review";
import { analysisWrite } from "./analysis";

export type Sub = typeof submissions.$inferSelect;
export type Ctx = { env: Env; db: Db; sub: Sub; guide: typeof guides.$inferSelect; workspaceId: string; giId: string;
  analysis?: { generation: number; token: string; requestId: string | null; pendingGeneration: boolean } };

// 단계 함수는 성공 시 메모(또는 null)를 돌려주고, 건너뛸 때는 StageSkip 을 던진다
export class StageSkip extends Error {}

export const jobWhere = (submissionId: string, stage: JobStage) => and(eq(processingJobs.submissionId, submissionId), eq(processingJobs.stage, stage));

export async function bumpAttempt(ctx: Ctx, stage: JobStage, n: number) {
  await analysisWrite(ctx, [ctx.db.update(processingJobs).set({ attempts: n }).where(jobWhere(ctx.sub.id, stage))]);
}
