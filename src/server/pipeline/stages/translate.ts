import { asc, eq } from "drizzle-orm";
import { transcriptSegments } from "../../db/schema";
import { translate } from "../../lib/ai";
import { otherLang } from "../rules";
import { StageSkip, type Ctx } from "../context";
import { MediaWithdrawn } from "../../lib/media-purge";
import { analysisWrite, assertCurrentAnalysis, StaleAnalysis } from "../analysis";

// 6 번역 (ko ↔ en). 문장별 실패는 원문만 남긴다
export async function stageTranslate(ctx: Ctx): Promise<string | null> {
  const { db, env, sub } = ctx;
  await assertCurrentAnalysis(ctx);
  const segs = await db.select().from(transcriptSegments).where(eq(transcriptSegments.submissionId, sub.id)).orderBy(asc(transcriptSegments.startMs));
  if (segs.length === 0) throw new StageSkip("no_transcript");
  let failed = 0;
  for (const s of segs) {
    await assertCurrentAnalysis(ctx);
    const to = otherLang(s.lang);
    try {
      const t = await translate(env, s.text, s.lang, to);
      await assertCurrentAnalysis(ctx);
      await analysisWrite(ctx, [db.update(transcriptSegments).set({ translatedText: t, translatedLang: to }).where(eq(transcriptSegments.id, s.id))]);
    } catch (e) {
      if (e instanceof MediaWithdrawn || e instanceof StaleAnalysis) throw e;
      failed++;
      console.error("[pipeline:translate]", s.id, e);
    }
  }
  if (failed === segs.length) throw new Error("translate_failed");
  return failed ? `partial:${failed}/${segs.length}` : null;
}
