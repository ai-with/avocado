# DESIGN.md: avocado 화면 디자인 가이드

디자이너가 없는 팀에서 프론트 에이전트가 새 화면을 만들 때 읽는 단일 문서다. 값과 props는 모두 코드에서 옮겼다. 코드와 이 문서가 다르면 코드가 맞고, 이 문서를 고친다.

- 토큰: `src/client/styles/tokens.css` (1층 원시, 2층 의미)
- 전역 스타일·유틸리티 클래스: `src/client/styles/base.css`
- 공통 컴포넌트: `src/client/ui/` (`index.ts`에서 모두 내보냄)

## 목차

1. [이 문서를 쓰는 법](#1-이-문서를-쓰는-법)
2. [원칙](#2-원칙)
3. [토큰 표](#3-토큰-표)
4. [공통 컴포넌트 카탈로그](#4-공통-컴포넌트-카탈로그)
5. [레이아웃 패턴](#5-레이아웃-패턴)
6. [상태 표현](#6-상태-표현)
7. [문구 규칙](#7-문구-규칙)
8. [금지 패턴](#8-금지-패턴)
9. [새 토큰·새 컴포넌트가 필요할 때](#9-새-토큰새-컴포넌트가-필요할-때)
10. [확인 방법](#10-확인-방법)
11. [유지 규칙](#11-유지-규칙)

## 1. 이 문서를 쓰는 법

작업 전 체크 5줄.

1. 만들 화면 유형을 5절에서 고르고, 같은 유형의 실제 화면 파일을 먼저 연다. 열 수 없으면 4~6절만으로 조립해도 된다(시험 화면 `src/client/pages/dev-ui/sample/`이 이 문서만으로 만든 예).
2. 필요한 UI를 4절 카탈로그에서 먼저 찾는다. 있으면 그대로 쓰고, 새 버튼·입력·카드 마크업을 만들지 않는다.
3. 색·간격·글자·모서리·그림자는 3절의 의미 토큰과 base.css 유틸리티 클래스만 쓴다. 숫자를 직접 쓰지 않는다.
4. 끝나면 `npm run lint:design`을 통과시킨다.
5. PC(1440)와 휴대폰(390) 두 폭에서 캡처해 확인한다(10절).

## 2. 원칙

코드에서 실제로 지켜지고 있는 것만 적었다.

1. **따뜻한 흰 바탕 위 흰 카드, 깊이는 배경 단계와 얇은 링으로.** 바탕은 `--color-bg`(#fefdfb), 카드는 `--color-surface`(흰색)에 `--shadow-card`(1px 링 + 아주 옅은 그림자). 진한 그림자로 띄우지 않는다. 한 단계 낮은 면은 `--color-surface-subtle`(Stat, EmptyState, 공개 화면 바탕).
2. **초록 강조색은 "누를 곳"과 "선택됨"에만.** 쓰는 곳은 primary 버튼, 선택된 칩, 링크, 사이드바 활성 아이콘, accent 배지뿐이다. 한 화면 머리(PageHeader actions)에는 primary 버튼을 하나만 둔다. 나머지는 secondary 또는 ghost. 탭 선택 표시는 강조색이 아니라 검정(`--color-text-primary`) 밑줄이다.
3. **글자 위계는 크기를 적게, 굵기는 semibold 하나, 색은 3단계.** 앱 화면 제목은 20px(`--text-title-size`)이 가장 크다. 그 아래 h3는 18px, h4는 16px로 자동으로 낮아진다(AppShell.css). 본문 14px, 보조 13px, 캡션 12px. 색은 primary, secondary, tertiary 세 가지.
4. **밀도는 낮게.** 화면 덩어리 사이 24px(`.stack-loose`), 카드 안 20~24px, 목록 위아래 요소 사이 16px(`.stack`). 앱 본문 최대 폭 1200px.
5. **빈 화면·로딩·작은 손가락도 화면의 일부.** 숫자 0 대신 다음 할 일을 보여 주고(EmptyState, Home 지표), 로딩은 `LoadingState` 스켈레톤, 터치 기기에서는 누르는 영역 44px, 아이콘 버튼에는 이름이 필수다.

## 3. 토큰 표

**원시 토큰(`--neutral-0`, `--green-600`, `--red-700` 같은 팔레트 이름)은 화면 코드에서 직접 쓰지 않는다.** 아래 의미 토큰만 쓴다.

### 3.1 색

| 토큰 | 값 | 언제 쓰나 | 쓰면 안 되는 곳 |
|-|-|-|-|
| `--color-bg` | #fefdfb | 페이지 바탕(body, 앱 본문) | 카드·입력칸 바탕 |
| `--color-surface` | #ffffff | 카드, 모달, 드로어, 입력칸, secondary 버튼 | 페이지 바탕 |
| `--color-surface-subtle` | #f7f6f3 | 한 단계 낮은 면: Stat, EmptyState, 공개 화면 바탕, 비활성 입력칸, hover | 본문 글자 |
| `--color-surface-muted` | #f1f0ef | neutral 배지, ghost 버튼 hover, 스켈레톤 줄 | 넓은 영역 바탕 |
| `--color-surface-inverted` | #1e1d1c | 토스트 바탕, 본문 건너뛰기 링크 | 버튼(그건 primary) |
| `--color-text-primary` | #1e1d1c | 본문, 제목, 선택된 탭 | |
| `--color-text-secondary` | #5f5b55 | 설명 문단(`.text-secondary`), ghost 버튼 글자 | 제목 |
| `--color-text-tertiary` | #6c6963 | 캡션, 표 머리글, 플레이스홀더, 비선택 탭 | 오류 문구 |
| `--color-text-muted` | #a8a29e | 장식성 글자만 | 읽어야 하는 글자(대비 부족) |
| `--color-text-inverted` | #fefdfb | 어두운 면(inverted) 위 글자 | |
| `--color-border` | #dfdcd9 | 구분선, 표 줄, 카드 안 나눔선 | 입력칸 테두리 |
| `--color-border-strong` | #8c8781 | 입력칸·secondary 버튼 테두리(3:1 대비) | 장식 구분선 |
| `--color-border-focus` | #1e1d1c | 포커스 테두리·outline | |
| `--color-accent` | #3d6f22 | primary 버튼, 링크, 선택된 칩 | 넓은 면, 장식, 제목 글자 |
| `--color-accent-hover` | #2f571a | accent 요소 hover | |
| `--color-accent-subtle` | #eef5e8 | accent 배지 바탕, 글자 선택 영역 | |
| `--color-accent-muted` | #d9ebcb | 랜딩 CTA 그라데이션 | 앱 화면 |
| `--color-accent-bright` | #4e8a2e | 차트 막대, 장식 | 글자(대비 부족) |
| `--color-on-accent` | #ffffff | accent·danger 면 위 글자 | |
| `--color-on-status` | #ffffff | success·markup 같은 진한 상태색 면 위 글자 | |
| `--color-success` / `--color-success-subtle` | #007956 / #ecfdf5 | 완료·공개·승인 | 주 동작 버튼 |
| `--color-warn` / `--color-warn-subtle` | #953d00 / #fffbeb | 확인 필요, 주의 | 오류 |
| `--color-danger` / `--color-danger-subtle` | #bf000f / #fff1f2 | 오류, 삭제 버튼, 지연 | 강조 목적 |
| `--color-info` / `--color-info-subtle` | #1447e6 / #f0f9ff | 처리 중, 안내 | 링크(링크는 accent) |
| `--color-overlay` | rgba(14, 14, 16, 0.4) | 모달·드로어 뒤 배경 | |
| `--color-overlay-strong` | rgba(14, 14, 16, 0.6) | 더 어두운 덮개 | |
| `--color-paper` | #ffffff | 문서 페이지·iframe 바탕 | 카드(그건 surface) |
| `--color-media-bg` | #000000 | 영상 레터박스 | |
| `--color-markup` | #ff3b30 | 검수 프레임 위 표시선 | 오류 표시(그건 danger) |
| `--color-viewer-bg` | #44403b | 문서·PDF 뷰어 뒤 바탕 | |

상태색은 항상 `-subtle` 바탕 + 진한 글자 짝으로 쓴다(Badge가 이미 그렇게 한다).

### 3.2 글자

글꼴 `--font-sans`(Pretendard), 고정폭 `--font-mono`. 굵기 `--weight-regular`(400), `--weight-medium`(500), `--weight-semibold`(600). 700은 없다.

| 단계 | 크기 / 줄높이 (PC) | 태블릿 | 휴대폰 | 자간 | 용도 |
|-|-|-|-|-|-|
| `--text-display-size` / `--text-display-lh` | 48 / 60 | 36 / 44 | 32 / 40 | `--text-display-ls` -0.03em | 랜딩 히어로만 |
| `--text-h1-size` / `--text-h1-lh` | 32 / 44 | 28 / 38 | 24 / 32 | `--text-h1-ls` -0.02em | 랜딩·인증 화면 큰 제목 |
| `--text-h2-size` / `--text-h2-lh` | 28 / 36 | 24 / 32 | 22 / 30 | `--text-h2-ls` -0.02em | 랜딩 섹션 제목 |
| `--text-h3-size` / `--text-h3-lh` | 24 / 32 | 22 / 30 | 20 / 28 | `--text-h3-ls` -0.02em | 공개 화면 제목(`.pub-title`) |
| `--text-h4-size` / `--text-h4-lh` | 18 / 26 | 17 / 24 | 16 / 24 | `--text-h4-ls` -0.01em | 앱 안 h3, Stat 숫자 |
| `--text-title-size` / `--text-title-lh` | 20 / 28 | 같음 | 같음 | | 앱 화면 제목(PageHeader) |
| `--text-body-lg-size` / `--text-body-lg-lh` | 16 / 24 | 같음 | 같음 | | 카드 제목(SectionCard h4), 긴 읽기 글 |
| `--text-body-size` / `--text-body-lh` | 14 / 20 | 같음 | 같음 | | 기본 본문(body) |
| `--text-body-sm-size` / `--text-body-sm-lh` | 14 / 20 | 같음 | 같음 | | 버튼, 입력칸, 탭 |
| `--text-label-size` / `--text-label-lh` | 13 / 18 | 같음 | 같음 | | 라벨, 설명 문단, 작은 버튼, 토스트 |
| `--text-caption-size` / `--text-caption-lh` | 12 / 16 | 같음 | 같음 | | 캡션(`.text-caption`), 배지, 도움말 |
| `--text-overline-size` / `--text-overline-lh` | 11 / 16 | 같음 | 같음 | | 사이드바 그룹 제목 |
| `--text-input-min-size` | 16 | | | | 터치 기기 입력 글자 하한(iOS 확대 방지) |

앱 화면(`.shell-inner`) 안에서는 h3·h4 태그가 자동으로 한 단계씩 작아진다. 크기를 맞추려고 font-size를 다시 쓰지 말고 태그를 고른다.

### 3.3 간격

4px 기반. 대표 쓰임은 실제 코드에서 가져왔다.

| 토큰 | 값 | 대표 쓰임 |
|-|-|-|
| `--space-0` | 0 | |
| `--space-1` | 2px | Stat 이름표와 숫자 사이 |
| `--space-2` | 4px | 제목 아래 설명(PageHeader, SectionCard), `.row-tight` |
| `--space-3` | 6px | `.stack-tight`, 버튼 안 아이콘과 글자 |
| `--space-4` | 8px | `.row` 요소 사이, 버튼끼리, 모달 머리 |
| `--space-5` | 12px | 작은 버튼 좌우 여백, 입력칸 좌우 여백, StatGrid 칸 사이 |
| `--space-6` | 16px | `.stack`(목록 위 요소들), 버튼 좌우 여백, Stat 안 여백, 휴대폰 모달 여백 |
| `--space-7` | 20px | 탭 아래, 공개 화면 섹션 안 여백 |
| `--space-8` | 24px | `.stack-loose`(화면 덩어리 사이), SectionCard 안 여백, PageHeader 아래, 모달 안 여백 |
| `--space-9` | 32px | `.stack-section`, 앱 본문 좌우 여백 |
| `--space-10` | 40px | |
| `--space-11` | 48px | EmptyState 위아래 |
| `--space-12` | 64px | 앱 본문 아래 여백 |
| `--space-13` | 80px | 랜딩 |
| `--space-14` | 112px | 랜딩 |

레이아웃 토큰.

| 토큰 | 값 (PC, 반응형 바뀜) | 쓰임 |
|-|-|-|
| `--layout-app-max` | 1200px | 앱 본문 최대 폭 |
| `--layout-content-max` | 720px | 읽기·폼 좁은 폭(`.content-narrow`) |
| `--layout-card-padding` | 20px, 휴대폰 16px | Card 안 여백 |
| `--layout-gutter` | 64 / 32 / 20px | 랜딩·공개 화면 좌우 여백 |
| `--layout-section-gap` | 80 / 64 / 48px | 랜딩 섹션 사이 |
| `--layout-container-max` | 1400px | 랜딩 컨테이너 |
| `--layout-grid-columns` / `--layout-grid-gutter` | 12·24px / 8 / 4·16px | 랜딩 그리드 |
| `--layout-nav-height` | 64px, 태블릿 이하 56px | 랜딩 상단 바 |
| `--layout-topbar-height` | 56px | 앱 휴대폰 상단 바 |
| `--layout-sidebar` / `--layout-sidebar-collapsed` | 232px / 56px | 앱 사이드바 |
| `--sidebar-item-height` | 32px | 사이드바 항목 |
| `--icon-size-sm` | 16px | 버튼 안 아이콘 |
| `--control-height` / `--control-height-sm` | 40px / 32px | 버튼·입력칸 높이 |
| `--touch-target` | 44px | 터치 기기 최소 누르는 영역 |

### 3.4 모서리

| 토큰 | 값 | 쓰임 |
|-|-|-|
| `--radius-button` | 10px, 휴대폰 9999px | 버튼 |
| `--radius-input` | 10px | 입력칸 |
| `--radius-card` | 12px | 카드, EmptyState, ActionBar 윗모서리 |
| `--radius-modal` | 16px | 모달 |
| `--radius-popover` | 12px | 드롭다운 메뉴 |
| `--radius-xs` / `--radius-sm` / `--radius-md` / `--radius-lg` / `--radius-xl` / `--radius-2xl` | 4 / 6 / 12 / 16 / 20 / 24px | 위 이름으로 안 맞을 때만. 스켈레톤은 xs, 작은 태그는 sm |
| `--radius-full` | 9999px | 배지, 칩, 아바타, 원형 아이콘 |

### 3.5 그림자

| 토큰 | 쓰임 |
|-|-|
| `--shadow-ring` | 1px 링만. 작은 원형 아이콘 |
| `--shadow-card` | Card, SectionCard |
| `--shadow-raised` | 살짝 뜬 요소 |
| `--shadow-control` | 입력칸, secondary·primary 버튼 |
| `--shadow-button-primary` | primary 버튼 안쪽 하이라이트(`--shadow-control`과 함께) |
| `--shadow-popover` | 드롭다운, 모달, 토스트 |
| `--shadow-drawer` | 드로어 |
| `--shadow-bar` | ActionBar(아래 고정 줄) |
| `--shadow-page` | 어두운 뷰어 위 문서 페이지 |
| `--shadow-scroll-edge` | 표 가로 스크롤 가장자리 그림자 색(값이 색 하나다) |
| `--focus-ring` | 입력칸 포커스 링 |
| `--border-control` | 입력칸 테두리 전체 선언(1px solid border-strong) |

### 3.6 z-index

| 토큰 | 값 | 쓰임 |
|-|-|-|
| `--z-sticky` | 20 | ActionBar, 휴대폰 상단 바 |
| `--z-popover` | 45 | 드롭다운 메뉴 |
| `--z-drawer` | 50 | 드로어, 휴대폰 사이드바 |
| `--z-modal` | 55 | 모달 |
| `--z-toast` | 60 | 토스트, 본문 건너뛰기 링크 |

### 3.7 모션

| 토큰 | 값 | 쓰임 |
|-|-|-|
| `--duration-fast` | 150ms | hover, 색·테두리 전환 |
| `--duration-base` | 200ms | 모달·드로어·토스트 등장 |
| `--ease-out` | cubic-bezier(0.22, 1, 0.36, 1) | 모든 전환 |

`prefers-reduced-motion`은 base.css가 전역으로 처리한다. 따로 막을 필요 없다.

### 3.8 반응형 기준점

| 토큰 | 값 | 미디어 쿼리에 쓰는 숫자 |
|-|-|-|
| `--bp-tablet` | 600px | 휴대폰: `@media (max-width: 599px)` |
| `--bp-desktop` | 1024px | 태블릿 이하: `@media (max-width: 1023px)` |
| `--bp-wide` | 1440px | 캡처 기준 폭(쿼리 없음) |

CSS 변수는 `@media` 안에서 못 쓴다. 쿼리에는 위 두 숫자(599, 1023)만 쓴다. 터치 기기는 `@media (pointer: coarse)`.

## 4. 공통 컴포넌트 카탈로그

모두 한 곳에서 가져온다. 경로는 파일 위치에 따라 `../../ui`(features/x/Page.tsx), `../../../ui`(features/x/sections/*.tsx), `../ui`(pages, shell).

```tsx
import { Button, Input, PageHeader, Table } from "../../ui";
```

### 4.1 Button, IconButton, ButtonLink, ButtonAnchor (`ui/Button.tsx`)

- props: `Button`은 `ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" }`. 기본 `variant="primary"`, `size="md"`, `type="button"`.
- `IconButton`: `{ icon: IconName; label: string }` + Button props(children, aria-label 제외). 기본 `variant="ghost"`.
- `ButtonLink`: react-router `LinkProps & { variant?; size? }`, 기본 `secondary`. 앱 안 이동.
- `ButtonAnchor`: `AnchorHTMLAttributes<HTMLAnchorElement> & { variant?; size? }`, 기본 `secondary`. 외부 주소·내려받기.
- 쓴다: 모든 누르는 동작. 주 동작은 primary 하나, 보조는 secondary, 취소·접기는 ghost, 되돌릴 수 없는 삭제는 danger.
- 안 쓴다: 표 안 글자 링크나 이름 클릭(그건 `<Link>` 또는 `.link-button`). 폼 제출은 `type="submit"`을 꼭 준다.

```tsx
<Button onClick={publish}>공개하기</Button>
<Button variant="secondary" onClick={edit}>편집</Button>
<Button type="submit" disabled={busy}>{busy ? "저장 중" : "저장"}</Button>
<IconButton icon="x" label="닫기" size="sm" onClick={onClose} />
<ButtonLink size="sm" to="/dashboard/guides/new">시작</ButtonLink>
<ButtonAnchor href={`/api/leads/export?${query}`}>CSV 내보내기</ButtonAnchor>
```

### 4.2 CopyButton (`ui/CopyButton.tsx`)

- props: `{ text: string; label?: string; doneMessage?: string; size?: "sm" | "md"; variant?: "secondary" | "ghost"; disabled?: boolean; "aria-label"?: string }`. 기본 `label="복사"`, `doneMessage="링크를 복사했어요."`, `size="sm"`, `variant="secondary"`.
- 쓴다: 주소·코드 복사. 성공 토스트까지 해 준다. `ToastProvider` 안에서만 동작.
- 안 쓴다: 복사 외 동작. 직접 `navigator.clipboard`를 부르고 토스트를 따로 띄우지 않는다.

```tsx
<CopyButton text={guideUrl} aria-label="가이드 URL 복사" />
```

### 4.3 Input, Textarea, Select, Checkbox (`ui/Form.tsx`)

- props: `Input`은 `InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string; error?: string }`. `Textarea`, `Select`도 각 HTML 속성 + 같은 `{ label?, hint?, error? }`. `Checkbox`는 `Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode }`.
- `required`를 주면 라벨 옆에 "필수"가 붙는다. `hint`·`error`는 `aria-describedby`로 연결되고, `error`가 있으면 hint 대신 빨간 문구 + 빨간 테두리.
- 쓴다: 모든 입력. 라벨이 화면에 없을 때(FilterBar 안)는 `aria-label`을 준다.
- 안 쓴다: 2~6개 중 하나 고르기를 눈에 보이게 하려면 ChoiceChips.

```tsx
<Input label="이름" required value={name} onChange={(e) => setName(e.target.value)} error={fields.name} />
<Textarea label="메모" hint="인플루언서에게는 보이지 않아요." rows={4} />
<Select label="가이드" value={guide} onChange={(e) => setGuide(e.target.value)}>
  <option value="">모든 가이드</option>
</Select>
<Checkbox label="알림톡 수신에 동의해요" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
```

### 4.4 Badge (`ui/Badge.tsx`)

- props: `{ tone?: BadgeTone; dot?: boolean; children: ReactNode }`. `BadgeTone = "neutral" | "accent" | "success" | "warn" | "danger" | "info"`, 기본 `neutral`.
- 쓴다: 상태 한두 단어(공개, 작성 중, 처리 지연), 개수(3/5). 상태값은 `Record<State, BadgeTone>` 상수로 매핑(ReviewsPage `STATE_TONE`).
- tone 고르는 기준:

| 상태 성격 | tone | 예 (ReviewsPage `STATE_TONE`) |
|-|-|-|
| 시작 전, 대기 | `neutral` | waiting(대기) |
| 시스템이 처리 중 | `info` | processing(처리 중) |
| 사람이 봐야 함, 주의 | `warn` | needs_review(검토 필요) |
| 우리 쪽 할 일을 마치고 상대를 기다림 | `accent` | feedback_sent(피드백 보냄) |
| 끝남, 승인 | `success` | approved(승인) |
| 실패, 지연, 거절 | `danger` | 처리 지연 |
- 안 쓴다: 누르는 요소, 긴 문장.

```tsx
<Badge tone={published ? "success" : "neutral"}>{published ? "공개" : "작성 중"}</Badge>
<Badge tone="success" dot>완료</Badge>
```

### 4.5 Card, SectionCard (`ui/Card.tsx`)

- props: `Card`는 `HTMLAttributes<HTMLDivElement>`. `SectionCard`는 `{ title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; id?: string }`.
- 쓴다: SectionCard는 상세·편집 화면에서 기능 한 덩어리(제목 + 설명 + 오른쪽 버튼 + 본문). Card는 제목 구조가 다른 흰 상자(Home 시작하기).
- 안 쓴다: 카드 안에 카드 중첩. 목록 행마다 카드(그건 Table).

```tsx
<SectionCard title="링크" description="공유하면 누구나 열 수 있어요." actions={<Button size="sm" variant="secondary" onClick={make}>공용 링크 만들기</Button>}>
  <p>{url}</p>
</SectionCard>
```

### 4.6 Stat, StatGrid (`ui/Stat.tsx`)

- props: `Stat`은 `{ label: string; value: ReactNode; hint?: ReactNode }`. `StatGrid`는 `{ children: ReactNode }`(칸 최소 140px 자동 배치).
- 쓴다: 요약 숫자 여러 개. 숫자는 `toLocaleString("ko-KR")`. 0이면 hint에 다음 할 일 링크(Home).
- 안 쓴다: 숫자 하나뿐인 강조, 차트 대체.

```tsx
<StatGrid>
  <Stat label="리드" value={n.toLocaleString("ko-KR")} hint={n > 0 ? undefined : <Link to="/dashboard/links">리드 링크 발급하기</Link>} />
</StatGrid>
```

### 4.7 Table (`ui/Table.tsx`)

- props: `TableHTMLAttributes<HTMLTableElement> & { columns?: TableColumn[] }`. `TableColumn = { label: string; icon?: IconName; num?: boolean }`.
- 가로 스크롤 래퍼, 행 hover, 스크롤 가장자리 그림자가 들어 있다. 숫자 칸은 `className="num"`(오른쪽 정렬, 고정폭 숫자), 날짜·배지 칸은 `nowrap`. 핸들·이메일·ID처럼 중간에 끊기면 안 되는 문자열 칸도 `nowrap`(핸들·ID는 `mono nowrap`).
- 쓴다: 같은 모양 행이 여러 개인 목록.
- 안 쓴다: 레이아웃 배치용 표.

```tsx
<Table columns={[{ label: "이름" }, { label: "상태" }, { label: "열람", num: true }]}>
  <tbody>
    {rows.map((g) => (
      <tr key={g.id}><td><Link to={`/dashboard/guides/${g.id}`}>{g.name}</Link></td><td className="nowrap"><Badge>작성 중</Badge></td><td className="num">{g.viewedCount}</td></tr>
    ))}
  </tbody>
</Table>
```

### 4.8 Modal (`ui/Modal.tsx`)

- props: `{ open: boolean; title: string; description?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: "md" | "lg" }`. 기본 `md`(480px), `lg`(720px). 휴대폰에서는 아래에서 올라오는 시트.
- Esc 닫기, 포커스 가둠, 배경 스크롤 잠금, 닫으면 포커스 복귀가 들어 있다(`useDialog`). 첫 포커스를 정하려면 요소에 `data-autofocus`.
- 쓴다: 짧은 입력(추가, 가져오기), 확인 후 보내기. 버튼은 `footer`에 둔다(휴대폰에서 버튼이 가로로 꽉 찬다).
- 안 쓴다: 목록 항목 상세 보기(그건 Drawer), 화면 하나 분량의 편집(그건 별도 화면).

```tsx
<Modal open title="리드 직접 추가" onClose={onClose} footer={<Button onClick={() => void save()}>리드 추가</Button>}>
  <div className="stack"><Input label="이메일" type="email" required /></div>
</Modal>
```

입력 폼 모달: `footer`는 `<form>` 밖에 그려지므로 `form` 속성으로 잇는다. 취소는 `ghost`.

```tsx
<Modal open title="후보 추가" onClose={onClose} footer={<>
  <Button variant="ghost" onClick={onClose}>취소</Button>
  <Button type="submit" form="add-candidate">후보 추가</Button>
</>}>
  <form id="add-candidate" className="stack" noValidate onSubmit={submit}>
    <Input label="이름" required value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
  </form>
</Modal>
```

### 4.9 Drawer (`ui/Drawer.tsx`)

- props: `{ title: string; description?: ReactNode; onClose: () => void; children: ReactNode }`. 열린 동안만 렌더한다(`open` prop 없음).
- 쓴다: 표에서 한 행을 눌러 오른쪽에 상세 보기(리드 상세 `features/leads/common.tsx`).
- 안 쓴다: 입력 위주 작업(Modal), 화면 이동이 필요한 상세(별도 화면).

```tsx
{drawerId && (
  <Drawer title={lead.name} description={lead.email} onClose={() => setDrawerId(null)}>
    <SectionCard title="출처">...</SectionCard>
  </Drawer>
)}
```

### 4.10 ToastProvider, useToast (`ui/Toast.tsx`)

- props: `ToastProvider`는 `{ children: ReactNode }`(앱 최상단에 이미 있음). `useToast()`는 `(text: string, tone?: "neutral" | "success" | "danger") => void`. 3.5초 뒤 사라진다.
- 쓴다: 저장·복사·발송 같은 동작의 결과 한 줄, API 오류 문구(`errorMessage(e)`).
- 안 쓴다: 입력칸별 오류(그건 Input `error`), 사라지면 안 되는 안내.

```tsx
const toast = useToast();
try { await api.post(`/guides/${id}/publish`); toast("가이드를 공개했어요.", "success"); }
catch (e) { toast(errorMessage(e), "danger"); }
```

### 4.11 EmptyState (`ui/EmptyState.tsx`)

- props: `{ title: string; description?: string; action?: ReactNode; icon?: IconName; compact?: boolean }`.
- 쓴다: 목록이 비었을 때. 제목은 지금 상태, 설명은 채우는 방법, action은 첫 동작 버튼. 탭·카드 안처럼 좁은 곳은 `compact`.
- 두 가지를 구분한다. 데이터가 아예 없음: "아직 ~가 없어요" + 만들기 버튼(primary). 필터 결과 0건: "조건에 맞는 ~가 없어요" + "필터 지우기" 버튼(`secondary`).
- 안 쓴다: 로딩 중(LoadingState), 오류.

```tsx
<EmptyState title="아직 가이드가 없어요" description="첫 가이드를 만들면 바로 공유 링크가 나와요." action={create} />
```

### 4.12 LoadingState (`ui/LoadingState.tsx`)

- props: `{ lines?: number; label?: string }`. 기본 `lines=3`, `label="불러오는 중"`.
- 쓴다: 데이터를 받기 전(`data === null`). `return null` 대신.
- 안 쓴다: 버튼 안 진행 표시(버튼 글자를 "저장 중"으로 바꾸고 `disabled`).

```tsx
if (!rows) return <LoadingState label="검수 목록을 불러오는 중" />;
```

### 4.13 PageHeader (`ui/PageHeader.tsx`)

- props: `{ title: string; description?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }`.
- 쓴다: 앱 안 모든 화면의 맨 위 한 번. 하위 화면은 `back`으로 상위 목록 링크.
- 안 쓴다: 화면 안 구획 제목(SectionCard title), 공개 화면.

```tsx
<PageHeader title="가이드" description="가이드 하나가 기본 단위예요." actions={<Button onClick={create}>새 가이드 만들기</Button>} back={{ to: "/dashboard/guides", label: "가이드" }} />
```

### 4.14 FilterBar (`ui/FilterBar.tsx`)

- props: `{ children: ReactNode; actions?: ReactNode; label?: string }`. 기본 `label="목록 필터"`. 휴대폰에서 두 칸씩 접힌다.
- 쓴다: 표 바로 위 검색·Select 필터 줄. 안의 입력에는 화면 라벨 대신 `aria-label`. 검색칸은 `Input type="search"`, placeholder는 "~로 찾기"(예: "이름이나 핸들로 찾기"), 아이콘 없음. Select 첫 옵션은 "모든 ~"(값 `""`).
- 안 쓴다: 상태 하나로 나누는 필터(그건 Tabs, 검수 목록처럼 개수 포함).

```tsx
<FilterBar label="검수 목록 필터">
  <Select aria-label="인플루언서" value={who} onChange={(e) => setWho(e.target.value)}><option value="">모든 인플루언서</option></Select>
</FilterBar>
```

### 4.15 ActionBar (`ui/ActionBar.tsx`)

- props: `{ children: ReactNode; status?: ReactNode }`. 화면 아래에 붙어 따라오는 줄.
- 쓴다: 긴 편집 폼의 저장·취소. `status`에 저장하면 무엇이 되는지 한 줄.
- 안 쓴다: 짧은 폼(모달 footer나 폼 끝 `.row.row-end`).

```tsx
<ActionBar status="저장하면 가이드 상세 화면으로 이동해요.">
  <Button variant="ghost" onClick={cancel}>취소</Button>
  <Button type="submit">저장</Button>
</ActionBar>
```

### 4.16 Tabs (`ui/Tabs.tsx`)

- props: `{ tabs: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label?: string }` (`T extends string`). 화살표 이동, 좁으면 가로 스크롤.
- 쓴다: 한 화면 안 같은 대상의 다른 보기(가이드 상세의 인플루언서·리드 링크·검수·성과·리드), 상태별 목록 나누기.
- 안 쓴다: 다른 화면으로 이동(사이드바·링크), 폼 단계 진행.

```tsx
const TABS: { value: Tab; label: string }[] = [{ value: "contacts", label: "연락처" }, { value: "groups", label: "그룹" }];
<Tabs<Tab> tabs={TABS} value={tab} onChange={setTab} />
```

### 4.17 Icon (`ui/icons.tsx`)

- props: `{ name: IconName; size?: number }`. 기본 18. `aria-hidden` 처리돼 있다. Lucide 경로를 옮겨 둔 목록에서만 고른다(house, file-text, users, link, search, plus, check, x, chevron-left 등 34개).
- 쓴다: 글자 옆 보조 그림, EmptyState·Table 머리글·Dropdown 항목 아이콘.
- 안 쓴다: 아이콘만으로 누르는 버튼(그건 IconButton). 새 아이콘 라이브러리 설치 금지. 필요하면 lucide.dev SVG 경로를 `icons.tsx`에 추가.

```tsx
<Icon name="check" size={16} />
```

### 4.18 Dropdown (`ui/Dropdown.tsx`)

- props: `{ items: DropdownItem[]; label: string; children: ReactNode; align?: "start" | "end"; side?: "bottom" | "top"; header?: ReactNode; triggerClassName?: string; tip?: string }`.
- `DropdownItem = { label: string; onSelect: () => void; icon?: IconName; leading?: ReactNode; danger?: boolean; disabled?: boolean; divider?: boolean }`.
- 쓴다: 버튼 하나 뒤에 숨긴 동작 목록(계정 메뉴 `shell/AccountMenu.tsx`, 행의 더 보기).
- 안 쓴다: 값 고르기(Select 또는 ChoiceChips).

```tsx
<Dropdown label="계정 메뉴" align="end" items={[{ label: "설정", icon: "building-2", onSelect: goSettings }, { label: "로그아웃", icon: "log-out", danger: true, divider: true, onSelect: logout }]}>
  <Icon name="chevron-down" />
</Dropdown>
```

### 4.19 ChoiceChips (`ui/ChoiceChips.tsx`)

- props: `{ options: ChoiceOption<T>[]; label: string; hint?: string }` + 하나 고르기 `{ multiple?: false; value: T | null; onChange: (value: T) => void }` 또는 여러 개 `{ multiple: true; value: T[]; onChange: (value: T[]) => void }`. `ChoiceOption<T> = { value: T; label: string }`.
- 쓴다: 선택지 2~8개를 한눈에 보여 줄 때(온보딩 설문 `features/onboarding/sections/SurveyStep.tsx`).
- 안 쓴다: 선택지가 많거나 길 때(Select).

```tsx
<ChoiceChips label="팀 규모" options={[...TEAM_SIZES]} value={teamSize} onChange={setTeamSize} />
<ChoiceChips label="주 목표" hint="여러 개 고를 수 있어요." multiple options={[...GOALS]} value={goals} onChange={setGoals} />
```

### 4.20 base.css 유틸리티 클래스

인라인 `style` 대신 쓴다.

| 클래스 | 뜻 |
|-|-|
| `.stack-tight` / `.stack` / `.stack-loose` / `.stack-section` | 세로 쌓기, 간격 6 / 16 / 24 / 32px |
| `.row` (+ `.row-tight` `.row-wrap` `.row-end` `.row-between` `.row-start` `.row-bottom`) | 가로 배치, 간격 8px(tight 4px) |
| `.grow` | 남은 폭 차지 |
| `.mt-section` | 위 24px |
| `.content-narrow` / `.content-medium` | 최대 폭 720 / 880px |
| `.text-secondary` `.text-caption` `.text-danger` `.text-success` | 글자 색·크기 |
| `.num` `.nowrap` `.pre-wrap` `.truncate` `.mono` `.text-center` `.text-right` | 글자 배치 |
| `.sr-only` | 화면 낭독기 전용 |
| `.link-button` | 글자처럼 보이는 버튼(표 안 이름 클릭) |
| `.fieldset-plain` `.list-plain` | 기본 테두리·여백 없앤 fieldset, 목록 |

## 5. 레이아웃 패턴

### 5.1 앱 화면 골격

AppShell(`src/client/shell/AppShell.tsx`)이 사이드바, 휴대폰 상단 바, 본문 폭(`--layout-app-max` 1200px)과 여백을 이미 잡는다. 화면은 PageHeader + 본문만 쓴다.

- 본문 여백(`.shell-content`): PC 위 `--space-8`, 좌우 `--space-9`, 아래 `--space-12`. 1023px 이하 위·좌우 `--space-8`, 아래 `--space-11`. 599px 이하 위는 상단 바 높이 + `--space-7`.
- `.shell-inner` 안에서는 h3·h4가 한 단계 작게(h4·body-lg 크기) 나온다. 셸 밖 화면은 이 규칙이 없으니 h3·h4 대신 PageHeader·SectionCard 제목을 쓴다.
- 셸 밖 단독 화면(dev 화면 등): 가운데 `max-width: var(--layout-app-max)`, 위아래 `--space-9`, 좌우 `--layout-gutter`를 화면 CSS 하나에 둔다. 토스트는 앱 최상단 `ToastProvider`가 감싸므로 셸 밖에서도 된다.

```tsx
<>
  <PageHeader title="리드" description="한 줄 설명" actions={actions} />
  <div className="stack-loose">{/* 덩어리들 */}</div>
</>
```

예: `src/client/pages/Home.tsx`

### 5.2 목록

PageHeader(주 동작 = 만들기) → (Tabs) → FilterBar → Table. 비었으면 EmptyState, 받기 전이면 LoadingState.

```tsx
{rows === null ? <LoadingState /> : rows.length === 0 ? <EmptyState title="..." action={create} /> : <Table>...</Table>}
```

예: `src/client/features/guides/GuidesListPage.tsx`, `src/client/features/reviews/ReviewsPage.tsx`(Tabs + FilterBar + Table)

### 5.3 상세

PageHeader(`back`, 오른쪽에 편집 secondary + 주 동작 primary) → `.stack-loose` 안에 SectionCard 묶음 → Tabs로 하위 목록.

예: `src/client/features/guides/GuideDetailPage.tsx`, `src/client/features/reviews/ReviewDetailPage.tsx`

### 5.4 폼(편집 화면)

`<form onSubmit>` → PageHeader(`back`) → `.stack-loose` 안에 섹션별 SectionCard(각각 `sections/*.tsx` 파일) → ActionBar(취소 ghost + 저장 submit). 상태·검증은 훅(`useGuideForm.ts`)으로 뺀다.

예: `src/client/features/guides/GuideEditPage.tsx`

### 5.5 모달·드로어

- 짧은 입력, 확인: Modal + `footer`. 예: `src/client/features/leads/sections/AddLeadModal.tsx`, `ImportModal.tsx`
- 행 상세: Drawer. 예: `src/client/features/leads/common.tsx`(LeadDrawer)
- 열림 상태는 부모 화면에 두고 `{open && <XModal onClose=... />}`로 렌더한다(LeadsPage).

### 5.6 공개 화면(인플루언서용, 로그인 없음)

AppShell 밖. 모바일 우선, 넓은 화면에서는 가운데 560px. 바탕 `--color-surface-subtle`, 섹션은 흰 면 + `--radius-card`, 좌우 여백 `--layout-gutter`, 아래 고정 CTA(`.pub-cta`, 버튼 폭 100%, 높이 44px 이상, safe-area 여백). 문구는 i18n `t()`로.

예: `src/client/features/public-guide/GuidePublicPage.tsx`, `src/client/features/public-guide/public.css`, `src/client/features/reviews/FeedbackPublicPage.tsx`

## 6. 상태 표현

| 상태 | 쓰는 것 | 규칙 |
|-|-|-|
| 로딩 | `LoadingState` | `data === null`일 때. `label`에 무엇을 불러오는지. 버튼 진행은 글자 "저장 중" + `disabled` |
| 빈 상태 | `EmptyState` | 제목은 상태("아직 가이드가 없어요"), 설명은 채우는 법, action은 첫 동작. 지표 0은 숫자 대신 다음 할 일 링크 |
| 입력 오류 | Input·Textarea·Select의 `error` | 서버가 준 필드 오류(`ApiError.fields`)를 칸마다. 폼 전체 오류는 `<p className="field-error" role="alert">` |
| 클라이언트 필수 검증 | 같은 `error` | 제출할 때 검사(입력 중 아님), `<form noValidate>`로 브라우저 말풍선 끔. 문구 "~을/를 입력해 주세요." |
| 동작 오류 | `toast(errorMessage(e), "danger")` | try/catch로 잡아 토스트. 화면을 비우지 않는다 |
| 성공 | `toast("...했어요.", "success")` | 저장·복사·발송 결과 한 줄. 화면 이동이 결과를 보여 주면 생략 가능 |
| 비활성 | `disabled` 속성 | 버튼은 반투명 + not-allowed, 입력칸은 `--color-surface-subtle` 바탕. 왜 못 누르는지 hint나 캡션으로 |
| 상태값 | `Badge` + tone 매핑 상수 | 색만으로 구분하지 않는다. 항상 글자 |
| 위험 확인 | 현재는 `confirm()` | 삭제 등. 문구는 해요체 질문 |

## 7. 문구 규칙

- **해요체.** "만들면 바로 공유 링크가 나와요." 합쇼체(~습니다)와 반말을 쓰지 않는다.
- **짧게.** 설명은 한두 문장. 한 문장에 한 가지.
- **버튼은 동사.** "저장", "추가", "공개하기", "새 가이드 만들기", "CSV 내보내기". "확인", "예"처럼 무엇을 하는지 모르는 말은 피한다. 진행 중은 "저장 중".
- **빈 상태 제목**: "아직 ~가 없어요". 설명: "~하면 ~돼요."
- **숫자**: `toLocaleString("ko-KR")`(1,234). 표의 숫자 칸은 `.num`.
- **날짜**: `fmtDate(ms: number | null)`(날짜만), `fmtDateTime(ms: number | null)`(짧은 날짜+시간), 둘 다 `src/client/features/guides/types.ts`의 `ko-KR` 형식. 인자는 밀리초 숫자(ISO 문자열이면 `Date.parse`로 바꿔 넘김), null이면 빈 문자열. 새 형식을 만들지 않는다.
- **나열 구분**: 가운뎃점 `·`, 쉼표.
- **금지어·금지 문자**: "무료"(랜딩·인증 포함 전부), 긴 대시(U+2014), 중간 대시(U+2013), 이모지. 영어 UI 단어(Submit, Cancel)를 섞지 않는다.

## 8. 금지 패턴

| 금지 | 나쁜 예 | 좋은 예 |
|-|-|-|
| 하드코딩 색 | `color: #3d6f22;` | `color: var(--color-accent);` |
| 하드코딩 간격 | `padding: 18px;` | `padding: var(--space-6);` |
| 원시 토큰 직접 사용 | `background: var(--neutral-50);` | `background: var(--color-surface-subtle);` |
| 인라인 style 색·간격 | `style={{ color: "red", marginTop: 12 }}` | `className="text-danger mt-section"` |
| 새 버튼 만들기 | `<button className="my-btn">저장</button>` | `<Button>저장</Button>` |
| 새 입력칸 만들기 | `<label>이름<input className="x" /></label>` | `<Input label="이름" />` |
| 그림자 임의값 | `box-shadow: 0 4px 10px #0002;` | `box-shadow: var(--shadow-card);` |
| 모서리 임의값 | `border-radius: 8px;` | `border-radius: var(--radius-card);` |
| z-index 임의값 | `z-index: 999;` | `z-index: var(--z-modal);` |
| 강조색 남발 | 머리에 primary 버튼 3개, 초록 제목 | primary 1개 + secondary/ghost |
| 아이콘만 있고 이름 없음 | `<Button><Icon name="x" /></Button>` | `<IconButton icon="x" label="닫기" />` |
| 로딩 중 빈 화면 | `if (!data) return null;` | `if (!data) return <LoadingState />;` |
| 0만 보여 주기 | `<td>0</td>`만 있는 빈 표 | `<EmptyState title="아직 리드가 없어요" action={...} />` |
| 색만으로 상태 구분 | 초록 점 하나 | `<Badge tone="success" dot>완료</Badge>` |
| 측면 굵은 강조 줄 | `border-left: 4px solid` 카드 | 연한 면 + 1px 테두리 |
| 같은 마크업 반복 | 화면마다 복사한 카드 머리 | `SectionCard` 또는 `ui/`에 컴포넌트 추가 |
| 미디어 쿼리 임의 폭 | `@media (max-width: 768px)` | `@media (max-width: 599px)` |

## 9. 새 토큰·새 컴포넌트가 필요할 때

순서대로 시도하고, 앞 단계로 되면 멈춘다.

1. 기존 의미 토큰·유틸리티 클래스·컴포넌트 조합으로 되는지 다시 본다(3절, 4절).
2. **새 토큰**: `src/client/styles/tokens.css`의 2층(의미) 블록에 쓰임새 이름으로 추가한다. 값은 1층 원시 토큰을 `var()`로 가리킨다. 팔레트에 없는 색이면 1층에 원시 값을 먼저 추가한다. 이름 앞부분은 기존 묶음(color, space, text, radius, shadow, layout, z, duration, ease, control)을 따른다. 그다음 이 문서 3절 표에 한 줄 추가.
3. **새 컴포넌트**: 두 화면 이상에서 같은 마크업이 필요하면 `src/client/ui/<Name>.tsx` + `<Name>.css`로 만들고 `ui/index.ts`에서 내보낸다. CSS는 의미 토큰만. 300줄·함수 40줄 이하. 그다음 이 문서 4절에 항목 추가.
4. **허용 목록은 최후 수단**: 토큰으로 만들 가치가 없는 일회성 값(테두리 두께 1px, 광학 보정 음수, 외부 브랜드 로고 색)만 `scripts/lint-design.allow.json`에 `{ "file", "value", "reason" }`으로 올린다. reason에 왜 토큰이 아닌지 쓴다.

## 10. 확인 방법

- **`npm run lint:design`**: 화면 코드의 하드코딩 색·px, 원시 토큰 사용을 잡는다. 통과가 완료 기준이다. 예외는 9절 4번 절차로만.
- **`/dev/ui`**: 공통 컴포넌트를 한 화면에 모아 둔 카탈로그. 개발 서버(`npm run dev`, 기본 http://localhost:5173)에서만 열린다. 새 화면을 만들기 전에 실제 모양을 여기서 본다.
- **캡처 비교**: `.agent_work/scratch/049/snap.mjs`. 헤드리스 Chrome으로 1440px, 390px 두 폭 전체 페이지를 찍는다(새 설치 없음). 모양을 바꾸지 않는 작업(토큰 치환, 리팩터)은 전후를 찍어 비교한다.

```bash
node .agent_work/scratch/049/snap.mjs before http://localhost:5173
# 수정 후
node .agent_work/scratch/049/snap.mjs after http://localhost:5173
```

- 대시 확인: 긴 대시(U+2014)와 중간 대시(U+2013)가 0건인지 확인한다. 예: `perl -CSD -ne '$n++ if /\x{2014}|\x{2013}/; END { print $n+0 }' <파일>`

## 11. 유지 규칙

- `tokens.css`의 의미 토큰을 추가·삭제·값 변경하면 **같은 커밋에서** 3절 표를 고친다.
- `src/client/ui/`의 컴포넌트를 추가하거나 props 타입을 바꾸면 **같은 커밋에서** 4절을 고친다. props는 코드의 타입을 그대로 옮긴다.
- 대표 화면 파일 경로가 바뀌면 5절 예시 경로를 고친다.
- 이 문서의 `--` 로 시작하는 이름은 모두 `tokens.css`에 정의돼 있어야 한다. 확인:

```bash
grep -oE -- '--[a-z0-9-]+' DESIGN.md | sort -u | while read t; do grep -q -- "$t:" src/client/styles/tokens.css || echo "없음: $t"; done
```
