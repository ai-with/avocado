# avocado

브랜드와 크리에이터 협업(가이드, 검수, 리드 수집, 발송, 성과)을 다루는 앱이다.
Hono(API) + React(SPA)를 Cloudflare Worker 하나로 배포한다. 저장소는 D1(DB), R2(파일), Queues(업로드 처리, 사이트 이벤트 수집), Analytics Engine(사이트 원본 이벤트), Workers AI(전사·번역·판정), Cron(15분)을 쓴다.
브랜드 사이트에 심는 웹 SDK는 `sdk/`에 따로 있다 (아래 "웹 SDK" 절).

## 요구 사항

- Node.js 22.19 이상, npm
- Cloudflare 계정 (배포 시. 로컬 실행만 할 때도 Workers AI를 실제로 부르려면 `npx wrangler login` 필요. `AI_FAKE=1`이면 필요 없음)
- 영상 프레임·오디오 추출은 업로드하는 브라우저가 한다. 서버에 ffmpeg는 없다

## 로컬 실행

```bash
npm ci
npm run db:migrate:local   # migrations/*.sql 을 로컬 D1(.wrangler/state)에 순서대로 적용
npm run dev                # http://localhost:5173
```

프로젝트 루트에 `.dev.vars`를 만든다(깃에 올라가지 않음). 최소 구성:

```bash
APP_ENV=development   # 필수. 없으면 wrangler.jsonc 의 production 값이 적용되어 휴대폰 인증번호가 화면에 나오지 않는다
AI_FAKE=1             # 선택. Workers AI 대신 고정 응답 (로그인 없이 검수 흐름 확인)
IG_FAKE=1             # 선택. 인스타그램 API 대신 가짜 응답 (연결, 스냅샷, 키워드 DM)
```

개발 모드에서 SMS 설정이 없으면 휴대폰 인증번호가 화면에 "개발 모드 인증번호"로 보인다. 이메일 키가 없으면 메일은 dev 서버 콘솔에 `[email:no_provider]`로만 찍히고, 자동·1회성 발송 로그는 `skipped / no_provider`로 남는다.

Cron은 dev 서버에서 직접 부른다: `curl "http://localhost:5173/cdn-cgi/handler/scheduled?cron=*/15+*+*+*+*"`

인증 보조 기록 정리는 매일 03:00 KST에 실행한다. 하루 제한 창을 보존하며, 테이블별 실제 삭제 건수를 Workers 로그의 `[auth_cleanup_completed]`와 `events`에 기록한다. 운영 실행 이력은 다음으로 확인한다(시각은 epoch ms, `scheduled_at`은 예정 시각).

```bash
npx wrangler d1 execute avocado-db --remote --command "SELECT datetime(at / 1000, 'unixepoch', '+9 hours') AS completed_kst, props FROM events WHERE name = 'auth_cleanup_completed' AND workspace_id IS NULL ORDER BY at DESC LIMIT 7;"
```

정리 실패나 이력 저장 실패는 Past Cron Events에도 실패로 표시된다. 로컬·수동 실행 결과는 운영 03:00 KST 실행 증거로 대신하지 않는다.

### 데모 데이터

dev 서버를 띄운 상태에서:

```bash
npm run seed:local
```

계정 `demo@example.com` / 비밀번호 `demo1234!` (휴대폰 `010-0000-0001`로 인증 완료 상태).
워크스페이스 "데모 브랜드", 발행된 가이드 1개, 인스타툰 작가 더미 인플루언서 3명, 인플루언서별 신청 폼 링크, 그 링크로 들어온 리드 5건, 리드 그룹 1개가 만들어진다. 이미 계정이 있으면 아무것도 하지 않는다. 모든 이름·이메일은 가짜다.
다른 주소의 서버에 넣으려면 `SEED_BASE_URL=http://localhost:5180 npm run seed:local`.

## 검증

```bash
npm run typecheck
npm test
npm run sdk:test
npm run build                # prebuild 로 SDK 도 빌드 (gzip 10KB 넘으면 실패)
npm run lint:design          # 토큰 밖 색·간격 검사 (허용 목록: scripts/lint-design.allow.json)
npx wrangler deploy --dry-run --outdir dist-dry
```

## 프론트 디자인

디자이너 없이 에이전트가 화면을 만든다. 화면 작업 전에 [`DESIGN.md`](DESIGN.md)를 읽는다.

- 색·간격·글자·모서리·그림자는 `src/client/styles/tokens.css`의 2층 의미 토큰만 쓴다
- 버튼·입력·표·모달은 `src/client/ui/` 공통 컴포넌트를 먼저 쓴다
- 토큰과 컴포넌트 견본: 개발 서버의 `/dev/ui` (운영 빌드에는 없음)

## 마이그레이션

- `migrations/000N_이름.sql` 파일을 손으로 번호 붙여 추가한다 (현재 0001~0009).
- 스키마는 `src/server/db/schema/*.ts`. `npx drizzle-kit generate` 결과(.agent_work/scratch/drizzle)는 참고용으로만 쓰고 정리해서 옮긴다.
- 원격 적용: `npm run db:migrate:remote`

## 배포

### 1. Cloudflare 리소스 만들기

```bash
npx wrangler login
npx wrangler d1 create avocado-db
npx wrangler r2 bucket create avocado-files
npx wrangler queues create avocado-pipeline
npx wrangler queues create avocado-collect
```

Analytics Engine 데이터셋(`avc_events`, 바인딩 `SITE_EVENTS`)은 따로 만들 필요 없다. 첫 쓰기 때 생긴다 (계정에서 Analytics Engine이 켜져 있어야 한다).

`d1 create`가 출력한 `database_id`를 `wrangler.jsonc`의 `d1_databases[0].database_id`에 넣는다 (지금은 0으로 채운 자리값).

### 2. 변수 바꾸기 (`wrangler.jsonc`의 `vars`)

- `APP_URL`: 서비스 주소 (예: `https://app.example.com`). 메일 링크, OAuth 콜백, 수신 거부 링크에 쓰인다
- `PUBLIC_SHORT_BASE`: 단축링크 앞부분 (예: `https://app.example.com/l`)
- `APP_ENV`: `production` 그대로 둔다

### 3. 시크릿 등록

`npx wrangler secret put <이름>`으로 하나씩 넣는다. 없는 시크릿은 해당 기능이 꺼진다.

