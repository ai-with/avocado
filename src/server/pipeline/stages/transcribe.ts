import { eq } from "drizzle-orm";
import { audioTracks, transcriptSegments } from "../../db/schema";
import { newId } from "../../lib/ids";
import { chunkRows } from "../../lib/chunks";
import { transcribe } from "../../lib/ai";
import { detectLang, toSentences } from "../rules";
import { StageSkip, bumpAttempt, type Ctx } from "../context";
import { MediaWithdrawn } from "../../lib/media-purge";
import { analysisWrite, assertCurrentAnalysis, audioHash, processingEvent, StaleAnalysis } from "../analysis";

// 5 STT
const STT_ATTEMPTS = 3; // 1회 + 재시도 2회

async function transcribeOnce(ctx: Ctx, wav: ArrayBuffer) {
  const { db, env, sub } = ctx;
  await assertCurrentAnalysis(ctx);
  const out = await transcribe(env, wav);
  await assertCurrentAnalysis(ctx);
  const sentences = toSentences(out.segments);
  if (sentences.length === 0) throw new StageSkip("no_speech");
  const lang = detectLang(sentences.map((s) => s.text).join(" "), out.language);
  const rows = sentences.map((s) => ({ id: newId(), submissionId: sub.id, startMs: s.startMs, endMs: s.endMs, lang, text: s.text }));
  await analysisWrite(ctx, [...chunkRows(rows, 8).map((part) => db.insert(transcriptSegments).values(part)),
    processingEvent(ctx, "stt_language_detected", { lang })]);
}

export async function stageTranscribe(ctx: Ctx): Promise<string | null> {
  const { db, env, sub } = ctx;
  await assertCurrentAnalysis(ctx);
  const audio = await db.select().from(audioTracks).where(eq(audioTracks.submissionId, sub.id)).get();
  await analysisWrite(ctx, [db.delete(transcriptSegments).where(eq(transcriptSegments.submissionId, sub.id))]);
  if (!audio) {
    const receipt = await db.query.submissionAnalysis.findFirst({ where: (a, { eq }) => eq(a.submissionId, sub.id) });
    await assertCurrentAnalysis(ctx);
    throw new StageSkip(receipt?.audioState === "none" && (receipt.framesComplete || receipt.audioReason === "server_prepared_no_audio") ? "no_audio_track" : "audio_unavailable");
  }
  const obj = await env.FILES.get(audio.key);
  if (!obj) throw new StageSkip("audio_unavailable");
  const wav = await obj.arrayBuffer();
  if (audio.contentHash && await audioHash(wav) !== audio.contentHash) throw new StageSkip("audio_unavailable");

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= STT_ATTEMPTS; attempt++) {
    await assertCurrentAnalysis(ctx);
    await bumpAttempt(ctx, "transcribe", attempt);
    try {
      await transcribeOnce(ctx, wav);
      return null;
    } catch (e) {
      if (e instanceof StageSkip || e instanceof MediaWithdrawn || e instanceof StaleAnalysis) throw e;
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("transcribe_failed");
}
