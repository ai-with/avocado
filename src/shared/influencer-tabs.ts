// 인플루언서 공개 화면(/g, /u, /f)이 함께 쓰는 탭 줄 (AIWITH-480).
// 주소는 앱 상대 경로라 화면 안에서 새로고침 없이 이동한다. null 이면 잠긴 탭

export type InfluencerTabs = { guide: string; upload: string | null; feedback: string | null; unreadFeedback: number; deadlineAt: number | null };
export type InfluencerTabKey = "guide" | "upload" | "feedback";

type Tokens = { guideToken: string; uploadToken: string; feedbackToken: string };
type TabState = { consented: boolean; unreadFeedback: number; deadlineAt: number | null };

// 동의 전이면 업로드·피드백을 잠근다. 동의 뒤 피드백 탭은 항상 열리고 버전별 이력을 보여 준다 (TASK-074)
export function buildInfluencerTabs(tokens: Tokens, state: TabState): InfluencerTabs {
  return {
    guide: `/g/${tokens.guideToken}`,
    upload: state.consented ? `/u/${tokens.uploadToken}` : null,
    feedback: state.consented ? `/f/${tokens.feedbackToken}` : null,
    unreadFeedback: state.consented ? state.unreadFeedback : 0,
    deadlineAt: state.deadlineAt,
  };
}

// 반영 체크는 최신 버전에서만 할 수 있어서, 배지는 최신 버전에 보낸 항목만 센다 (TASK-075)
export function countUnreadLatest(items: { version: number; done: boolean }[], latestVersion: number): number {
  return items.filter((i) => i.version === latestVersion && !i.done).length;
}