| 이름 | 용도 | 없을 때 |
|------|------|---------|
| `RESEND_API_KEY` | 이메일 발송 (Resend) | 메일을 보내지 않고 로그만. 발송 로그는 `no_provider` |
| `RESEND_WEBHOOK_SECRET` | Resend 반송 웹훅 서명 검증 (`whsec_`로 시작하는 Signing Secret) | `/webhooks/resend`가 503을 반환하며 반송을 반영하지 않는다 |
| `EMAIL_FROM` | 발신 주소 (Resend에서 인증한 도메인) | `no-reply@example.com` |
| `SUPPORT_EMAIL` | 도움 받기 문의를 받을 운영 주소 (선택, 실제 발송은 `RESEND_API_KEY`도 필요) | 문의를 저장만 하고 메일은 보내지 않는다 |
| `SMS_PROVIDER` | `solapi`로 두면 문자 발송 | 문자 미발송. 운영에서는 인증번호를 받을 수 없어 가입이 막힌다 (필수) |
| `SOLAPI_API_KEY`, `SOLAPI_API_SECRET` | Solapi 인증 | 위와 같음 |
| `SMS_FROM` | Solapi에 등록한 발신 번호 | 위와 같음 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | 구글 로그인 및 별도 Google Sheets 추가 동의 (둘 다 필요) | 로그인·가입과 시트 연결이 준비 중으로 표시됨 |
| `META_APP_ID`, `META_APP_SECRET` | 인스타그램 연결 OAuth, 웹훅 서명 검증 (필수) | 인스타그램 연결, 키워드 DM이 "연결 준비 중" |
| `META_VERIFY_TOKEN` | 웹훅 등록 확인용 임의 문자열 (필수) | 웹훅 등록 불가 |
| `TOKEN_ENC_KEY` | 인스타그램·Google Sheets 토큰, 임시 내보내기 자료와 SDK identify 작업 암호화, 32바이트 이상 (바꾸면 기존 연결·임시 자료 복호화 불가) | 인스타그램·시트 연결과 SDK identify 작업 처리 불가 |
| `TURNSTILE_SITE_KEY` | 공용 가이드 참여용 Turnstile sitekey. 클라이언트에 공개되는 값 | 공용 참여는 준비 중으로 표시되고 신청은 거절됨 |
| `TURNSTILE_SECRET_KEY` | 같은 위젯의 Siteverify secret. 서버 시크릿으로만 등록 | 위와 같음. 검증 없이 가입하지 않음 |
| `CF_API_TOKEN_AE` | Analytics Engine SQL API 조회용 토큰 (선택, 아직 읽는 화면 없음) | 영향 없음. 사이트 분석 화면은 D1 집계만 쓴다 |
| `IG_SYSTEM_TOKEN`, `IG_SYSTEM_USER_ID` | 연결하지 않은 인플루언서 게시물 지표(business_discovery)를 읽을 운영 계정 (선택) | 미연결 게시물은 게시 시각을 못 읽어 등록 시각 기준으로 예약 |

`AI_FAKE`, `IG_FAKE`는 로컬 전용이다. **운영에 절대 넣지 않는다** (가짜 응답이 실제 데이터로 저장되고, `IG_FAKE`에서는 웹훅 서명 검증이 느슨해질 수 있다).

### 4. 구글 로그인 설정 (선택)

Google Cloud 콘솔 > API 및 서비스 > 사용자 인증 정보에서 OAuth 클라이언트(웹 애플리케이션)를 만들고, 승인된 리디렉션 URI에 `${APP_URL}/api/auth/google/callback`을 그대로 넣는다. 발급된 ID와 비밀번호를 위 시크릿으로 등록한다.

### 5. Meta 앱과 웹훅 설정 요약

1. developers.facebook.com에서 비즈니스 앱을 만들고 "Instagram API (인스타그램 로그인)" 제품을 추가한다
2. 인스타그램 로그인 설정의 OAuth 리디렉션 URI에 `${APP_URL}/api/ig/oauth/callback`을 넣는다
3. 웹훅: 콜백 URL `${APP_URL}/webhooks/instagram`, 확인 토큰은 `META_VERIFY_TOKEN` 값. `comments` 필드를 구독한다
4. 앱 검수 전에는 테스터로 등록한 계정만 연결된다. 키워드 DM(비공개 답장)과 인사이트 권한은 앱 검수가 필요하다
5. 미연결 게시물 지표를 쓰려면 페이스북 로그인 경로의 시스템 사용자 토큰을 `IG_SYSTEM_TOKEN`, 그 인스타그램 비즈니스 계정 ID를 `IG_SYSTEM_USER_ID`로 넣는다

#### 가이드에서 계정 연결·재연결 (AIWITH-285)

`0026_instagram_lifecycle.sql`을 적용한다. 개인 가이드의 선택 연결 버튼은 현재 발행된 가이드·인플루언서의 연결 토큰으로 만든다. 공용 가이드에는 개인 연결 버튼을 표시하지 않는다. `POST /api/ig/oauth/start`는 같은 출처 요청만 받고 임의 복귀 URL을 받지 않는다. 가이드/연결 화면의 현재 `ko`·`en` 언어와 시작 당시 가이드 경로를 보관해 성공·취소·실패 뒤 돌아간다. 고객사 요청 링크는 발급 후 30일이며, 만료 시각이 없는 과거 고객사 링크는 새로 발급해야 한다.

OAuth state는 불투명 난수이고 DB에는 해시만 남긴다. 흐름별 HttpOnly·SameSite=Lax 쿠키의 브라우저 난수도 해시로 검증하며, 운영 쿠키는 Secure·Path=/의 `__Host-` 쿠키다. state 인증은 10분·한 번만 허용한다. 15분 쿠키는 마지막 5분 동안 원래 브라우저에 만료 안내를 돌려주는 데만 쓴다. 로그인한 시작 사용자의 세션·현재 워크스페이스와 브랜드 owner/editor 권한, 현재 연결 세대·연결/가이드 토큰·발행/만료 상태를 콜백 claim과 저장 직전 SQL에서 다시 확인한다. 다른 브라우저에는 가이드 capability를 노출하지 않는다. 해제·재연결·토큰 재발급 뒤의 옛 콜백은 거절하며, 시작 당시의 옛 경로로만 돌아간다. 기존 Google 로그인과 초대 복귀는 변경하지 않는다.

실제 발급 응답에 명시된 승인 범위만 기록한다. 기존 `IG_SCOPES` 요청 범위를 유지하면서 필요한 범위를 모두 포함하는지 검사하며, 요청값을 승인값으로 대신 저장하지 않는다. 유효한 토큰·만료 시각·실제 승인 증명·프로페셔널 계정이 모두 있어야 가이드/성과표/자동 DM에서 연결됨으로 취급한다. 과거 요청 범위만 저장한 연결은 승인 증명이 없어 다시 확인해야 하며, 이를 철회로 추정해 알림을 보내지 않는다.

