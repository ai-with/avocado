import { z } from "zod";

// 도움 받기 문의 유형. 화면 라벨과 서버 검증이 같은 값을 쓴다
export const SUPPORT_TYPES = [
  { value: "usage", label: "사용 문의" },
  { value: "plan", label: "요금제 변경" },
  { value: "bug", label: "버그 신고" },
] as const;

export type SupportType = (typeof SUPPORT_TYPES)[number]["value"];
export type SupportStatus = "received";

export const SUPPORT_STATUS_LABEL: Record<SupportStatus, string> = { received: "접수" };
export const SUPPORT_BODY_MIN = 10;
export const SUPPORT_BODY_MAX = 2000;
// 같은 사람이 같은 워크스페이스에서 1시간에 보낼 수 있는 문의 수
export const SUPPORT_PER_HOUR = 5;
export const SUPPORT_LIST_LIMIT = 10;

const typeValues = SUPPORT_TYPES.map((t) => t.value) as [SupportType, ...SupportType[]];

export const supportTypeLabel = (type: SupportType) => SUPPORT_TYPES.find((t) => t.value === type)?.label ?? type;
export const isSupportType = (v: string | null): v is SupportType => typeValues.some((t) => t === v);

export const supportBodySchema = z.object({
  type: z.enum(typeValues, "문의 유형을 골라 주세요."),
  body: z
    .string()
    .trim()
    .min(SUPPORT_BODY_MIN, `내용을 ${SUPPORT_BODY_MIN}자 이상 써 주세요.`)
    .max(SUPPORT_BODY_MAX, `내용은 ${SUPPORT_BODY_MAX}자까지 쓸 수 있어요.`),
  replyEmail: z.string().trim().toLowerCase().pipe(z.email("이메일 형식이 아니에요.")),
});

export type SupportBody = z.infer<typeof supportBodySchema>;
export type SupportRequestItem = { id: string; type: SupportType; status: SupportStatus; createdAt: number };
