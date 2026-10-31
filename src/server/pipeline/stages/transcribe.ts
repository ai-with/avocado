import { eq } from "drizzle-orm";
import { audioTracks, transcriptSegments } from "../../db/schema";
import { newId } from "../../lib/ids";
import { logEvent } from "../../lib/events";
import { transcribe } from "../../lib/ai";
import { detectLang, toSentences } from "../rules";
import { StageSkip, bumpAttempt, type Ctx } from "../context";
import { assertMediaWritable, MediaWithdrawn } from "../../lib/media-purge";

// 5 STT
const STT_ATTEMPTS = 3; // 1회 + 재시도 2회

async function transcribeOnce(ctx: Ctx, wav: ArrayBuffer) {
  const { db, env, sub } = ctx;
  await assertMediaWritable(db, sub.id);
  const out = await transcribe(env, wav);
  await assertMediaWritable(db, sub.id);
  const sentences = toSentences(out.segments);
  if (sentences.length === 0) throw new StageSkip("no_speech");
  const lang = detectLang(sentences.map((s) => s.text).join(" "), out.language);
  await db.insert(transcriptSegments).values(sentences.map((s) => ({ id: newId(), submissionId: sub.id, startMs: s.startMs, endMs: s.endMs, lang, text: s.text })));
  await logEvent(db, ctx.workspaceId, "stt_language_detected", { lang });
}

export async function stageTranscribe(ctx: Ctx): Promise<string | null> {
  const { db, env, sub } = ctx;
  await assertMediaWritable(db, sub.id);
  const audio = await db.select().from(audioTracks).where(eq(audioTracks.submissionId, sub.id)).get();
  await db.delete(transcriptSegments).where(eq(transcriptSegments.submissionId, sub.id));
  if (!audio) throw new StageSkip("no_audio");
  const obj = await env.FILES.get(audio.key);
  if (!obj) throw new StageSkip("no_audio");
  const wav = await obj.arrayBuffer();

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= STT_ATTEMPTS; attempt++) {
    await assertMediaWritable(db, sub.id);
    await bumpAttempt(ctx, "transcribe", attempt);
    try {
      await transcribeOnce(ctx, wav);
      return null;
    } catch (e) {
      if (e instanceof StageSkip || e instanceof MediaWithdrawn) throw e;
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("transcribe_failed");
}