Meta의 [공식 Postman Instagram 문서](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api#instagram-api-with-instagram-login)는 Instagram Login과 Facebook Login 경로를 구분한다. 개발 중 Meta Business Login 직접 문서는 429/접근 차단으로 발급 응답의 실제 grant 필드를 충분히 검증하지 못했다. 따라서 발급 응답에 일관된 명시 `scope` 또는 `permissions`가 없으면 `grant_unverified`로 연결을 거절한다. Facebook Login의 `/me/permissions`나 `/debug_token` 경로를 추정 적용하지 않는다. 실제 Meta 앱·테스터 계정에서 grant 응답, 프로페셔널 계정, 취소/철회·재연결을 확인하기 전에는 운영 연결 QA 완료로 간주하지 않는다.

로컬 토큰 만료·토큰 누락 또는 비일시 Graph 인증 오류 190만 현재 세대 CAS로 끊김 전환한다. 429·5xx·`is_transient`·10/200 권한 오류·누락 지표는 계정 전체 철회로 추정하지 않는다. 세대 회전·자동 DM 일시정지·당시 브랜드 owner/editor 및 해당 인플루언서별 알림 원장을 D1 원자 배치로 보관한다. 재연결한 세대나 현재 권한/주소/가이드 링크가 달라진 대기 알림은 전송하지 않는다. 이미 시작한 외부 HTTP는 사후 취소할 수 없다.

15분 Cron은 D1 조회 없이 기존 `PIPELINE`에 유지보수 한 건을 넣는다. 유지보수는 연결 ID 최대 20개와 발송 원장 최대 50개만 발견해 각각 별도 Queue 메시지로 처리한다. 기존 `max_batch_size=1`을 유지하고 새 리소스를 만들지 않는다. 전송 실패는 consumer 재시도와 다음 유지보수가 다시 처리하며, Queue 등록 실패도 영속 원장/오류 코드에 남는다. 만료 state는 15분 브라우저 안내 시간이 지난 뒤 정리 대상이 된다.

새 작업의 호출 예산은 Cron D1 0회+Queue 1회, 유지보수 D1 배치 1회+Queue 최대 1회, 연결 확인 D1 최대 4회+Queue 최대 1회, 수신자 발송 D1 최대 8회+HTTP 1회다. R2 호출은 없다. 수신자 예산은 HTTP 성공 뒤 마지막 DB 저장까지 실패하는 경로를 실제 SQLite 회귀로 확인한다. [D1은 Free 호출당 50회이며 배치 전체를 1회로 계산한다](https://developers.cloudflare.com/d1/platform/limits/). 기존 다른 Cron 작업에 새 연결·수신자별 DB 순회를 더하지 않는다.

알림은 기존 Resend 공용 함수를 쓰며 `RESEND_API_KEY`·명시 `EMAIL_FROM`·`TOKEN_ENC_KEY`가 모두 있어야 HTTP를 시작한다. 설정이 없으면 `blocked/mail_not_configured`로 남고 예제 발신 주소로 전송하지 않는다. 첫 전송 전에 발신/수신 주소·본문·가이드 경로를 암호화해 고정하고 수신자별 동일 idempotency key로 재시도한다. [Resend의 보관 시간은 24시간](https://resend.com/docs/dashboard/emails/idempotency-keys)이므로 첫 시도 후 24시간에서 1분 여유를 뺀 시점부터 결과 미확정 알림은 `unknown`으로 닫아 자동 재전송하지 않는다. 이 경우 수동 확인이 필요하며, 무기한 중복 발송하지 않는다. 성공·취소·결과 미확정으로 닫힌 원장의 암호화 본문은 지운다. 실제 Meta 앱 키·승인된 발신 도메인/주소가 없는 환경의 실제 OAuth·메일 수신 검증은 별도다.

#### 공용 가이드 참여 보호 (AIWITH-292)

`0027_public_join_limits.sql`을 적용하고 Cloudflare Turnstile의 운영 위젯에 실제 `APP_URL` 호스트를 등록한다. 같은 위젯의 `TURNSTILE_SITE_KEY`와 암호화 서버 시크릿 `TURNSTILE_SECRET_KEY`, 기존 `TOKEN_ENC_KEY`가 모두 있어야 공용 가이드에 참여할 수 있다. sitekey만 공개 응답에 포함하고 secret은 서버에서만 쓴다. 설정이 없거나 운영에 공식 시험 키를 넣으면 준비 중으로 표시하고 가입을 거절한다. 운영 키 등록·실제 호스트에서의 위젯 성공과 실제 봇 판별은 별도 운영 QA 대상이다.

클라이언트는 [공식 api.js](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/)를 `render=explicit`으로 직접 한 번 로드한다. 다른 서버에서 제공하거나 번들에 복사하지 않는다. 언어·가이드별 위젯 수명을 관리하고 만료·오류·로드 실패 때 새 확인을 받는다. 제출은 유효한 token이 있을 때만 허용하고 진행 중 중복 제출을 막는다. 가이드 이동·언어 변경·화면 종료 뒤 이전 위젯의 늦은 콜백은 사용하지 않는다. 가입 응답은 가이드·설정 변경이나 화면 종료 뒤 사용하지 않으며, 같은 가이드에서 신청 중 언어만 바꾸면 이미 시작한 요청을 최신 화면 언어의 복귀·오류 안내로 마무리한다.

보호 대상은 정확한 `POST /api/public/guide/:slug/join`이다. 이 요청만 회원 세션 조회 없이 익명 신청으로 처리하며, 다른 공개 API의 회원 클릭 제외나 기존 로그인 인증은 유지한다. 실제 stream을 최대 8KiB까지 읽고 token은 1~2048자만 받는다. 입력·token·설정·요청 IP가 유효하지 않으면 D1 조회나 외부 검증을 시작하지 않는다. 입력한 이름·계정·이메일이 같아도 기존 인플루언서의 비공개 링크를 재사용해 돌려주지 않는다.

속도 제한은 사업 요금제의 사용량 정책과 별개인 기술적 보호값이다. 고정 60초 창마다 IP의 공용 참여 전체를 30회, 가이드 전체를 모든 IP 합계 300회로 제한한다. 정상 폼 제출에 여유를 두면서 자동 요청을 제한하려는 초기 기본값이며 운영 트래픽에서 산출한 사업 정책은 아니다. 원자적 조건부 UPSERT로 시도를 먼저 예약한다. 시도는 유효한 입력·설정·IP와 발행된 가이드를 확인한 뒤 시작하며, 후속 검증·저장 실패도 이미 예약한 시도에서 환불하지 않는다. 존재하지 않는 slug의 카운터 쓰기 증폭을 피하려고 가이드를 먼저 조회한다. 따라서 unknown/draft slug는 D1 1회·counter 0회·외부 0회, 이미 차단된 IP는 guide 조회+IP 예약으로 D1 2회·외부 0회를 사용한다. 가이드를 바꿔도 IP 상한은 공유하고, IP를 바꿔도 가이드 상한은 공유한다. 창 경계의 짧은 구간에는 상한의 최대 두 배가 허용될 수 있고, 공유 NAT의 여러 참여자는 IP 상한을 함께 쓴다. 차단 응답은 `429`와 다음 창까지의 `Retry-After`를 제공한다.

원문 IP·연락처·Turnstile token은 속도 원장이나 로그에 저장하지 않는다. `TOKEN_ENC_KEY`의 HMAC에 도메인·IP/가이드 범위·시간창을 분리해 키를 만든다. 카운터 만료 시각은 창 종료 후 15분이며 기존 정리 Queue에서 만료 행을 한 번에 최대 1000개 지운다. 남은 행은 후속 정리 주기에서 처리한다. 신규 Queue나 Cron 조회는 추가하지 않고, 기존 Sheets 정리 Queue 호출은 D1 배치 1회와 카운터 DELETE 1회로 총 2회를 사용한다. 정리 실패는 Queue 재시도로 전파한다.

[Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)는 공식 HTTPS endpoint 한 곳만 사용한다. 성공 여부·운영 `APP_URL` hostname·`guide_join` action·가이드 ID로 만든 cData가 모두 일치해야 허용한다. token은 5분·한 번만 유효하다. 네트워크·본문 읽기 실패 또는 명시 `internal-error`만 재시도하며, HTTP 5xx를 포함한 비정상 HTTP 상태는 재시도하지 않고 거절한다. 재시도는 서버가 생성한 UUID를 같은 HTTP 요청 안에서만 공유하며 클라이언트의 idempotency key를 받지 않는다. 정상은 외부 1회, 허용한 일시 오류 재시도는 최대 2회이고 각각 헤더·본문을 합쳐 5초, 응답은 최대 16KiB로 제한한다. 공급자 원문 응답은 로그에 남기지 않는다. 검증 후 발행 상태를 다시 확인하는 influencer·개인 가이드 링크·이벤트 native batch로 저장하며 실패는 롤백한다. 정상 가입은 회원 쿠키 유무와 관계없이 최대 4 D1+1 HTTP다.

로컬 개발에는 [공식 시험 키](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)를 별도로 쓸 수 있다. 예를 들어 개발 전용 `.dev.vars`에 `APP_ENV=development`, 통과 sitekey `1x00000000000000000000AA`, 통과 secret `1x0000000000000000000000000000000AA`를 함께 설정한다. 개발 응답도 hostname·action·cData 일치 검증을 생략하지 않는다. 운영은 이 시험 sitekey·secret을 거부하며 검증 우회 모드는 없다. 가짜 HTTP·위젯 회귀는 로컬 검증이며 실제 봇 판별이나 운영 hostname 성공의 증거로 사용하지 않는다.

### 6. 원격 마이그레이션과 배포

```bash
npm run db:migrate:remote
npm run deploy
```

### 7. Resend 반송 웹훅

Resend의 Webhooks에서 운영 URL `${APP_URL}/webhooks/resend`를 등록하고 `email.bounced`를 구독한다. 해당 웹훅의 Signing Secret을 `npx wrangler secret put RESEND_WEBHOOK_SECRET`으로 등록한다. `0022_email_bounces.sql` 마이그레이션을 적용한 뒤 배포한다.

자동·1회성 발송은 Resend ID와 발송 당시 리드·수신자 정보를 보관한다. 반송은 원문과 Svix 서명을 검증한 뒤, 해당 발송에 연결된 리드의 `bounced_at`과 발송 기록의 `bounced` 상태를 함께 갱신한다. 같은 주소가 다른 워크스페이스에 있어도 영향을 주지 않는다. 삭제 후 복구된 리드나 발송 후 이메일을 바꾼 리드에는 과거 반송을 적용하지 않는다. 반송된 리드는 이후 이메일 발송에서 제외된다.

DB 실패는 5xx로 재시도한다. 발송 기록보다 반송이 먼저 도착하면 관리 태그가 있는 발송에 한해 이벤트 생성 후 10분 동안 재시도하고, 끝내 연결되지 않으면 무시한다. 배포 전 로그처럼 Resend ID가 없는 기록은 이메일 주소만으로 연결하지 않는다. 설정·페이로드 기준은 [Resend 반송 이벤트](https://resend.com/docs/webhooks/emails/bounced), [서명 검증](https://resend.com/docs/webhooks/verify-webhooks-requests), [Svix 수동 검증](https://docs.svix.com/receiving/verifying-payloads/how-manual)을 따른다.

## 개인정보 파기

`0024_privacy_purge.sql` 적용 후 배포한다. 기존 15분 Cron에서 기존 PIPELINE Queue에 개인정보 작업 세 건(리드·IP 해시, 사이트 D1, 철회 미디어)을 넣는다. `max_batch_size=1`로 각 작업을 별도 호출에서 실행해 기존 예약 발송·성과 수집과 D1/R2 호출 예산을 공유하지 않는다. 기존 영상 처리 메시지 경로도 유지한다.

- 삭제 리드는 요청 후 7일이 최대 기한이다. 다음 15분 안에 기한이 오는 행까지 이번 실행에서 처리하므로 최대 15분 먼저 지울 수 있다. 한 실행에서 최대 500명을 처리하며 실제 삭제 수와 기한 초과 잔여 수를 기록한다. 폼 답변·자료 열람·SDK 식별자와 연결된 세션·전환·옛 자동 발송도 함께 정리한다. 삭제 후 폼·게이트에서 다시 등록하면 새 리드 ID·프로필·수신 거부 토큰을 만들며, 현재 자료 열람 세션은 이어 볼 수 있게 보존한다. SDK identify는 삭제된 리드를 자동으로 복구하지 않으며, 오래된 작업을 새 등록에 연결하지 않는다.
- 링크 클릭은 30일이 지난 `ip_hash`만 비운다. 클릭 행과 통계는 보존한다.
- 삭제 사이트는 30일 후 D1의 세션·전환·식별자·일별 집계·이벤트 중복 제거 기록을 파기한다. 한 실행에서 최대 100개 사이트를 처리한다. 삭제된 사이트로 오는 늦은 SDK 쓰기는 SQL 실행 시에도 차단한다. **아래 Analytics Engine 원본 제한은 별개다.**
- 동의 철회는 해당 동의로 만든 기존 제출물만 파기 예약한다. R2에 쓰기 전에 정확한 키를 영속 원장에 기록하고, 철회 중 완료된 업로드는 보상 삭제한다. 미완료 multipart, 원본·프레임·음성 객체를 지운 다음 DB의 미디어 참조와 전사·번역을 정리한다. 재동의한 뒤 새로 올린 제출물과 검수·승인 메타데이터는 이 파기로 삭제하지 않는다. R2 부분 실패는 참조와 작업을 남겨 재시도하며, 완료한 제출물도 다시 검사해 늦게 완료된 쓰기를 회수한다.

R2 multipart 생성 직후 Worker가 종료되어 `upload_id`를 저장하지 못한 경우는 `media_purge_objects`에 `kind='multipart'`, `upload_id IS NULL`, `deleted_at IS NULL`로 남긴다. 이 상태는 파기 성공으로 처리하지 않으며 `multipart_upload_id_unknown` 오류로 재시도한다. Workers R2 바인딩에는 미완료 multipart 목록 API가 없어 운영 확인이 필요할 수 있다. 새 S3 자격증명이나 R2 lifecycle 변경을 자동으로 만들지 않는다.

기존 제출물은 제출 당시 유효했던 동의가 정확히 하나로 확인될 때만 해당 세대에 연결하고, 이미 철회된 세대는 파기 작업으로 이관한다. 철회와 제출 시각이 같은 경계, 중복되거나 사라진 동의 이력은 `submissions.consent_id IS NULL`로 남겨 추정 삭제하지 않는다. 이 경우 미디어 쓰기·열람도 허용하지 않으므로 운영에서 이력과 대상 범위를 확인해야 한다.

각 정리 결과는 개인정보 없이 Workers 로그와 `events`에 기록한다. 오류나 배치 상한으로 남은 기한 초과 작업을 확인해야 한다. Queue에 넣기 실패하면 Cron이 실패하고, 실행 실패하면 기존 Queue consumer가 오류를 기록하고 메시지를 재시도한다. 재시도 한도를 지나도 다음 15분 Cron이 영속 작업을 다시 확인하게 한다. Queue 지연·실패도 감시해야 한다. `media_purges.last_error`, `completed_at`, `next_attempt_at`과 미확인 multipart 원장도 함께 점검한다. 정상 캠페인의 원본 90일·전사 및 피드백 1년 보존 정책 자동 정리는 이번 철회 파기 범위에 포함되지 않는다.

**Analytics Engine 제한:** `avc_events`의 기존 원본은 Cloudflare가 [3개월 보관](https://developers.cloudflare.com/analytics/analytics-engine/limits/)하며, 공개 [SQL API는 DELETE를 지원하지 않는다](https://developers.cloudflare.com/analytics/sql-api/sql-reference/). 사이트 삭제 후 30일에 이 원본까지 물리 파기했다고 보장할 수 없다. D1 삭제나 조회 제외는 AE 원본 삭제를 대신하지 않는다. 별도 저장소·정책 결정 또는 Cloudflare 지원 확인 전까지 AIWITH-357의 이 조건과 부모 AIWITH-283은 미해결이다.

## 성과 수집과 Google Sheets 내보내기

`0025_performance_exports.sql`을 적용하고 배포한다. 기존 캠페인의 종료·보관 시각은 업로드 마감이나 `updated_at`으로 추정하지 않는다.

### 캠페인 종료와 썸네일

캠페인 정보의 **캠페인 종료 시각**(`ends_at`)은 영상 업로드 마감과 별개다. 그 시각으로부터 7일이 되는 순간부터 Cron·수동 재수집·진행 중 결과 저장을 막는다. 진행 중 캠페인에 종료 시각이 없으면 계속 수집하며, 과거 보관 캠페인에 종료 시각이 없으면 보수적으로 수집을 중지하고 입력 안내를 표시한다. 새 보관은 명시한 종료 시각이 필요하고, 실제 보관 전이는 서버의 `archived_at`에 기록한다. 보관 시각을 종료일로 대신 쓰지 않는다.

성과 Cron은 예약 스냅샷을 기존 PIPELINE Queue에 넣고, `max_batch_size=1` 소비자가 한 건씩 수집한다. 중복 메시지는 lease로 선점하며 URL 교체는 `collection_revision`으로 구분한다. 오래된 URL 등록 hook이나 늦은 Meta·R2 응답이 새 세대의 예약·이미지·성과를 덮지 않도록 최종 SQL에서도 현재 세대와 수집 기한을 확인한다. 성과표의 기존 클릭·리드는 유지하며 썸네일과 수집 중지 사유를 같은 행에 표시한다.

썸네일은 HTTPS의 Instagram/Meta CDN 주소만 허용하고, 모든 이미지를 R2 사본으로 보관해 CDN 만료와 분리한다. 다운로드는 총 8초, 2MiB, 리디렉션 2회까지이며 각 경유 주소와 PNG/JPEG/WebP/GIF 선언·시그니처를 확인한다. 읽기는 인증된 워크스페이스와 정확한 키 범위를 확인한 앱 API로만 제공한다.

R2 put 전에 FK cascade가 없는 `content_thumbnail_objects`에 키·워크스페이스·콘텐츠를 기록한다. 삭제·응답 손실로 남은 사본은 쓰기 시작 후 30분이 지나면 기존 Queue의 별도 정리가 한 번에 최대 100개씩 현재 참조 여부를 확인하고 원자적으로 retire한 다음 파기한다. 명시적인 URL 교체의 옛 사본 보상은 즉시 수행한다. 실패와 늦은 put을 회수하도록 원장·완료 표시를 남기며, 현재 사용 중인 키는 보호한다. soft 삭제된 콘텐츠의 참조도 정리하고, 새 클라우드 리소스는 만들지 않는다.

Meta 필드 계약은 공식 SDK의 고정 버전 [v26 설정](https://github.com/facebook/facebook-python-business-sdk/blob/efd8423a2e595ea8d4c04eb824ce113f2f1d68cd/facebook_business/apiconfig.py)과 [IGMedia 필드](https://github.com/facebook/facebook-python-business-sdk/blob/efd8423a2e595ea8d4c04eb824ce113f2f1d68cd/facebook_business/adobjects/igmedia.py), [Meta 공식 Instagram Login 문서](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api#instagram-api-with-instagram-login)를 기준으로 확인했다. 기존 권한 요청은 유지한다. 실계정별 endpoint·권한 승인과 실제 CDN 응답은 별도 운영 QA 대상이다.

### Google Cloud 설정

앱 자체 OAuth 클라이언트를 사용한다. ChatGPT Drive 연결의 자격증명은 제품에 사용하지 않는다. 기존 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENC_KEY`를 유지하고, 해당 Google Cloud 프로젝트에서 **Google Sheets API와 Google Drive API**를 활성화한다. OAuth 클라이언트의 승인된 리디렉션 URI에는 기존 로그인 콜백과 다음 추가 콜백을 각각 등록한다.

```text
${APP_URL}/api/auth/google/callback
${APP_URL}/api/google-sheets/callback
```

시트 연결은 일반 로그인과 별도인 추가 동의이며 `https://www.googleapis.com/auth/drive.file`만 요청한다. [시트 생성](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/create), [값 저장](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/update), [연결된 계정 표시](https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get)에 이 범위를 사용한다. 기존 로그인의 `openid` 범위를 전체 Drive 권한으로 넓히지 않는다. state는 현재 사용자·세션·연결 세대·일회용 nonce·PKCE·10분 만료에 묶으며, 토큰은 기존 암호화 키로 저장한다.

성과표·리드의 **구글 시트 내보내기**에서 연결된 Google 계정을 확인하고 명시적으로 시트 만들기를 누른다. 연결만으로 자료를 자동 전송하지 않는다. 사용자가 확인한 연결 세대가 달라지면 전송을 거절한다. 파일은 해당 계정 Drive의 기본 비공개 새 파일이며 앱이 공유 권한을 추가하지 않는다. 값은 `RAW`로 기록해 `=...` 같은 사용자 입력이 수식으로 실행되지 않게 한다.

연결 해제는 앱에 저장한 토큰을 파기한다. Google의 revoke는 [같은 프로젝트의 OAuth 범위에 함께 영향을 줄 수 있으므로](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke) 일반 로그인을 보존하기 위해 여기서 자동 호출하지 않는다. Google 쪽 권한까지 제거하려면 Google 계정의 연결 관리에서 확인한다.

### 내보내기 한도와 재시도

CSV와 같은 워크스페이스·권한·필터의 행을 재사용한다. 선택 결과는 최대 1,000행, 셀은 50,000자, 암호화 전 자료는 512KiB까지다. 행 선택에 필요한 입력 원장·조회 목록도 각 5,000행, 출처·태그 연결은 각 20,000행, 합산 텍스트 8MiB, 선택 그룹 규칙 128KiB까지로 제한한다. 초과하면 잘라내지 않고 오류를 반환한다. 입력 원장 상한은 최종 필터 결과와 별개이므로 큰 워크스페이스에는 원장 정리나 별도 규모 대응이 필요할 수 있다.

사용자·워크스페이스·확인한 연결 세대·필터에 묶인 요청 ID를 사용한다. 브라우저 세션에는 해시 처리한 필터 키와 요청 ID만 보관해 응답 손실·새로고침에도 같은 요청을 재사용하고, 실제 행이나 토큰은 보관하지 않는다. 생성 ID를 받은 뒤의 값 쓰기는 같은 파일에 다시 할 수 있다. 반면 Google Workspace 파일은 [미리 발급한 파일 ID로 생성할 수 없으므로](https://developers.google.com/workspace/drive/api/guides/manage-uploads#use_a_pre-generated_id_to_upload_files) 생성 응답을 잃으면 `unknown`으로 남겨 새 파일을 자동 생성하지 않는다. 이때는 연결된 Google Drive에서 파일을 확인해야 한다. 새 요청 ID나 새 연결로 명시적으로 다시 생성하면 별도 파일이 생길 수 있다.

완료하면 임시 행 자료를 지운다. 24시간이 지난 미완료 자료는 정리 대상으로 삼아 다음 정리 Queue에서 파기한다. 15분 넘게 중단된 생성도 정리 시 미확정 상태로 닫는다. 실제 Google 권한 부여·Drive 파일 소유/비공개 상태·Meta 실계정 수집은 운영 키와 콜백 설정 뒤 별도 실계정 QA가 필요하다.

## 자료 열람과 퍼널 집계

자료 통계와 가이드 퍼널은 같은 집계 기준을 쓴다. 봇·워크스페이스 구성원은 클릭 전환 집계에서 제외한다.

- **전체 클릭**은 유효한 링크 클릭 전체다. 자료 통계에서는 해당 자료에 현재 또는 과거에 연결된 유입 링크의 클릭을 센다. **측정 가능 클릭**은 클릭 ID와 클릭 당시 자료 목적지가 모두 기록되어 해당 자료의 열람과 연결할 수 있는 클릭이다. 이전 클릭처럼 목적지를 확인할 수 없는 기록은 열람률 분모에서 제외한다.
- **전체 열람**의 새 기록은 실제 자료 화면을 연 뒤 집계한다. 새 폼 제출로 미리 발급한 세션은 자료를 열기 전에는 세지 않고, 같은 열람 토큰의 게이트 갱신·메일 인증은 이어 보기로 처리한다. 기존 기록은 보존하므로 과거 기록에는 실제 열림 여부를 확인할 수 없는 폼 예약 기록이 포함될 수 있다.
- **고유 열람(클릭)**은 유효한 클릭 ID마다 한 번 센다. **열람률 = 고유 열람 / 측정 가능 클릭**이며, 분모가 없으면 `-`(측정 기록 없음)로 표시한다. 과거 클릭만 있는 경우를 0%로 표시하지 않는다.
- **재열람**은 같은 자료·방문자 쿠키(브라우저 추정)에서 처음 이후 발생한 열람 세션 수다. 쿠키가 없는 열람을 반복으로 추정하지 않는다. 사람 수를 식별한 값이 아니며, 클릭 기준 고유 열람과 별도 지표라 둘을 합산하지 않는다.
- 직접 방문·과거 기록 등 클릭과 연결할 수 없는 기록은 **미연결 열람**으로 따로 표시하고 열람률에서 제외한다. 기존 클릭과 열람을 소급 추정해서 연결하지 않는다.

## 웹 SDK

브랜드 사이트에 심어 인플루언서 링크 클릭 뒤의 방문, 스크롤, 전환을 모은다. 소스는 `sdk/`, 빌드 결과는 `public/sdk/v1.js`(깃 제외)이고 Worker가 `/sdk/v1.js`로 서빙한다. 이벤트는 `POST /collect`로 받아 Queue(`avocado-collect`)에서 D1 집계로 반영한다.

### 사이트 등록과 설치

1. 앱 LNB 분석 > 사이트 분석에서 사이트를 등록한다 (이름, 허용 도메인, 동의 모드). 허용 도메인이 아닌 출처의 이벤트는 403으로 버린다
2. 화면의 설치 스니펫을 사이트의 모든 페이지 `<head>`에 넣는다

```html
<script>
  window.avocado = window.avocado || function () { (window.avocado.q = window.avocado.q || []).push(arguments); };
</script>
<script async src="https://app.example.com/sdk/v1.js" data-site="site_xxxxxxxxxxxx"></script>
```

3. 전환과 식별은 사이트 코드에서 부른다: `avocado('conversion', { type: 'purchase', value: 39000, currency: 'KRW', orderId: 'A-1' })`, `avocado('identify', { email })`(기본은 SHA-256 해시만 전송)
4. 리드 링크의 목적지가 등록 도메인이면 `/l` 클릭 때 `avc` 클릭 ID가 붙어 링크·인플루언서별 방문·전환으로 묶인다 (가이드 상세 리드 탭 묶어 보기, 리드 링크 표)

동의 모드가 "동의 필요"인 사이트는 스니펫에 `data-consent="require"`가 붙고, 사이트가 `avocado('consent', 'granted')`를 부르기 전에는 아무것도 보내지 않는다.

### identify 재시도와 집계 소유권 (AIWITH-390)

`0028_collect_identify_retry.sql`을 적용한다. 방문 집계의 `site_event_ids`와 사람 연결의 `site_identify_jobs`는 독립적으로 완료를 기록한다. 집계 트랜잭션에 암호화된 identify 작업도 함께 남긴 뒤 기존 PIPELINE에는 작업 ID만 보낸다. 사람 연결 실패나 Queue 등록 실패가 나도 pending 원장이 남아 다시 처리하며, 같은 작업을 재시도할 때 방문·전환 집계를 다시 증가시키지 않는다. 연락처·이름·외부 식별자 원문은 작업 본문에 암호화하고 처리 후 지운다. 원문 수집이 꺼져 있으면 SQL 실행 시에도 원문을 제외한 암호문을 고른다. 기존 `TOKEN_ENC_KEY`가 필요하고 설정 오류는 검증 없이 성공으로 처리하지 않는다.

집계 소비자는 사이트별 짧은 random-token lease를 얻은 뒤 중복 기록·세션을 읽는다. native batch 첫 문장은 현재 소유 토큰을 검증하며, 마지막 문장에서 같은 토큰을 해제한다. 만료 뒤 다른 소비자가 토큰을 얻었다면 옛 쓰기는 모두 롤백된다. 시간만 지났고 토큰은 여전히 본인 것이면 commit할 수 있다. 같은 봉투 안의 중복 ID도 한 번만 반영한다. 사람 연결은 SQL claim·현재 canonical person 선택·리드/출처/별칭/세션/전환 연결·완료 영수증을 한 native batch에 넣는다. 현재 원장을 보며 canonical ID를 고르고, 작업별 출처 ID를 고정해 동시 처리·부분 실패·응답 손실에도 출처를 중복 생성하지 않는다. 다른 이메일 해시를 가진 사람의 별칭은 합치지 않고, 이전 작업이 새 등록 프로필·별칭을 덮지 않는다.

receivedAt은 최초 HTTP 수신 시 서버가 기록한 시각을 유지한다. 미래 시각이나 24시간 지난 identify는 처리하지 않는다. 모든 실제 쓰기에서 현재 사이트·워크스페이스·세션·익명 ID, 리드 삭제 상태와 생성 시각을 다시 검사하며 원문 리드 쓰기는 현재 `collect_raw_email`도 확인한다. 리드 파기·재신청은 기존 작업과 연결된 원시 세션·전환까지 정리하고, 삭제 사이트의 작업은 FK cascade로 지운다. 삭제된 작업을 오래된 집계 메시지에서 재생성하지 않는다.

Cloudflare Queue는 [재시도 횟수를 소진하면 DLQ가 없는 메시지를 삭제한다](https://developers.cloudflare.com/queues/configuration/batching-retries/#delivery-failure). 별도 리소스를 만들지 않고 기존 정리 Queue가 pending 원장을 다시 발견한다. 한 실행에서 만료된 작업 최대 100개, 비활성 작업 본문 최대 100개를 정리하고 유효한 pending ID 최대 50개를 다시 넣는다. 24시간이 지나면 처리·복호화를 멈추고 다음 정리에서 파기한다. 물리 파기는 Queue 대기·실패·배치 상한에 따라 후속 주기로 넘어갈 수 있다. 처리 실패는 정규화된 오류 코드로 남고 Queue 재시도로 전파하며, 정리 로그에는 건수만 남긴다.

기존 `avocado-collect`의 `max_batch_size`는 1로 제한한다. 50개 전환과 50개 identify는 각각 JSON bulk SQL 1개로 저장한다. 정상 집계는 최대 6개 D1 바인딩 호출·15개 물리 SQL과 Queue 전송 1회, identify 작업은 정상 13개·실패 증거 기록 포함 최대 14개 물리 SQL을 사용한다. 새 HTTP·R2 호출이나 신규 Queue는 없다. 기존 정리 consumer는 Sheets 배치·join 제한 정리·identify·급감 알림 정리를 합쳐 5개 D1 바인딩 호출·15개 물리 SQL과 Queue 전송 최대 2회를 사용한다. 기존 24시간 이벤트 중복 제거 창은 유지한다.

### 개발

```bash
npm run sdk:build   # public/sdk/ 에 v1.js, v1.x.y.js, v1.x.y.mjs 생성 (dev 서버에서 /sdk/v1.js 로 열림)
npm run sdk:test    # vitest + happy-dom
npm run sdk:size    # gzip 크기 확인 (한도 10KB)
```

`public/sdk/`는 빌드 산출물이라 깃에 올리지 않는다. `npm run build`가 매번 다시 만든다. 배포한 버전 원본과 SHA-256/SRI는 `sdk/releases/`와 `manifest.json`에 보존하며, clean build도 이 파일들을 그대로 복원한다.

SDK 1.1.0부터는 `GET /sdk/config?site=...`로 허용 Origin의 사이트 동의 모드를 받은 뒤에만 저장·수집을 시작한다. 설정 오류·timeout은 수집을 시작하지 않는다. 명시한 `data-consent`/`init` 설정과 CMP `consent` 명령은 유지하며, require 모드와 현재 동의 상태를 따로 관리한다. DNT/GPC는 grant로 해제하지 않는다. preload 큐도 명령 당시 동의 상태로 처리하고 철회·reset·동의 세대 전환 이전 명령을 이후 grant로 다시 보내지 않는다. reset/철회가 있으면 constructor 전에 저장된 tracking identity·offline 자료를 지우며 과거 attribution도 복원하지 않는다. 설정 변경은 다음 페이지 초기화에 반영된다. 기존 v1.0.0 고정본에는 이 bootstrap이 없으므로 해당 설치는 새 버전과 SRI로 명시 업그레이드해야 한다.

새 버전은 `sdk/package.json`의 version을 올리고 `npm run sdk:build` 후 `npm --prefix sdk run release:prepare`로 로컬 원본·manifest를 등록한다. 이후 같은 버전의 바이트가 달라지면 build가 실패한다. 아직 출시하지 않은 새 버전이라도 이미 등록된 원본을 덮어쓰지 말고 version을 올린다. `release:prepare`는 R2 업로드나 배포를 하지 않는다.

Worker는 manifest에 있는 `/sdk/vX.Y.Z.js`와 `.mjs`만 서빙한다. R2에 없으면 trusted bundled static bytes의 해시를 검증하고 `If-None-Match: *` 조건부 생성으로 보존한다. 기존 R2 해시가 다르면 덮어쓰기·최신본 fallback 없이 503, 알 수 없는 버전은 404다. 고정 버전은 CORS와 immutable cache를 제공하며, `/sdk/v1.js`만 최신 manifest 버전으로 바뀌고 매번 재검증한다. 고정본 설치에는 manifest의 `integrity`와 `crossorigin="anonymous"`를 함께 쓴다. 실제 R2 쓰기는 이 코드가 운영에 배포된 뒤 알려진 파일의 첫 요청에서 발생한다.

## 서비스명 바꾸기

`src/shared/brand.ts`의 `SERVICE_NAME` 한 줄만 바꾸면 아래가 모두 따라 바뀐다.

- 랜딩·로그인·가입·온보딩의 로고와 문구, 푸터, 브라우저 탭 제목(`index.html`은 빌드와 dev에서 vite 플러그인이 주입)
- 인증번호 문자 머리말(`SMS_PREFIX`), 문의 접수 메일 제목
- 문구 속 서비스명 뒤 조사(`withJosa`가 받침에 맞춰 고른다)

이 파일 밖에 "avocado" 리터럴을 새로 쓰면 `src/shared/brand.test.ts`가 실패한다. 의도한 기술 식별자면 그 테스트의 허용 목록에 이유와 함께 추가한다.

### 따로 바꿔야 하는 운영 설정

- 도메인: `APP_URL`, `PUBLIC_SHORT_BASE`, Worker 라우트와 DNS
- 메일: `EMAIL_FROM`의 표시 이름, Resend 도메인과 발신 주소 인증
- 문자: 발신 프로필, 발신번호 등록 내용
- 외부 콘솔의 앱 이름(OAuth 동의 화면 등)과 Cloudflare 프로젝트 표시 이름

### 바꾸지 않는 기술 식별자

| 식별자 | 이유 |
| --- | --- |
| 웹 SDK 전역 `window.avocado`, `avocado('conversion', ...)` 안내 문구, `sdk/`, 클래스 `AvocadoSdk` | 바꾸면 브랜드 사이트에 이미 설치된 스니펫이 깨진다 |
| Queue `avocado-pipeline`, `avocado-collect`, D1 `avocado-db`, Worker 이름 | 바꾸면 새 리소스를 만들고 데이터를 옮겨야 한다 |
| User-Agent `AvocadoSnapshot`, `AvocadoProductReader` | 외부 사이트 허용 목록, 로그 식별에 쓰인다 |
| 개발용 `/dev/ui` 카탈로그 | 사용자에게 보이지 않는다 |

## 사이트 전환 금액 환산 (AIWITH-388)

사이트 카드의 최근 7일 금액은 수신일(KST)과 당시 구성원 제외 기준을 유지한 통화별 익명 집계에서 계산한다. 원본 전환의 금액·통화는 바꾸지 않는다. 개인정보 파기로 개인별 전환을 삭제해도 익명 합계는 유지하며, 사이트 자체를 파기하면 FK로 함께 삭제한다. 수집 HTTP에서 생략된 통화는 당시 사이트 설정으로 고정한다.

환율은 [ECB의 공개 EUR 기준 참조 환율](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html)을 사용한다. 전환 발생 UTC 일자 이하의 가장 가까운 공표일을 사용하고 7일보다 오래된 값은 쓰지 않는다. 보고 요청이 읽은 기준 통화와 계산 단위를 같은 snapshot에 묶는다. 이는 일별 분석용 참조 금액이며 결제·정산 환율은 아니다.

Cron은 전역 작업 하나만 Queue에 넣고, 별도 소비자가 90일 XML을 8초·256KiB 한도로 검증한다. 성공 캐시는 12시간, 오류 재시도는 1시간 간격이다. 사용자 정보는 ECB로 보내지 않으며 수집/보고 요청에서 외부 환율 API를 부르지 않는다.

미지원 통화·미확보 환율·표현 불가능한 금액은 합계에 섞지 않고 환산 대기 건수를 표시한다. 배포 전 파기된 원본 등으로 기존 집계의 통화를 복원할 수 없으면 해당 전환 건수를 미환산으로 남긴다. 기존 원본의 수신 시각이 없으면 발생 시각을 사용한다. 운영 전환 데이터가 없는 상태에서 이 마이그레이션을 준비했다.

## 사이트 급감 알림 (AIWITH-389)

`0030_site_alerts.sql`을 적용한다. 사이트 카드의 **급감 알림**에서 사이트별 감지와 내 계정 이메일 받기를 직접 켠다. 기본은 모두 꺼져 있다. 소유자·편집자만 기준 변경과 자기 구독을 할 수 있고, 보기 역할은 기존 자기 구독 해제만 가능하다. 다른 수신자 주소는 입력하거나 지정하지 않는다. 사이트당 현재 유효한 활성 구독은 최대 20명이며, 이는 유한한 Queue 처리량을 위한 기술 한도로 요금제 할당량과 별개다. 탈퇴·보기/승인 역할로 변경·전화 인증 해제·이메일 변경·사이트 삭제는 원래 변경과 같은 트랜잭션의 DB trigger에서 구독을 끄고 구독 세대를 회전시킨다. 쿨다운은 보존하며 역할 복구·재가입만으로 다시 켜지지 않는다. 새 자기 구독 동의가 필요하고, 옛 세대 메일은 다시 실행하지 않는다. 한도·탐지 fanout·메일 전달은 동일한 현재 사이트/역할/인증 조건을 사용한다.

기본 정책은 **페이지뷰가 그전 7일 일평균의 20% 이하(80% 이상 감소), 기준 평균 100건/일 이상, 완료된 2일 연속**이다. 전환 수를 고르면 기본 최소 평균은 10건/일이다. 비율 0~90%, 최소 평균 1~1,000,000, 확인 기간 1~3일을 명시적으로 바꿀 수 있다. 각 확인일은 전주 같은 요일 수의 같은 비율 이하이기도 해야 한다. 전주 수가 0이거나 첫 이벤트가 7일 기준 기간 시작보다 최근면 이력 부족으로 기다린다. 설치가 확인된 기간의 없는 날만 0으로 취급한다. 구성원 제외가 이미 적용된 `site_daily_stats`만 읽고, 현재 부분일·SDK 원본·개인 식별·Analytics Engine은 읽지 않는다. 지표는 수집된 페이지뷰/전환 수이며 전체 이벤트 수나 장애를 확정하는 신호가 아니다.

KST 날짜를 쓰며 매일 09:00 이후 첫 정리 Queue가 전날까지를 확인한다. 기존 15분 Cron이 넣는 `cleanup_google_sheets` consumer를 재사용하므로 Queue 지연·실패 시 검사와 정리가 늦어질 수 있다. 한 정리 호출은 사이트 20개, 메일 50개를 발견하고 남은 검사/메일은 별도 `site_alert_maintenance`로 이어 간다. 한 메시지는 사이트 한 개 또는 수신자 한 명만 처리한다. enqueue 실패나 실행 실패는 정규화된 오류로 전파하고, D1 원장에 남은 대상을 다음 주기에도 다시 발견한다. 신규 클라우드 리소스·키는 없다.

`TOKEN_ENC_KEY`, 기존 `RESEND_API_KEY`, 인증된 실제 `EMAIL_FROM`이 모두 필요하다. 예제·테스트 발신 주소나 설정 누락은 `blocked`로 남기고 메일 HTTP를 호출하지 않는다. 사이트·현재 역할·사용자 이메일·자기 구독·설정 세대를 claim과 HTTP 직전에 다시 확인한다. 최신 집계가 회복됐거나 확인 기간이 지난 메일은 보내지 않는다. 사이트·사용자별 첫 전달 시도부터 7일 동안 새 알림을 제한하며 감지/구독을 껐다 켜거나 정책 세대를 바꿔도 이 시간은 유지된다. HTTP를 시작하지 않은 취소만 자신의 예약을 되돌릴 수 있다. 이미 시작한 요청은 설정을 바꿔도 회수할 수 없다.

첫 시도의 받는 주소·제목·본문·발신 계정 지문은 암호화해 고정하고, `site-alert/<outbox ID>`를 Resend idempotency key로 사용한다. [Resend의 중복 방지 보장은 24시간](https://resend.com/docs/dashboard/emails/idempotency-keys)이므로 응답 손실은 같은 본문/키로만 15분 뒤 재시도하고, 최초 시도 23시간 59분 이후에는 `unknown`으로 닫아 자동 재전송하지 않는다. 수신자·발신 설정·세대 변경 뒤 불확실한 시도도 `unknown`으로 남는다. 메일은 해당 검사 생성 후 최대 24시간까지만 시도하며 이전 날짜 알림은 취소한다. `sent`는 provider 접수 확인이고 실제 수신 보장은 아니다.

네 테이블은 사이트 설정, 자기 구독/쿨다운, 숫자 검사 기록, 발송 outbox다. 주소 원문은 별도로 저장하지 않고 구독에는 도메인이 분리된 HMAC만 남긴다. 종료된 메일의 암호화 본문은 즉시 지운다. 24시간이 지난 미완료 본문은 정리 대상이 되어 다음 정리 Queue에서 지우며, 실행 중인 5분 lease는 중간에 덮지 않는다. 검사와 연락처/본문 없는 발송 영수증은 생성 30일 뒤 각 최대 100개씩 파기 대상으로 삼는다. 현재 부적격인 구독이 남았다면 설정 저장의 원자 배치 또는 정리 호출당 최대 100개를 비활성화하고 세대를 회전시킨다. 정리만 남은 backlog는 다음 15분 정리 주기에서 이어 처리하며 정확한 TTL 시각의 전체 파기를 약속하지 않는다. 삭제 사이트의 설정·구독·검사는 FK로 삭제하고, 부모 없는 발송 영수증은 불확실성을 숨기지 않도록 남긴 뒤 본문을 정리하고 같은 30일 기준으로 파기한다. 활성 설정/자기 구독과 마지막 시도 시각은 설정·쿨다운 유지에 사용한다. 로그에는 처리·실패·남은 건수만 남기고 주소·본문·provider 오류 원문을 기록하지 않는다.

정상 탐지는 7개 물리 SQL+Queue 전송 1회, 메일은 8개 SQL+메일 HTTP 1회다. 오류 증거 기록/lease 해제도 각각 SQL 1회 추가 이내다. 기존 정리와 합친 consumer는 15개 SQL+Queue 전송 최대 2회이고, 별도 알림 정리는 8개 SQL+Queue 전송 1회다. 각 SQL 바인딩은 100개 이하, 기존 PIPELINE `max_batch_size=1`을 유지한다. 실제 발신 도메인·`EMAIL_FROM` 설정 후 운영 메일의 접수/수신 QA는 별도로 진행해야 한다. 로컬 회귀는 실제 SQLite와 가짜 메일 HTTP만 사용한다.

## 알려진 한계

- 서버에 ffmpeg가 없다. 프레임·오디오는 업로드하는 브라우저가 뽑는다. 브라우저가 뽑지 못한 영상은 전사·시각 판정 없이 검수함에 들어간다
- AI는 Workers AI 바인딩을 쓴다. 로컬 dev에서도 실제 호출은 Cloudflare 계정으로 원격 실행된다 (`AI_FAKE=1`이면 고정 응답)
- 카카오 알림톡은 어댑터 자리만 있다. 연결 전까지 알림톡 규칙은 저장 단계에서 막힌다
- Google Sheets 내보내기는 앱 OAuth의 추가 콜백과 Google Sheets/Drive API 활성화가 필요하다. 운영 설정 전에는 준비 중으로 표시하며 실제 권한 부여 검증은 설정 후 진행한다
- 반송 반영에는 Resend 웹훅 구독과 `RESEND_WEBHOOK_SECRET` 등록이 필요하다. Resend ID를 저장하지 않았던 이전 발송은 반송과 자동으로 연결하지 않는다
- `npm audit`의 moderate 4건은 drizzle-kit이 쓰는 옛 esbuild(개발 도구 전용)라 배포되는 Worker와 무관하다
- `wrangler.jsonc`의 `"minify": true`는 Vite 빌드에서 무시된다는 경고가 뜬다. 실제 압축은 `vite.config.ts`에서 켜져 있다
- 클라이언트 번들 중 `index` 청크가 500KB를 넘는다는 Vite 경고가 있다 (PDF 뷰어와 에디터는 이미 지연 로드)
- SDK archive는 확보한 v1.0.0 운영 원본부터 보존한다. 보존 전 같은 URL로 배포됐던 다른 과거 바이트와 SRI까지 복구했다고 보장하지 않는다
- 0009 이전에 들어온 리드는 이메일 해시가 비어 있어, Cron이 200건씩 채우기 전까지 SDK `identify`(해시)로 기존 리드와 연결되지 않는다
- SDK 스크롤 깊이는 scroll 이벤트를 200ms마다 확인한다. 화면보다 짧은 페이지는 로드 즉시 100%로 잡힌다
- Analytics Engine 원본 이벤트(클릭 좌표 등)는 쓰기만 하고 아직 읽는 화면이 없다
