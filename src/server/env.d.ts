// 시크릿은 wrangler types 결과에 없으므로 여기서 선택값으로 선언한다. 없으면 해당 기능을 끈다.
// wrangler.jsonc vars 에 있는 이름(APP_URL, APP_ENV 등)은 생성물에 들어가므로 여기에 다시 쓰지 않는다
interface Env {
  RESEND_API_KEY?: string;
  RESEND_WEBHOOK_SECRET?: string;
  EMAIL_FROM?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_VERIFY_TOKEN?: string;
  TOKEN_ENC_KEY?: string;
  // TASK-020: AI_FAKE=1 이면 lib/ai.ts 어댑터가 고정 응답
  AI_FAKE?: string;
  // TASK-022: IG_FAKE=1 이면 인스타그램 어댑터가 가짜 응답. IG_SYSTEM_* 는 미연결 경로(business_discovery)용 운영 계정 토큰
  IG_FAKE?: string;
  IG_SYSTEM_TOKEN?: string;
  IG_SYSTEM_USER_ID?: string;
  // TASK-024: 구글 로그인(둘 다 있어야 켜짐), SMS(SMS_PROVIDER=solapi), APP_ENV=production(vars) 이면 devCode 를 응답에 넣지 않는다
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SMS_PROVIDER?: string;
  SOLAPI_API_KEY?: string;
  SOLAPI_API_SECRET?: string;
  SMS_FROM?: string;
  // TASK-029: Analytics Engine SQL API 조회용 계정 토큰. 1단계 화면은 D1 만 쓰므로 아직 읽지 않는다
  CF_API_TOKEN_AE?: string;
  // TASK-054: 도움 받기 문의를 받을 운영 주소. 없으면 저장만 한다
  SUPPORT_EMAIL?: string;
}
