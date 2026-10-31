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
| `TOKEN_ENC_KEY` | 인스타그램·Google Sheets 토큰과 임시 내보내기 자료 암호화, 32바이트 이상 (바꾸면 기존 연결·임시 자료 복호화 불가) | 인스타그램과 시트 연결 꺼짐 |
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

### 개발

```bash
npm run sdk:build   # public/sdk/ 에 v1.js, v1.x.y.js, v1.x.y.mjs 생성 (dev 서버에서 /sdk/v1.js 로 열림)
npm run sdk:test    # vitest + happy-dom
npm run sdk:size    # gzip 크기 확인 (한도 10KB)
```

`public/sdk/`는 빌드 산출물이라 깃에 올리지 않는다. `npm run build`가 매번 다시 만든다.

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

## 알려진 한계

- 서버에 ffmpeg가 없다. 프레임·오디오는 업로드하는 브라우저가 뽑는다. 브라우저가 뽑지 못한 영상은 전사·시각 판정 없이 검수함에 들어간다
- AI는 Workers AI 바인딩을 쓴다. 로컬 dev에서도 실제 호출은 Cloudflare 계정으로 원격 실행된다 (`AI_FAKE=1`이면 고정 응답)
- 카카오 알림톡은 어댑터 자리만 있다. 연결 전까지 알림톡 규칙은 저장 단계에서 막힌다
- Google Sheets 내보내기는 앱 OAuth의 추가 콜백과 Google Sheets/Drive API 활성화가 필요하다. 운영 설정 전에는 준비 중으로 표시하며 실제 권한 부여 검증은 설정 후 진행한다
- 반송 반영에는 Resend 웹훅 구독과 `RESEND_WEBHOOK_SECRET` 등록이 필요하다. Resend ID를 저장하지 않았던 이전 발송은 반송과 자동으로 연결하지 않는다
- `npm audit`의 moderate 4건은 drizzle-kit이 쓰는 옛 esbuild(개발 도구 전용)라 배포되는 Worker와 무관하다
- `wrangler.jsonc`의 `"minify": true`는 Vite 빌드에서 무시된다는 경고가 뜬다. 실제 압축은 `vite.config.ts`에서 켜져 있다
- 클라이언트 번들 중 `index` 청크가 500KB를 넘는다는 Vite 경고가 있다 (PDF 뷰어와 에디터는 이미 지연 로드)
- 웹 SDK의 고정 버전 파일(`v1.x.y.js`)은 빌드마다 새로 만들어져 예전 버전이 남지 않는다. SRI로 예전 버전을 고정한 사이트는 깨질 수 있다
- 0009 이전에 들어온 리드는 이메일 해시가 비어 있어, Cron이 200건씩 채우기 전까지 SDK `identify`(해시)로 기존 리드와 연결되지 않는다
- SDK 스크롤 깊이는 scroll 이벤트를 200ms마다 확인한다. 화면보다 짧은 페이지는 로드 즉시 100%로 잡힌다
- Analytics Engine 원본 이벤트(클릭 좌표 등)는 쓰기만 하고 아직 읽는 화면이 없다
