// 기능 데모 문구·수치 (candidates, feedback, links). guide·upload·transcript는 demoCopy.ts
// 시각은 히어로 릴스(public/videos/hero-reel.*, 8초) 기준이다

export const REEL_POSTER = "/videos/hero-reel.jpg";
export const REEL_VIDEO = "/videos/hero-reel.mp4";
export const REEL_SECONDS = 8;

export type CandidateTone = "danger" | "warn" | "success" | "neutral";
export type CandidateFilter = "all" | CandidateTone;
export type Candidate = { seconds: number; tone: CandidateTone; title: string; evidence: string; rule: string };

export const CANDIDATES_DEMO = {
  label: "위반 후보 검토",
  filters: [
    { value: "all", label: "전체" },
    { value: "danger", label: "위반 후보" },
    { value: "warn", label: "확인 필요" },
    { value: "success", label: "준수" },
    { value: "neutral", label: "판단 불가" },
  ] as const satisfies readonly { value: CandidateFilter; label: string }[],
  items: [
    { seconds: 1, tone: "success", title: "첫 3초 제품 노출", rule: "첫 3초 안에 제품이 보일 것", evidence: "0~3초 내내 제품이 화면 오른쪽에 보입니다." },
    { seconds: 2, tone: "danger", title: "금지 표현 \"in just a week\"", rule: "효과 기간을 단정하지 말 것", evidence: "\"Okay, this serum made my skin glow in just a week.\"" },
    { seconds: 4, tone: "warn", title: "광고 표기 화면 텍스트 없음", rule: "광고 표기를 화면에 넣을 것", evidence: "화면 안에서 광고 표기 글자를 찾지 못했습니다. 캡션 표기는 확인이 필요합니다." },
    { seconds: 6, tone: "success", title: "필수 문구", rule: "\"Just one drop\" 사용량 안내", evidence: "\"Just one drop is enough.\"" },
    { seconds: 7, tone: "neutral", title: "배경 음악 저작권", rule: "허가된 음원만 쓸 것", evidence: "영상만으로는 음원 출처를 알 수 없습니다." },
  ] as const satisfies readonly Candidate[],
  evidenceTitle: "근거",
  ruleLabel: "규정",
  adopt: "채택",
  reject: "기각",
  adopted: "피드백에 추가",
  rejected: "기각함",
  pickHint: "항목을 누르면 근거가 보입니다",
  empty: "이 상태의 항목이 없습니다",
};

export const FEEDBACK_DEMO = {
  label: "수정 요청",
  brandSide: "브랜드 검수 화면",
  influencerSide: "인플루언서가 받는 화면",
  hint: "프레임을 누르면 처음부터",
  cueTime: "00:01",
  ko: "제품 라벨이 화면 정면으로 보이게 들어 주세요.",
  en: "Please hold the product so the label faces the camera.",
  translating: "영어로 옮기는 중",
  send: "보내기",
  sent: "보냄",
  reflected: "반영함",
  v2: "v2 업로드",
  compare: "v1·v2 나란히 보기",
  compareOff: "v2만 보기",
  waiting: "피드백을 기다리는 중",
  // 병 위치(프레임 대비 %). hero-reel.jpg 기준
  box: { left: 66, top: 44, width: 26, height: 26 },
  v2Seconds: 1,
};

export type LinkPeriod = "24h" | "3d" | "7d";
export type LinkMetrics = readonly [clicks: number, views: number, applies: number];

// 행마다 기간별 [클릭, 자료 열람, 신청]. 기간이 길수록 늘고, 항상 클릭 ≥ 열람 ≥ 신청
export const LINKS_DEMO = {
  label: "링크 성과",
  periods: [
    { value: "24h", label: "24시간" },
    { value: "3d", label: "3일" },
    { value: "7d", label: "7일" },
  ] as const satisfies readonly { value: LinkPeriod; label: string }[],
  columns: ["클릭", "열람", "신청"] as const,
  funnel: ["클릭", "자료 열람", "신청"] as const,
  linkHead: "인플루언서 · 채널",
  total: "합계",
  copied: "링크 복사됨",
  rowHint: "행을 누르면 링크를 복사합니다",
  rows: [
    { who: "인플루언서 A", channel: "인스타 바이오", slug: "/r/a-bio", data: { "24h": [86, 52, 4], "3d": [198, 121, 10], "7d": [352, 214, 17] } },
    { who: "인플루언서 A", channel: "스토리", slug: "/r/a-story", data: { "24h": [142, 88, 7], "3d": [265, 160, 13], "7d": [298, 181, 15] } },
    { who: "인플루언서 B", channel: "인스타 바이오", slug: "/r/b-bio", data: { "24h": [41, 25, 2], "3d": [97, 58, 4], "7d": [176, 104, 8] } },
    { who: "인플루언서 B", channel: "스토리", slug: "/r/b-story", data: { "24h": [63, 37, 3], "3d": [131, 79, 6], "7d": [149, 90, 7] } },
    { who: "인플루언서 C", channel: "인스타 바이오", slug: "/r/c-bio", data: { "24h": [108, 70, 6], "3d": [240, 151, 12], "7d": [421, 262, 21] } },
    { who: "인플루언서 C", channel: "스토리", slug: "/r/c-story", data: { "24h": [120, 74, 5], "3d": [233, 140, 10], "7d": [260, 157, 12] } },
  ] as const satisfies readonly { who: string; channel: string; slug: string; data: Record<LinkPeriod, LinkMetrics> }[],
};
