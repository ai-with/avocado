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
| `EMAIL_FROM` | 발신 주소 (Resend에서 인증한 도메인) | `no-reply@example.com` |
| `SUPPORT_EMAIL` | 도움 받기 문의를 받을 운영 주소 (선택, 실제 발송은 `RESEND_API_KEY`도 필요) | 문의를 저장만 하고 메일은 보내지 않는다 |
| `SMS_PROVIDER` | `solapi`로 두면 문자 발송 | 문자 미발송. 운영에서는 인증번호를 받을 수 없어 가입이 막힌다 (필수) |
| `SOLAPI_API_KEY`, `SOLAPI_API_SECRET` | Solapi 인증 | 위와 같음 |
| `SMS_FROM` | Solapi에 등록한 발신 번호 | 위와 같음 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | 구글 로그인 (둘 다 있어야 켜짐) | 로그인·가입 화면의 구글 버튼이 "준비 중"으로 비활성 |
| `META_APP_ID`, `META_APP_SECRET` | 인스타그램 연결 OAuth, 웹훅 서명 검증 (필수) | 인스타그램 연결, 키워드 DM이 "연결 준비 중" |
| `META_VERIFY_TOKEN` | 웹훅 등록 확인용 임의 문자열 (필수) | 웹훅 등록 불가 |
| `TOKEN_ENC_KEY` | 인스타그램 토큰 암호화 키, 32바이트 이상 임의 문자열 (필수, 바꾸면 기존 연결이 모두 끊김) | 인스타그램 연결 꺼짐 |
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
- 구글 시트 내보내기는 구현하지 않았다 (CSV 내보내기만)
- 이메일 반송(bounce) 웹훅이 없어 반송 주소를 자동으로 거르지 못한다
- `npm audit`의 moderate 4건은 drizzle-kit이 쓰는 옛 esbuild(개발 도구 전용)라 배포되는 Worker와 무관하다
- `wrangler.jsonc`의 `"minify": true`는 Vite 빌드에서 무시된다는 경고가 뜬다. 실제 압축은 `vite.config.ts`에서 켜져 있다
- 클라이언트 번들 중 `index` 청크가 500KB를 넘는다는 Vite 경고가 있다 (PDF 뷰어와 에디터는 이미 지연 로드)
- 웹 SDK의 고정 버전 파일(`v1.x.y.js`)은 빌드마다 새로 만들어져 예전 버전이 남지 않는다. SRI로 예전 버전을 고정한 사이트는 깨질 수 있다
- 0009 이전에 들어온 리드는 이메일 해시가 비어 있어, Cron이 200건씩 채우기 전까지 SDK `identify`(해시)로 기존 리드와 연결되지 않는다
- SDK 스크롤 깊이는 scroll 이벤트를 200ms마다 확인한다. 화면보다 짧은 페이지는 로드 즉시 100%로 잡힌다
- Analytics Engine 원본 이벤트(클릭 좌표 등)는 쓰기만 하고 아직 읽는 화면이 없다
