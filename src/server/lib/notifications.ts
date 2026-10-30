import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { guideInfluencers, guides, influencers, notifications } from "../db/schema";
import type { NotificationKind } from "../../shared/notifications";
import { newId, now } from "./ids";

// 이벤트 → 앱 안 알림. logEvent 가 매핑에 있는 이벤트면 여기서 알림 행을 만든다

type Who = { name: string; guide: string };
type Props = Record<string, unknown>;
type Rule = { kind: NotificationKind; title: (who: Who, props: Props) => string; link: (props: Props) => string | null };

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const guidePath = (p: Props) => (str(p.guide_id) ? `/dashboard/campaigns/${str(p.guide_id)}` : null);
const reviewPath = (p: Props) => (str(p.submission_id) ? `/dashboard/reviews/${str(p.submission_id)}` : null);

export const NOTIFY_RULES: Record<string, Rule> = {
  participation_accepted: { kind: "participation_accepted", title: (w) => `${w.name}님이 "${w.guide}" 참여를 수락했어요`, link: guidePath },
  consent_withdrawn: { kind: "consent_withdrawn", title: (w) => `${w.name}님이 "${w.guide}" 동의를 철회했어요`, link: guidePath },
  upload_completed: {
    kind: "upload_completed",
    title: (w, p) => (p.external ? `${w.name}님이 "${w.guide}" 영상 링크를 보냈어요` : `${w.name}님이 "${w.guide}" 영상을 올렸어요`),
    link: reviewPath,
  },
  feedback_item_done: { kind: "feedback_done", title: (w) => `${w.name}님이 "${w.guide}" 피드백을 반영했어요`, link: reviewPath },
};

export type NotificationDraft = { kind: NotificationKind; title: string; linkPath: string };

// 순수 함수: 이벤트 이름·props·인플루언서 이름으로 알림 내용을 만든다. 대상이 아니거나 링크 대상이 없으면 null
export function draftNotification(name: string, props: Props, who: Who): NotificationDraft | null {
  const rule = NOTIFY_RULES[name];
  const linkPath = rule?.link(props);
  if (!rule || !linkPath) return null;
  return { kind: rule.kind, title: rule.title(who, props), linkPath };
}

async function whoOf(db: Db, giId: string): Promise<Who | null> {
  const row = await db
    .select({ name: influencers.displayName, guide: guides.name })
    .from(guideInfluencers)
    .innerJoin(influencers, eq(influencers.id, guideInfluencers.influencerId))
    .innerJoin(guides, eq(guides.id, guideInfluencers.guideId))
    .where(eq(guideInfluencers.id, giId))
    .get();
  return row ?? null;
}

// 알림 실패가 원래 동작(동의, 업로드)을 막으면 안 되므로 오류는 기록만 한다
export async function notifyFromEvent(db: Db, workspaceId: string, name: string, props: Props) {
  if (!NOTIFY_RULES[name]) return;
  try {
    const giId = str(props.gi_id);
    const who = giId ? await whoOf(db, giId) : null;
    const draft = who && draftNotification(name, props, who);
    if (draft) await db.insert(notifications).values({ id: newId(), workspaceId, ...draft, createdAt: now() });
  } catch (e) {
    console.error("[notifications:create]", e);
  }
}
