import { eq } from "drizzle-orm";
import { guideInfluencers, influencers, violationCandidates } from "../../db/schema";
import { sendEmail } from "../../lib/email";
import { escapeHtml } from "../../lib/html";
import { memberEmails } from "../../lib/members";
import type { Ctx } from "../context";

// 8 브랜드 전달. 이메일 실패해도 앱 화면에는 보인다
export async function stageNotify(ctx: Ctx): Promise<string | null> {
  const { db, env, sub, guide } = ctx;
  const inf = await db
    .select({ name: influencers.displayName })
    .from(guideInfluencers)
    .innerJoin(influencers, eq(influencers.id, guideInfluencers.influencerId))
    .where(eq(guideInfluencers.id, ctx.giId))
    .get();
  const counts = await db.select({ result: violationCandidates.result }).from(violationCandidates).where(eq(violationCandidates.submissionId, sub.id));
  const n = counts.filter((c) => c.result === "candidate").length;
  const people = await memberEmails(db, ctx.workspaceId, ["owner", "editor", "approver"]);
  const url = `${env.APP_URL}/reviews/${sub.id}`;
  const subject = `[${guide.name}] ${inf?.name ?? "인플루언서"}님 v${sub.version} 검수 준비 완료`;
  const text = `${inf?.name ?? "인플루언서"}님이 올린 v${sub.version} 영상의 처리가 끝났습니다. 위반 후보 ${n}건. 검수 화면: ${url}`;
  let delivered = 0;
  for (const p of people) {
    const r = await sendEmail(env, { to: p.email, subject, text, html: `<p>${escapeHtml(text)}</p><p><a href="${url}">검수 화면 열기</a></p>` });
    if (r.delivered) delivered++;
  }
  return delivered === people.length ? null : `email_not_delivered:${people.length - delivered}`;
}
