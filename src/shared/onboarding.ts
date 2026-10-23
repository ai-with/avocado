import { z } from "zod";

// 온보딩 설문 선택지. 화면 라벨과 서버 검증이 같은 값을 쓴다
export const TEAM_SIZES = [
  { value: "1-5", label: "1~5" },
  { value: "6-20", label: "6~20" },
  { value: "21-50", label: "21~50" },
  { value: "51+", label: "51+" },
] as const;

export const ROLES = [
  { value: "marketer", label: "마케터" },
  { value: "founder", label: "대표·창업자" },
  { value: "agency", label: "대행사" },
  { value: "other", label: "기타" },
] as const;

export const GOALS = [
  { value: "review", label: "인플루언서 영상 검수" },
  { value: "leads", label: "리드 수집" },
  { value: "performance", label: "성과 측정" },
  { value: "messaging", label: "발송 자동화" },
] as const;

export type TeamSize = (typeof TEAM_SIZES)[number]["value"];
export type OnboardingRole = (typeof ROLES)[number]["value"];
export type Goal = (typeof GOALS)[number]["value"];

const SOURCE_MAX = 100;
const valuesOf = <T extends string>(list: readonly { value: T }[]) => list.map((o) => o.value) as [T, ...T[]];

export const onboardingSchema = z.object({
  teamSize: z.enum(valuesOf(TEAM_SIZES)).optional(),
  role: z.enum(valuesOf(ROLES)).optional(),
  goals: z.array(z.enum(valuesOf(GOALS))).optional(),
  source: z.string().trim().max(SOURCE_MAX, `${SOURCE_MAX}자 이하로 입력해 주세요.`).optional(),
  website: z.union([z.url({ protocol: /^https?$/, error: "http(s)로 시작하는 주소를 입력해 주세요." }), z.literal("")]).optional(),
  skipped: z.boolean().optional(),
});

export type OnboardingAnswers = z.infer<typeof onboardingSchema>;
