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
3. **글자 위계는 크기를 적게, 굵기는 semibold 하나(고른 탭만 bold), 색은 3단계.** 앱 화면 제목은 20px(`--text-title-size`)이 가장 크다. 그 아래 h3는 18px, h4는 16px로 자동으로 낮아진다(AppShell.css). 본문 14px, 보조 13px, 캡션 12px. 색은 primary, secondary, tertiary 세 가지.
4. **밀도는 낮게.** 화면 덩어리 사이 24px(`.stack-loose`), 카드 안 20~24px, 목록 위아래 요소 사이 16px(`.stack`). 앱 본문 최대 폭 1200px.
5. **빈 화면·로딩·작은 손가락도 화면의 일부.** 숫자 0 대신 다음 할 일을 보여 주고(EmptyState, Home 지표), 로딩은 `LoadingState` 스켈레톤, 아이콘 버튼에는 이름이 필수다. 누르는 크기는 TDS 단계 그대로 쓴다(터치 기기라고 따로 키우지 않음, AIWITH-557).

## 3. 토큰 표

**원시 토큰(`--neutral-0`, `--green-600`, `--red-700` 같은 팔레트 이름)은 화면 코드에서 직접 쓰지 않는다.** 아래 의미 토큰만 쓴다.

### 3.1 색

| 토큰 | 값 | 언제 쓰나 | 쓰면 안 되는 곳 |
|-|-|-|-|
| `--color-bg` | #fefdfb | 페이지 바탕(body, 앱 본문) | 카드·입력칸 바탕 |
| `--color-surface` | #ffffff | 카드, 모달, 드로어, 입력칸, secondary 버튼 | 페이지 바탕 |
| `--color-surface-subtle` | #f7f6f3 | 한 단계 낮은 면: Stat, EmptyState, 공개 화면 바탕, 비활성 입력칸, hover | 본문 글자 |
| `--color-surface-muted` | #f1f0ef | neutral 배지, ghost 버튼 hover, 스켈레톤 줄 | 넓은 영역 바탕 |
| `--color-surface-inverted` | #1e1d1c | 본문 건너뛰기 링크 | 버튼(그건 primary), 토스트·툴팁(TDS처럼 흰 면) |
| `--color-text-primary` | #1e1d1c | 본문, 제목, 선택된 탭 | |
| `--color-text-secondary` | #5f5b55 | 설명 문단(`.text-secondary`), ghost 버튼 글자 | 제목 |
| `--color-text-tertiary` | #6c6963 | 캡션, 표 머리글, 플레이스홀더, 비선택 탭 | 오류 문구 |
| `--color-text-muted` | #a8a29e | 장식성 글자만 | 읽어야 하는 글자(대비 부족) |
| `--color-text-inverted` | #fefdfb | 어두운 면(inverted) 위 글자 | |
| `--color-border` | #dfdcd9 | 구분선, 표 줄, 카드 안 나눔선 | 입력칸 테두리 |
| `--color-border-strong` | #8c8781 | 읽기 전용 입력칸 포커스 테두리, 진하게 보여야 하는 구분 테두리. 입력칸 기본 테두리는 TDS를 따라 `--color-border`(아주 옅게, 3:1 미만)이고 포커스 때 브랜드 색 테두리로 위치를 보인다 | 장식 구분선 |
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

글꼴 `--font-sans`(Pretendard), 고정폭 `--font-mono`. 굵기 `--weight-regular`(400), `--weight-medium`(500), `--weight-semibold`(600), `--weight-bold`(700, 고른 탭만). 버튼·고른 세그먼트·배지·토스트는 semibold(토스 TDS 실측, `findings/toss-design-system-benchmark.md` 8절).

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
| `--text-body-sm-size` / `--text-body-sm-lh` | 14 / 20 | 같음 | 같음 | | 작은 본문(이제 컨트롤에는 안 씀) |
| `--text-control-size` / `--text-control-lh` | 15 / 22 | 같음 | 같음 | | md 버튼·입력칸·탭·세그먼트·토스트·ListRow 제목 (TDS t6) |
| `--text-control-sm-size` / `--text-control-sm-lh` | 13 / 18 | 같음 | 같음 | | sm 버튼·입력칸, 툴팁, 다중 선택 칩 (TDS t7) |
| `--text-control-lg-size` / `--text-control-lg-lh` | 17 / 24 | 같음 | 같음 | | lg·xl 버튼, lg 입력칸 (TDS t5) |
| `--text-help-size` / `--text-help-lh` | 13 / 19.5 | 같음 | 같음 | | 입력칸 라벨·도움말·오류·글자 수, 체크박스·선택지 설명 (TDS t7 실측) |
| `--text-input-lh` | 25.5 | 같음 | 같음 | | 입력칸 글자 17px의 줄 높이 (TDS 실측) |
| `--text-row-title-lh` / `--text-row-desc-lh` | 22.95 / 20.25 | 같음 | 같음 | | ListRow 제목 17·부제 15 (TDS 1.35 실측) |
| `--text-dialog-title-lh` / `--text-sheet-title-lh` | 27 / 29 | 같음 | 같음 | | 다이얼로그·바텀시트 제목 20px (TDS 실측) |
| `--text-float-lh` | 22.5 | 같음 | 같음 | | 토스트·툴팁·시트 부제 15px (TDS 실측) |
| `--text-label-size` / `--text-label-lh` | 13 / 18 | 같음 | 같음 | | 입력칸 라벨(보통 굵기, secondary 색), 설명 문단 |
| `--text-caption-size` / `--text-caption-lh` | 12 / 16 | 같음 | 같음 | | 캡션(`.text-caption`), 배지, 목록 묶음 제목 |
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
| `--space-5` | 12px | 작은 버튼 좌우 여백, StatGrid 칸 사이 |
| `--space-6` | 16px | `.stack`(목록 위 요소들), 버튼·입력칸 좌우 여백, Stat 안 여백, 휴대폰 모달 여백 |
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
| `--control-height-sm` / `--control-height` / `--control-height-lg` / `--control-height-xl` | 32 / 38 / 48 / 56px | 버튼 sm·md·lg·xl 높이 = TDS small·medium·large·xlarge 실측 그대로 (AIWITH-552) |
| `--input-height` | 56px (= control-height-xl) | 기본 입력칸(TextField·Input·Select·SelectMenu md) = TDS TextField box. sm은 32 |
| `--table-row-height` | 40px | 표 한 줄 높이(안에 sm 컨트롤 32) |
| `--control-padding-x` / `--control-padding-x-sm` | 16px / 8px | 입력칸 좌우 여백 |
| `--control-padding-y` | 14px | 여러 줄 입력칸 위아래 (TDS box 14) |
| `--button-padding-x-sm` / `--button-padding-x-xl` | 10px / 28px | 버튼 sm·xl 좌우 (TDS 실측. md·lg는 16 = `--space-6`) |
| `--search-padding-x` / `--radius-search` | 10px / 12px | SearchField(높이 44 = `--touch-target` 값과 같음) |
| `--control-check-size` / `--check-ring` | 24px / 2px | 체크박스·라디오 = TDS Checkbox.Circle: 24 칸 안 지름 22 원, 안 고름은 옅은 2px 테두리 + 옅은 체크, 고름은 강조색 원 + 흰 체크 |
| `--switch-width` / `--switch-height` / `--switch-thumb` / `--switch-inset` / `--switch-thumb-off-scale` | 50 / 30 / 24 / 3px / 0.6667 | Switch 바탕·손잡이·손잡이 둘레, 꺼짐 손잡이 16(= 24 × 0.6667). 손잡이 그림자 없음 (TDS Switch 실측) |
| `--segmented-height` / `--segmented-height-sm` | 48px / 39px | SegmentedControl 홈 (TDS large 48 칸 40, small 39 칸 33 실측) |
| `--segmented-inset-x` / `--segmented-inset-sm` / `--segment-padding-x-sm` | 5px / 3px / 14px | large 홈 안쪽 좌우 5(위아래 4), small 홈 안쪽 3, small 칸 좌우 14 (large 칸 좌우 12) |
| `--badge-height-xs` / `--badge-height` / `--badge-height-md` / `--badge-height-lg` | 21 / 24 / 25.5 / 29px | Badge xs·sm·md·lg (TDS xsmall·small·medium·large) |
| `--badge-padding-x` | 7px | Badge 좌우 (lg는 8) |
| `--tab-height` / `--tab-padding-bottom` / `--tab-padding-x` | 47px / 14px / 12px | Tabs (TDS Tab 47, 위 12 아래 14, fluid 탭 좌우 12) |
| `--tab-indicator` / `--tab-indicator-inset` / `--tab-indicator-height` | 막대 색 / 10px / 2px | 고른 탭 아래 막대: 탭 양옆 10 안쪽, 높이 2, 모서리 1 (TDS 실측) |
| `--list-row-padding-x` | 24px | 누르는 ListRow 좌우 (TDS ListRow 12·24) |
| `--dialog-width` / `--dialog-padding` | 320px / 22px | Modal sm(확인 다이얼로그) 폭과 모든 모달 안쪽 (TDS Dialog) |
| `--sheet-inset` / `--sheet-padding-x` | 10px / 24px | 바텀시트가 화면 좌우·아래에서 뜬 거리, 시트 본문 좌우 (TDS 실측) |
| `--sheet-handle-area` / `--sheet-handle-top` / `--sheet-head-padding-top` / `--sheet-head-padding-bottom` | 16 / 12 / 25 / 13px | 시트 위 손잡이 자리, 손잡이 위치, 제목 위아래 여백 (TDS 실측) |
| `--count-badge-size` | 16px | 아이콘 위 숫자 배지(알림 개수 `shell/NotificationBell.css`) 높이·최소 폭 |
| `--floating-bar-height` | 0px | FloatingActionBar 높이. 줄이 뜨면 `ui/FloatingActionBar.tsx`가 실제 높이로 바꿔 넣고 scroll-padding에 쓴다 |
| `--sheet-handle-width` / `--sheet-handle-height` | 48px / 4px | 바텀시트 위 손잡이 (TDS 실측) |
| `--select-menu-max-height` / `--select-menu-min-width` | 320px / 200px | SelectMenu 목록 최대 높이·최소 폭 |
| `--progress-height` / `--progress-height-sm` | 6px / 4px | ProgressBar 굵기 |
| `--avatar-size-sm` / `--avatar-size-md` / `--avatar-size-lg` | 24 / 32 / 40px | Avatar, 스켈레톤 list 동그라미 |
| `--spinner-size-sm` / `-md` / `-lg` / `-xl` | 16 / 24 / 36 / 48px | Spinner. md·lg·xl = TDS Loader small·medium·large, sm은 글줄 안 전용 |
| `--loader-gap` / `--loader-gap-xl` | 12 / 16px | Loader 스피너 둘레 (TDS 실측) |
| `--dot-size` / `--dot-gap` | 8 / 7px | 버튼 로딩 점 3개 (TDS 실측) |
| `--skeleton-line` / `-title` / `-bar` / `-row` / `-card` / `-icon` | 22 / 30 / 42 / 64 / 240 / 40px | 스켈레톤 부제·제목·아이콘 줄·목록 줄·카드·아이콘 (TDS Skeleton 모듈 실측) |
| `--radius-skeleton-bar` / `--radius-skeleton-card` | 13 / 38px | 아이콘 줄, 카드 스켈레톤 모서리 |
| `--tooltip-max` / `--tooltip-padding-y` | 240px / 13px | Tooltip 최대 폭, 위아래 안쪽 (좌우 16) |
| `--toast-top` / `--toast-margin-x` | 46px / 18px | 토스트가 멈추는 화면 위 거리, 좌우 최소 여백 (TDS 실측) |
| `--field-text-inset` | 4px | 라벨·도움말 글자가 입력칸 가장자리보다 안쪽으로 들어간 거리 (TDS 실측) |
| `--opacity-disabled` / `--opacity-check-disabled` | 0.3 / 0.4 | 비활성 버튼·스위치, 비활성 체크박스·라디오 (TDS 실측) |
| `--press-dim` | 0.74 | 눌린 버튼 밝기(TDS 검정 0.26 덧칠) |
| `--skeleton-line` / `--skeleton-title` / `--radius-skeleton-sm` / `-md` / `-lg` | 22 / 30 / 9 / 11 / 18px | 스켈레톤 줄·제목 높이와 모서리, 카드 모서리 (TDS 실측) |
| `--touch-target` | 44px | SearchField 높이. AIWITH-557부터 터치 기기에서 누르는 영역을 따로 늘리지 않는다(TDS를 따름) |

### 3.4 모서리

| 토큰 | 값 | 쓰임 |
|-|-|-|
| `--radius-control-sm` / `--radius-control` / `--radius-control-lg` / `--radius-control-xl` | 8 / 10 / 14 / 16px | 컨트롤 높이별 모서리(TDS 32→8, 38→10, 48→14, 56→16). sm 버튼·입력칸·툴팁·목록 항목은 sm, lg 입력칸은 lg, lg 버튼 lg, xl 버튼 xl |
| `--radius-button` | 10px(= radius-control) | md 버튼. 휴대폰에서도 알약으로 바꾸지 않는다(TDS 실측) |
| `--radius-input` | 14px(= radius-control-lg) | 기본 입력칸(56, TDS box) |
| `--radius-badge-xs` / `-sm` / `-md` / `-lg` | 9 / 11 / 12 / 13px | Badge 크기별 모서리 (TDS 실측. 알약 아님) |
| `--radius-card` | 12px | 카드, EmptyState, ActionBar 윗모서리 |
| `--radius-modal` | 24px | 모달 (TDS Dialog) |
| `--radius-sheet` | 28px | 바텀시트, 휴대폰 모달 시트 네 모서리(떠 있음) (TDS Bottom Sheet) |
| `--radius-popover` | 12px | 드롭다운 메뉴 |
| `--radius-xs` / `--radius-sm` / `--radius-md` / `--radius-lg` / `--radius-xl` / `--radius-2xl` | 4 / 6 / 12 / 16 / 20 / 24px | 위 이름으로 안 맞을 때만. 작은 태그는 sm. 툴팁은 lg(16) |
| `--radius-full` | 9999px | 칩, 토스트, 아바타, 원형 아이콘, 체크박스·라디오 원 |

### 3.5 그림자

| 토큰 | 쓰임 |
|-|-|
| `--shadow-ring` | 1px 링만. 작은 원형 아이콘 |
| `--shadow-card` | Card, SectionCard |
| `--shadow-raised` | 살짝 뜬 요소 |
| `--shadow-control` | 작은 컨트롤 그림자가 꼭 필요할 때만 (버튼·입력칸·스위치 손잡이는 TDS처럼 그림자 없음) |
| `--shadow-segment` | 고른 세그먼트 칸 (TDS 0 1px 2px) |
| `--shadow-toast` | 토스트 (TDS 0 2px 30px 옅게) |
| `--shadow-tooltip` | 툴팁 (TDS 0 16px 60px 0.18) |
| `--shadow-popover` | 드롭다운, 오른쪽 드로어 밖 메뉴. 다이얼로그·바텀시트는 TDS처럼 그림자 없음 |
| `--shadow-drawer` | 드로어 |
| `--shadow-bar` | ActionBar(아래 고정 줄) |
| `--shadow-page` | 어두운 뷰어 위 문서 페이지 |
| `--shadow-scroll-edge` | 표 가로 스크롤 가장자리 그림자 색(값이 색 하나다) |
| `--focus-ring` | 키보드 포커스 링(버튼은 `:focus-visible`에서 outline 대신 이것). TDS 실측 이중 링: 1px 진한 선 + 3px 옅은 번짐 |
| `--focus-ring-danger` | 오류 상태 버튼류 포커스 링 |
| `--focus-ring-control` / `--focus-ring-control-danger` | 입력칸 포커스: 테두리를 브랜드 색(`--color-accent`)으로 바꾸고 같은 색 1px 링을 더한다. 오류 칸은 오류 색. 마우스 클릭 포커스에도 보인다 |
| `--border-control` | 입력칸 테두리 전체 선언(1px solid `--color-border`, TDS처럼 아주 옅게) |

### 3.6 z-index

| 토큰 | 값 | 쓰임 |
|-|-|-|
| `--z-sticky` | 20 | ActionBar, 휴대폰 상단 바 |
| `--z-popover` | 45 | 드롭다운 메뉴 |
| `--z-drawer` | 50 | 드로어, 휴대폰 사이드바 |
| `--z-modal` | 55 | 모달 |
| `--z-select-menu` | 57 | SelectMenu 목록(body에 붙어 모달·드로어 위로 뜸) |
| `--z-toast` | 60 | 토스트, 본문 건너뛰기 링크 |

### 3.7 모션

| 토큰 | 값 | 쓰임 |
|-|-|-|
| `--duration-press` | 100ms | 버튼 눌림(TDS 0.1s) |
| `--duration-fast` | 150ms | hover, 색·테두리 전환 |
| `--duration-base` | 200ms | 모달·오른쪽 드로어 등장 |
| `--duration-sheet` | 300ms | 바텀시트·휴대폰 모달 시트 올라옴, 다이얼로그 떠오름, 배경 어두워짐, 토스트 내려옴 |
| `--duration-loop` | 2400ms | 스켈레톤 한 바퀴: 불투명도 1~0.2, 크기 1~0.96 (TDS 실측) |
| `--duration-tab` | 300ms | 탭 글자색·막대 전환 (TDS 0.3s) |
| `--duration-spin` | 800ms | (예전 Spinner 값, 지금은 안 씀) |
| `--duration-loader` / `--delay-loader` | 1800 / 700ms | Spinner 한 바퀴와 호 늘고 줄기, 0.7초 뒤 0.3초에 나타남 (TDS Loader 실측) |
| `--duration-dots` | 600ms | 버튼 로딩 점 한 번 깜빡임, 점마다 0.1초 늦게 (TDS 실측) |
| `--ease-out` | cubic-bezier(0.22, 1, 0.36, 1) | 모든 전환 |
| `--ease-in-out` | ease-in-out | 버튼·목록 행·칩 눌림 |
| `--ease-sheet` | cubic-bezier(0.32, 0.72, 0, 1) | 시트·다이얼로그·토스트: 빠르게 움직여 부드럽게 멈춤 (TDS 시간별 측정과 비슷한 곡선, 곡선 값 자체는 [추론]) |
| `--scale-press` | 0.96 | 눌린 버튼·누르는 ListRow·칩 크기(TDS) |
| `--offset-dialog-rise` | 80px | 다이얼로그가 이만큼 아래에서 떠오르며 페이드 (TDS 40ms 시점 75 남음, 근사) |
| `--offset-rise` | 16px | 아래에서 올라오는 짧은 거리 |
| `--opacity-skeleton-min` / `--scale-skeleton-min` | 0.2 / 0.96 | 스켈레톤 가장 옅고 작을 때 |

`prefers-reduced-motion`은 base.css가 전역으로 처리한다(전환·애니메이션 끔, 눌림 작아짐도 끔). 따로 막을 필요 없다. 시트·다이얼로그 뒤 배경 흐림은 TDS에 없어 AIWITH-557에서 뺐다.

### 3.8 반응형 기준점

| 토큰 | 값 | 미디어 쿼리에 쓰는 숫자 |
|-|-|-|
| `--bp-tablet` | 600px | 휴대폰: `@media (max-width: 599px)` |
| `--bp-desktop` | 1024px | 태블릿 이하: `@media (max-width: 1023px)` |
| `--bp-wide` | 1440px | 캡처 기준 폭(쿼리 없음) |

CSS 변수는 `@media` 안에서 못 쓴다. 쿼리에는 위 두 숫자(599, 1023)만 쓴다. 터치 기기는 `@media (pointer: coarse)`(지금은 iOS 확대를 막는 16px 글자에만 쓴다).

## 4. 공통 컴포넌트 카탈로그

모두 한 곳에서 가져온다. 경로는 파일 위치에 따라 `../../ui`(features/x/Page.tsx), `../../../ui`(features/x/sections/*.tsx), `../ui`(pages, shell).

```tsx
import { Button, Input, PageHeader, Table } from "../../ui";
```

**크기·모양은 토스 TDS 실측 값을 그대로 기본값으로 쓴다(AIWITH-552, 2026-10-30, 근거 `findings/toss-design-system-benchmark.md` 8.2·8.5). 색은 우리 토큰 그대로.**

AIWITH-542(findings 8.3·8.4)에서 PC 대시보드라는 이유로 둔 타협(기본 높이 40, 글자 한 단계 작게, 체크박스 20·스위치 40×24, 진한 입력 테두리, 탭 15px·44, 목록 행 15/13, 바텀시트 떠 있지 않음, 배지 600)은 **걷어냈다.** 촘촘한 자리(표 안, 필터 줄, 툴바)는 기본값을 줄이지 않고 화면에서 작은 단계(Button `sm`, Input·Select·SelectMenu `sm`, Badge `sm`)를 고른다. FilterBar 안 칸·버튼은 컴포넌트가 sm(32)으로 맞춘다. 입력칸(56) 옆 버튼은 `xl`(56)로 높이를 맞춘다.

| 컴포넌트 | 크기 단계와 값 (TDS 실측과 같음) |
|-|-|
| Button | sm 32 / 좌우 10 / r8 / 13px, md 38 / 16 / r10 / 15px, lg 48 / 16 / r14 / 17px, xl 56 / 28 / r16 / 17px. 모두 600, 테두리 0. secondary = TDS weak(옅은 면). 비활성 불투명도 0.3, 마우스를 올려도 면은 그대로(ghost만 옅은 면), 키보드 포커스는 1px + 3px 이중 링 |
| 입력칸 (TextField·Input·Textarea·Select·SelectMenu·TagInput) | 기본 md = box 56 / 좌우 16 / r14 / 채움 면 + 아주 옅은 테두리 / 17px 400. sm 32 / r8 / 13px. lg는 md와 같은 모양 |
| 라벨·도움말 | 13/19.5 400, 칸과 6, 글자는 칸 가장자리보다 4 안쪽. 오류면 라벨도 오류 색 |
| 포커스(입력칸) | 면 그대로, 테두리 브랜드 색 + 같은 색 1px 링, 커서 브랜드 색. 오류 칸은 오류 색 |
| SearchField | 44 / 좌우 10 / r12 (FilterBar 안은 32) |
| Checkbox·Radio | 24, TDS Checkbox.Circle 모양(원 22, 테두리 2), 비활성 0.4 |
| Switch | 50×30, 손잡이 켜짐 24 · 꺼짐 16, 꺼짐 바탕 옅은 회색, 손잡이 그림자 없음, 비활성 0.3 |
| SegmentedControl | md 홈 48 r14 안쪽 4·5, 칸 40 r10 좌우 12, 17px 고름 600 / 안 고름 500, 고른 칸 흰 면 + 그림자. sm 홈 39 r10 안쪽 3, 칸 33 r8 좌우 14, 15px |
| Tabs | 47, 위 12 아래 14 좌우 12(fluid), 17px 고름 700 / 안 고름 600, 아래 막대 2px(양옆 10 안쪽, 모서리 1), 색 전환 0.3s |
| Badge | xs 21 / 10px 600 / r9, sm 24 / 12px 700 / r11(기본), md 25.5 / 13px 700 / r12, lg 29 / 14px 700 / r13 |
| ListRow | 위아래 12, 누르는 행 좌우 24, 제목 17/22.95 500, 부제 15/20.25 (제목과 붙음), 칸 사이 16 |
| Bottom sheet (Drawer bottom) | 화면 좌우·아래에서 10 떠 있음, 네 모서리 28, 그림자 없음, 손잡이 자리 16(손잡이 48×4, 위 12), 제목 20/29 700(위 25 아래 13), 부제 15/22.5, 본문 좌우 24, 17px. 뒤 배경 흐림 없음 |
| Modal | sm(다이얼로그) 폭 320, 모든 크기 모서리 24, 그림자 없음, 안쪽 22, 제목 20/27 700, 설명 15/500(제목과 8), 아래 버튼 48 / r14 / 17px, sm 버튼 줄은 위 20 좌우·아래 16. 휴대폰에서 md·lg는 떠 있는 시트, sm은 TDS처럼 가운데 320 그대로 |
| Toast | 화면 위 가운데(위 46), 흰 알약, 안쪽 12·16, 15/22.5 600, 옅고 큰 그림자. 성공·오류는 아이콘 색으로만 |
| Tooltip | 흰 면, r16, 안쪽 13·16, 15/22.5 700, 그림자 0 16px 60px. 꼬리 없음(아래 한계) |
| LoadingState·Skeleton | TDS Skeleton 모듈: title 30 r11 폭 50%, subtitle 22 r9, list 64 r18(사이 16), 아이콘 줄 40 원 + 42 r13(사이 14, 줄 사이 32), card 240 r38(사이 20). 불투명도 1~0.2·크기 1~0.96을 2.4초에 한 번, 조각마다 조금씩 늦게 |
| Spinner·Loader | TDS Loader: 원(지름 66 기준 선 6, 둥근 끝) 호가 180~45로 늘었다 줄며 1.8초에 한 바퀴, 0.7초 뒤 나타남. 강조색. Loader는 둘레 12(xl 16), 아래 문구 15/22.5 |
| Button loading | 글자 자리에 8 점 3개(사이 7), 글자색, 불투명도 1~0.2·크기 1~0.8을 0.6초, 점마다 0.1초 늦게 |

움직임: 버튼은 눌리면 0.96으로 작아지고 어두워진다(0.1초). 누르는 ListRow·칩은 0.96. 바텀시트·휴대폰 모달은 아래에서 올라오며 나타나고 뒤 배경은 어두워지기만 한다. 다이얼로그는 80 아래에서 떠오르며 페이드. 토스트는 위에서 내려온다. 움직임 줄이기 설정이면 모두 끈다(스피너 회전·스켈레톤 반짝임·버튼 점도 멈추고 모양만 보인다).

**정밀 대조 (AIWITH-557, 2026-10-31).** TDS 문서 예시를 다시 재서(findings 8.7) 접근성·PC 사정으로 TDS와 다르게 두었던 것을 되돌렸다: 터치 기기 44 누르는 영역, 버튼·입력칸 hover 변화, 비활성 0.5, 배경 흐림, 다이얼로그 확대 등장, 토스트 오른쪽 아래·어두운 면, 툴팁 어두운 면 13px. TDS와 다르게 두는 것은 두 가지뿐이다. ① 색: 우리 색 토큰을 쓴다(TDS 반투명 면은 가장 가까운 기존 토큰). ② 입력칸 포커스: 테두리를 브랜드 색으로 바꾸고 1px 링을 더하며, 오류 칸은 오류 색 테두리를 유지한다. 입력칸 기본 테두리가 3:1 대비에 못 미치는 것도 TDS를 따른 것이고, 포커스 때 브랜드 테두리로 위치를 보인다.

### 4.1 Button, IconButton, ButtonLink, ButtonAnchor (`ui/Button.tsx`)

- props: `Button`은 `ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg" | "xl"; loading?: boolean }`. 기본 `variant="primary"`, `size="md"`, `type="button"`.
- 크기(TDS 실측 그대로, findings 8.5): sm 32·좌우 10·r8·13px(표·필터 줄·툴바), md 38·r10·15px(기본), lg 48·r14·17px(인증 화면 주 버튼·구글 버튼), xl 56·좌우 28·r16·17px(공개 화면 하단 줄 주 동작, 랜딩 "시작하기", 56 입력칸 옆 버튼). 글자는 모두 semibold, 누르면 0.96으로 작아진다. 휴대폰에서도 알약으로 바꾸지 않는다. 화면 CSS로 높이·모서리·글자 크기를 덮어쓰지 않고 `size`를 고른다(폭 100% 같은 배치만 화면 CSS).
- `loading`: 누를 수 없고(`aria-busy`), 글자 자리에 TDS처럼 점 3개가 차례로 깜빡인다. 글자는 숨기기만 해서 버튼 폭이 그대로다(토스 Button 규칙). 반투명이 아니라 진한 색 그대로 둔다.
- `IconButton`: `{ icon: IconName; label: string }` + Button props(children, aria-label 제외). 기본 `variant="ghost"`.
- `ButtonLink`: react-router `LinkProps & { variant?; size? }`, 기본 `secondary`. 앱 안 이동.
- `ButtonAnchor`: `AnchorHTMLAttributes<HTMLAnchorElement> & { variant?; size? }`, 기본 `secondary`. 외부 주소·내려받기.
- 쓴다: 모든 누르는 동작. 주 동작은 primary 하나, 보조는 secondary, 취소·접기는 ghost, 되돌릴 수 없는 삭제는 danger.
- 안 쓴다: 표 안 글자 링크나 이름 클릭(그건 `<Link>` 또는 `.link-button`). 폼 제출은 `type="submit"`을 꼭 준다.

```tsx
<Button onClick={publish}>공개하기</Button>
<Button variant="secondary" onClick={edit}>편집</Button>
<Button type="submit" disabled={busy}>{busy ? "저장 중" : "저장"}</Button>
<Button type="submit" loading={busy}>저장</Button>
<IconButton icon="x" label="닫기" size="sm" onClick={onClose} />
<ButtonLink size="sm" to="/dashboard/guides/new">시작</ButtonLink>
<ButtonAnchor href={`/api/leads/export?${query}`}>CSV 내보내기</ButtonAnchor>
<Button type="submit" size="lg" loading={busy}>로그인</Button>   {/* 인증 화면 주 버튼 */}
<Button size="xl" onClick={upload} disabled={!file}>올리기</Button>   {/* 공개 업로드 화면 주 동작 */}
<ButtonLink variant="primary" size="xl" to="/signup">시작하기</ButtonLink>   {/* 랜딩 CTA */}
```

### 4.2 CopyButton (`ui/CopyButton.tsx`)

- props: `{ text: string; label?: string; doneMessage?: string; size?: "sm" | "md"; variant?: "secondary" | "ghost"; disabled?: boolean; "aria-label"?: string }`. 기본 `label="복사"`, `doneMessage="링크를 복사했어요."`, `size="sm"`, `variant="secondary"`.
- 쓴다: 주소·코드 복사. 성공 토스트까지 해 준다. `ToastProvider` 안에서만 동작.
- 안 쓴다: 복사 외 동작. 직접 `navigator.clipboard`를 부르고 토스트를 따로 띄우지 않는다.

```tsx
<CopyButton text={guideUrl} aria-label="가이드 URL 복사" />
```

### 4.3 Input, Textarea, Select, Checkbox (`ui/Form.tsx`)

- props: `Input`은 `InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string; error?: string }`. `Textarea`, `Select`도 각 HTML 속성 + 같은 `{ label?, hint?, error? }`. `Textarea`는 `autoGrow?: boolean`(내용만큼 높이가 늘어남, 손잡이 없음), `showCount?: boolean`(아래 오른쪽 글자 수, `maxLength`가 있으면 "n/최대", 넘으면 빨강)이 더 있다. `Select`는 `size?: "sm" | "md" | "lg"`(기본 `md`)가 더 있다. `lg`는 높이 56px(TDS box). `sm`은 높이 32px, 폭은 내용에 맞고(최소 72px) 오른쪽에 화살표 자리가 항상 확보된다. 표 안·줄 안 선택칸에 쓰고, 화면 CSS로 `.control` 여백을 덮어쓰지 않는다. `Checkbox`는 `Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode; description?: ReactNode; indeterminate?: boolean }`. `description`은 라벨 아래 작은 글씨(`aria-describedby` 연결), `indeterminate`는 "일부만 고름"(전체 선택 칸).
- 모양(TDS box 그대로, findings 8.5): 높이 56, 바탕 `surface-subtle`, 아주 옅은 테두리(`--color-border`), 그림자 없음, 17px. 포커스(마우스 클릭 포함)면 면은 그대로 두고 테두리가 브랜드 색 + 같은 색 1px 링, 오류 칸은 오류 색. 비활성은 `surface-muted`. 라벨 13px 보통 굵기 secondary 색, 도움말·오류 13px. `Input`도 `size="sm"`(32)을 받는다.
- `Select size="lg"`는 네이티브 목록이 아니라 `SelectMenu`의 직접 그린 목록으로 열린다(`ui/SelectLarge.tsx`). `<option>`·`<optgroup label>` 자식, `value`/`defaultValue`, `onChange(e.target.value)`, `name`(숨은 input)은 그대로 쓴다. sm·md는 네이티브.
- 앞뒤 단위·지우기·글자 수·크기·읽기 전용 모양이 필요하면 `TextField`(4.21). `Input`은 그대로 둔다.
- 검색·설명 줄·묶음·다중 선택이 필요한 선택은 `SelectMenu`(4.32). 고르는 기준은 4.32.
- `required`를 주면 라벨 옆에 "필수"가 붙는다. `hint`·`error`는 `aria-describedby`로 연결되고, `error`가 있으면 hint 대신 빨간 문구 + 빨간 테두리.
- 쓴다: 모든 입력. 라벨이 화면에 없을 때(FilterBar 안)는 `aria-label`을 준다.
- 안 쓴다: 2~6개 중 하나 고르기를 눈에 보이게 하려면 ChoiceChips.

```tsx
<Input label="이름" required value={name} onChange={(e) => setName(e.target.value)} error={fields.name} />
<Textarea label="메모" hint="인플루언서에게는 보이지 않아요." rows={4} />
<Select label="가이드" value={guide} onChange={(e) => setGuide(e.target.value)}>
  <option value="">모든 가이드</option>
</Select>
<Select size="sm" aria-label="진행 상태" value={status} onChange={(e) => setStatus(e.target.value)}>{/* 표 안 작은 선택칸 */}</Select>
<Checkbox label="알림톡 수신에 동의해요" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
```

### 4.4 Badge (`ui/Badge.tsx`)

- props: `{ tone?: BadgeTone; size?: BadgeSize; dot?: boolean; children: ReactNode }`. `BadgeSize = "xs" | "sm" | "md" | "lg"`(TDS xsmall~large), 기본 `sm`(24, 12px 700, r11). 표 안은 sm 그대로. `BadgeTone = "neutral" | "accent" | "success" | "warn" | "danger" | "info"`, 기본 `neutral`.
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

- props: `{ open: boolean; title: string; description?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" }`. `sm`(320px, 확인·알림 다이얼로그 = TDS Dialog, 아래 버튼이 반씩 나눠 찬다), 기본 `md`(480px, 폼), `lg`(720px). 휴대폰에서는 화면 가장자리에서 뜬 시트로 아래에서 올라온다.
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

- props: `{ title: string; description?: ReactNode; onClose: () => void; children: ReactNode; side?: "right" | "bottom" }`. 기본 `side="right"`. 열린 동안만 렌더한다(`open` prop 없음).
- 쓴다: 표에서 한 행을 눌러 오른쪽에 상세 보기(리드 상세 `features/leads/common.tsx`).
- `side="bottom"`: 바텀시트. 폭 전체, 높이는 내용만큼(최대 화면 85%). 공개 화면 휴대폰에서 선택 목록·짧은 확인. 바깥을 누르거나 Esc면 닫힌다(토스 Bottom Sheet 권장 동작). PC 대시보드에서는 쓰지 않는다.
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
- 모양: TDS 기본 토스트처럼 화면 위 가운데에 흰 알약으로 내려온다. 성공·오류는 아이콘 색으로만 구분한다(면 색은 같다).
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

- props: `{ lines?: number; label?: string; pattern?: "lines" | "list" | "card" | "table" | "detail" }`. 기본 `lines=3`, `label="불러오는 중"`, `pattern="lines"`.
- `pattern`: 실제 화면 모양에 맞춘다(TDS Skeleton 모듈 조합). `lines`(제목 + 글줄, 폼), `list`(아이콘 원 + 줄을 `lines`개, ListRow·타임라인), `card`(큰 카드 면을 `lines`개, 카드 목록), `table`(표 한 줄 높이마다 글줄 조각 셋을 `lines`줄, 표 자리), `detail`(제목·부제 + 큰 줄 `lines`개, 상세 화면·공개 화면).
- 조각 하나만 필요하면 `Skeleton`: `{ shape?: "text" | "title" | "circle" | "rect"; width?; height?; className? }`. text 22 r9(폭 33%), title 30 r11(폭 50%), circle 40, rect 64 r18. 장식이라 낭독기에 숨는다(상태 문구는 부모가).
- 쓴다: 데이터를 받기 전(`data === null`). `return null` 대신.
- 안 쓴다: 버튼 안 진행 표시(`Button loading` 또는 글자를 "저장 중"으로 바꾸고 `disabled`), 작은 자리 기다림(Spinner), 모양을 알 수 없는 화면 전체 기다림(로그인 확인, 라우트 지연 로딩: `Loader fill`).

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

### 4.15.1 FloatingActionBar, FloatingActionBarSlot (`ui/FloatingActionBar.tsx`)

- props: `FloatingActionBar`는 `{ children: ReactNode }`, `FloatingActionBarSlot`은 props 없음. 줄은 `FloatingActionBarSlot` 안에 portal로 그려지고, 슬롯은 `PublicShell`이 본문 맨 아래에 이미 둔다. 그래서 줄은 화면 트리 어디(폼, 업로드 칸 깊은 곳)에 써도 된다.
- 화면 아래에 붙고(sticky) 본문 폭에 맞으며, 위쪽 옅은 그림자(`--shadow-bar`)와 흰 바탕, safe-area 여백이 들어 있다. 자기 실제 높이만큼 본문에서 자리를 차지해 마지막 내용을 가리지 않는다(`--floating-bar-height`를 측정해 scroll-padding에도 쓴다). 내용이 짧으면 화면 맨 아래에 붙는다. 줄을 렌더하지 않으면 자리는 접힌다.
- 쓴다: 인플루언서 공개 화면의 주 CTA 1개(참여하기, 동의하고 참여하기, 올리기). 폼 제출은 버튼에 `form="폼id"`를 준다. 진행 중처럼 누를 게 없으면 줄을 렌더하지 않는다.
- 안 쓴다: 앱 화면 편집 폼(그건 ActionBar). 보조 버튼(참여 취소 등)은 본문에 둔다.

- 줄 안 주 버튼은 `size="xl"`(56). 폭은 줄이 100%로 채운다.

```tsx
<FloatingActionBar><Button type="submit" size="xl" form="consent-form" disabled={!ready}>{t("submit_consent")}</Button></FloatingActionBar>
```

### 4.16 Tabs (`ui/Tabs.tsx`)

- props: `{ tabs: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label?: string }` (`T extends string`). 화살표 이동, 좁으면 가로 스크롤.
- 쓴다: 한 화면 안 같은 대상의 다른 보기(가이드 상세의 인플루언서·리드 링크·검수·성과·리드), 상태별 목록 나누기.
- 안 쓴다: 다른 화면으로 이동(사이드바·링크), 폼 단계 진행.

```tsx
const TABS: { value: Tab; label: string }[] = [{ value: "contacts", label: "연락처" }, { value: "groups", label: "그룹" }];
<Tabs<Tab> tabs={TABS} value={tab} onChange={setTab} />
```

### 4.16.1 LinkTabs (`ui/LinkTabs.tsx`)

- props: `{ tabs: LinkTab[]; current: string; label: string }`. `LinkTab = { key: string; label: string; to: string | null; count?: number }`. 모양은 Tabs와 같고(`Tabs.css`), 현재 탭은 `aria-current="page"`.
- `to`가 null이면 잠긴 탭(흐리게, 누를 수 없음). 왜 잠겼는지는 탭 아래 캡션 한 줄로 알린다(툴팁 금지). `count`가 0보다 크면 옆에 accent 배지.
- 쓴다: 주소가 다른 화면끼리를 한 페이지처럼 오가는 탭 줄(인플루언서 공개 화면 가이드·영상 올리기·피드백, `features/public-guide/sections/InfluencerTabs.tsx`). react-router `Link`라 새로고침 없이 이동한다.
- 안 쓴다: 한 화면 안 보기 전환(그건 Tabs).

```tsx
<LinkTabs label="인플루언서 메뉴" current="upload" tabs={[{ key: "guide", label: "가이드", to: "/g/abc" }, { key: "feedback", label: "피드백", to: null, count: 2 }]} />
```

### 4.17 Icon (`ui/icons.tsx`)

- props: `{ name: IconName; size?: number }`. 기본 18. `aria-hidden` 처리돼 있다. Lucide 경로를 옮겨 둔 목록에서만 고른다(house, file-text, users, link, search, plus, check, x, chevron-left, bell, megaphone, tag 등 37개).
- 쓴다: 글자 옆 보조 그림, EmptyState·Table 머리글·Dropdown 항목 아이콘.
- 안 쓴다: 아이콘만으로 누르는 버튼(그건 IconButton). 새 아이콘 라이브러리 설치 금지. 필요하면 lucide.dev SVG 경로를 `icons.tsx`에 추가.

```tsx
<Icon name="check" size={16} />
```

### 4.18 Dropdown (`ui/Dropdown.tsx`)

- props: `{ items: DropdownItem[]; label: string; children: ReactNode; align?: "start" | "end"; side?: "bottom" | "top"; header?: ReactNode; triggerClassName?: string; menuClassName?: string; tip?: string }`.
- `menuClassName`: 메뉴 상자 한 곳만 폭을 바꿀 때(알림 `.notif-menu`: 360px, 좁은 화면은 화면 폭에서 좌우 여백을 뺀 만큼).
- `DropdownItem = { label: string; onSelect: () => void; id?: string; description?: string; icon?: IconName; leading?: ReactNode; danger?: boolean; disabled?: boolean; divider?: boolean }`.
- `id`: label 이 겹칠 수 있는 목록의 key. `description`: label 아래 작은 글씨 한 줄(시간 등). 있으면 label 이 두 줄까지 줄바꿈되고 항목 높이가 내용에 맞춰진다.
- 쓴다: 버튼 하나 뒤에 숨긴 동작 목록(계정 메뉴 `shell/AccountMenu.tsx`, 행의 더 보기), 짧은 소식 목록(알림 `shell/NotificationBell.tsx`: 제목 + "안 읽음, 3분 전" 설명 줄).
- 안 쓴다: 값 고르기(Select, SelectMenu 또는 ChoiceChips). Dropdown은 "동작" 메뉴(role=menu)이고, 값을 고르는 칸은 SelectMenu(role=combobox + listbox)다.

```tsx
<Dropdown label="계정 메뉴" align="end" items={[{ label: "설정", icon: "building-2", onSelect: goSettings }, { label: "로그아웃", icon: "log-out", danger: true, divider: true, onSelect: logout }]}>
  <Icon name="chevron-down" />
</Dropdown>
```

### 4.19 ChoiceChips (`ui/ChoiceChips.tsx`)

- props: `{ options: ChoiceOption<T>[]; label: string; hint?: string; disabled?: boolean }` + 하나 고르기 `{ multiple?: false; value: T | null; onChange: (value: T) => void }` 또는 여러 개 `{ multiple: true; value: T[]; onChange: (value: T[]) => void }`. `ChoiceOption<T> = { value: T; label: string }`.
- 쓴다: 선택지 2~8개를 한눈에 보여 줄 때(온보딩 설문 `features/onboarding/sections/SurveyStep.tsx`).
- 안 쓴다: 선택지가 많거나 길 때(Select).
- `disabled`: 진행 중이라 바꾸면 안 될 때 칩 전체를 잠근다(공개 업로드 화면의 영상 종류 선택, 올리는 중).

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

### 4.21 TextField, NumberField, SearchField (`ui/TextField.tsx`)

토스 TDS TextField 패턴(라벨 위, 도움말·오류 아래 한 자리, 지우기, 앞뒤 단위)을 우리 색으로 만든 입력칸. 근거: `findings/toss-design-system-benchmark.md`.

- props: `TextField`는 `Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> & { label?; hint?; error?; size?: "sm" | "md" | "lg"; prefix?: ReactNode; suffix?: ReactNode; clearable?: boolean; onClear?: () => void; showCount?: boolean }`. 기본 `size="md"`.
  - `prefix`·`suffix`: 칸 안 앞뒤 글자나 아이콘("https://", "원", "초"). 단위를 라벨에 쓰지 말고 여기에.
  - `clearable`: 값이 있고 비활성·읽기 전용이 아닐 때 오른쪽에 지우기 버튼. 눌러도 일반 입력처럼 `onChange`가 ""로 불려서 제어·비제어 모두 비워진다. 추가 동작만 `onClear`에.
  - `showCount`: 아래 오른쪽 글자 수(보이는 글자 단위, 이모지 1자). `maxLength`와 함께.
  - `readOnly`: 바탕 subtle, 옅은 테두리, 지우기 숨김. 고를 수 있고 복사된다. 못 바꾸는 이유가 "아직 안 됨"이면 `disabled`, "원래 바꾸는 값이 아님"(공유 URL, 아이디)이면 `readOnly`.
  - 날짜는 `type="date"`(네이티브 날짜 선택기). 따로 DateField를 만들지 않는다.
- `NumberField`: TextField props에서 `value`·`defaultValue`·`onChange`·`type`·`inputMode`를 빼고 `{ value: number | null; onChange: (value: number | null) => void; decimal?: boolean; maxDecimals?: number }`. 화면에는 천 단위 쉼표, 바깥으로는 숫자(비면 null). 숫자 아닌 글자는 버리고 15자리까지. 음수는 받지 않는다. 금액은 `suffix="원"`.
  - 기본은 정수. `decimal`(또는 `maxDecimals`)이면 소수를 받는다: 숫자와 점 하나만 입력되고 다른 글자·두 번째 점·자리 초과는 막힌다. "12." "0.0" 같은 입력 중간 상태는 표시 글자를 따로 들고 있어 사라지지 않는다. 쉼표는 정수 부분에만("1,234.5"), ".5"는 0.5. `inputMode="decimal"`. 순수 함수는 `ui/format.ts`의 `normalizeDecimalInput`·`parseDecimalInput`·`formatDecimalInput`.
- `SearchField`: TextField props에서 `type`·`prefix`·`label`을 빼고 `{ label: string; showLabel?: boolean }`. 앞에 돋보기, `clearable` 기본 켜짐. 라벨은 기본으로 화면 낭독기에만(FilterBar 안), `showLabel`이면 위에 보인다.
- 쓴다: 단위·지우기·글자 수가 필요한 입력, 금액, 검색. 단순 한 줄은 `Input`도 된다.
- 안 쓴다: 여러 줄(Textarea), 정해진 선택지(Select, RadioGroup, ChoiceChips).

```tsx
<TextField label="영상 길이" suffix="초" value={sec} onChange={(e) => setSec(e.target.value)} error={fields.sec} />
<TextField label="캠페인 이름" showCount maxLength={30} clearable value={name} onChange={(e) => setName(e.target.value)} />
<TextField label="공유 URL" value={url} readOnly />
<TextField label="마감일" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
<NumberField label="원고료" suffix="원" value={fee} onChange={setFee} />
// 참여 조건 금액: 통화를 금액 앞에 두고, 금액은 숫자와 점만 (12.5 USD 그대로 서버로)
<div className="grid-2">
  <Select label="통화" value={currency} onChange={(e) => setCurrency(e.target.value)}>{/* 원(KRW), 달러(USD) */}</Select>
  <NumberField label="금액" suffix={currency === "KRW" ? "원" : "달러"} decimal maxDecimals={2} value={amount} onChange={setAmount} />
</div>
<SearchField label="인플루언서 검색" placeholder="이름, 핸들" value={q} onChange={(e) => setQ(e.target.value)} />
```

### 4.22 Field (`ui/Field.tsx`)

- props: `{ id: string; label?; hint?; error?; required?: boolean; fit?: boolean; count?: { current: number; max?: number }; children: ReactNode }`. `describedBy(id, { hint, error }, hasCount?)`가 짝 함수.
- 쓴다: 공통 컴포넌트를 새로 만들 때 라벨·도움말·오류·글자 수 묶음. 안쪽 입력에 `id`와 `aria-describedby={describedBy(...)}`를 꼭 준다.
- 안 쓴다: 화면 파일에서 직접(그건 TextField·Select 등).

### 4.23 RadioGroup (`ui/RadioGroup.tsx`)

- props: `{ label: string; options: RadioOption<T>[]; value: T | null; onChange: (value: T) => void; hint?; error?; name?: string; required?: boolean; disabled?: boolean; direction?: "column" | "row" }`. `RadioOption<T> = { value: T; label: string; description?: string; disabled?: boolean }`. 기본 `direction="column"`.
- 네이티브 라디오라 Tab 한 번에 묶음으로 들어오고 화살표로 이동·선택한다. `fieldset` + `legend`, 오류는 `aria-invalid`와 `aria-describedby`.
- 쓴다: 하나 고르기인데 선택지마다 설명이 필요하거나 글이 길 때(보상 방식).
- 안 쓴다: 짧은 선택지 2~8개(ChoiceChips), 많을 때(Select), 보기 전환(SegmentedControl).

```tsx
<RadioGroup label="보상 방식" options={PAY_OPTIONS} value={pay} onChange={setPay} error={fields.pay} />
```

### 4.24 Switch (`ui/Switch.tsx`)

- props: `Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role" | "onChange" | "checked"> & { label: ReactNode; description?: ReactNode; checked: boolean; onChange: (checked: boolean) => void; hideLabel?: boolean }`.
- 네이티브 체크박스 + `role="switch"`. Space로 토글, `aria-checked`는 브라우저가 맞춘다. 라벨 왼쪽, 스위치 오른쪽.
- 쓴다: 누르는 즉시 반영되는 켜고 끄기(알림 받기, 링크 공개).
- 안 쓴다: 저장 버튼을 눌러야 반영되는 폼 안 선택(Checkbox). 라벨에 "켜짐·꺼짐·스위치"를 쓰지 않는다(낭독기가 읽는다). 표 행처럼 라벨을 숨길 때도 `label`은 꼭 주고 `hideLabel`.

```tsx
<Switch label="새 업로드 알림" checked={notify} onChange={(v) => void save({ notify: v })} />
```

### 4.25 SegmentedControl (`ui/SegmentedControl.tsx`)

- props: `{ label: string; options: SegmentOption<T>[]; value: T; onChange: (value: T) => void; size?: "sm" | "md"; fluid?: boolean; disabled?: boolean }`. `SegmentOption<T> = { value: T; label: string; disabled?: boolean }`. 기본 `size="md"`, 모든 칸 같은 폭.
- 숨긴 네이티브 라디오라 화살표 키로 이동·선택. `label`은 화면 낭독기 전용. `fluid`면 칸 폭이 글자에 맞고, 넘치면 가로 스크롤.
- 쓴다: 같은 내용을 다르게 보기(기간 7일·30일·90일, 표·카드). 2~4개.
- 안 쓴다: 다른 화면·패널로 바꾸기(Tabs), 폼 값 입력(ChoiceChips, RadioGroup).

```tsx
<SegmentedControl label="기간" options={PERIODS} value={period} onChange={setPeriod} />
```

### 4.26 ListRow (`ui/ListRow.tsx`)

- props: `{ title: ReactNode; description?: ReactNode; leading?: ReactNode; trailing?: ReactNode; onClick?: () => void; withArrow?: boolean; disabled?: boolean; padding?: "sm" | "md" | "lg" }`. 기본 `padding="md"`(위아래 12px).
- 왼쪽(Avatar·Icon) / 가운데(제목·설명) / 오른쪽(Badge·값·Switch) 세 칸. `onClick`이 있으면 행 전체가 버튼이고 hover 바탕이 생긴다.
- 쓴다: 설정 항목, 연결 계정, 짧은 사람 목록.
- 안 쓴다: 열이 여러 개인 데이터(Table). `onClick` 행의 `trailing`에 Switch·버튼을 넣지 않는다(버튼 안 버튼).

```tsx
<ListRow leading={<Avatar name={c.name} />} title={c.name} description={c.handle} trailing={<Badge tone="success">연결됨</Badge>} />
<ListRow title="결제 수단" description="카드 1개" withArrow onClick={openPayment} />
```

### 4.27 Avatar (`ui/Avatar.tsx`)

- props: `{ name: string; src?: string; size?: "sm" | "md" | "lg" }`. 기본 `md`(32px). 사진이 없으면 첫 글자.
- 장식(`aria-hidden`)이라 옆에 이름 글자를 꼭 같이 둔다. 셸 계정 메뉴의 지역 Avatar(`shell/AccountMenu.tsx`)는 아직 따로다.

### 4.28 Tooltip (`ui/Tooltip.tsx`)

- props: `{ content: string; children: ReactElement; placement?: "top" | "bottom" }`. 기본 `top`.
- 마우스를 올리거나 키보드 포커스면 열리고, 떠나거나 Esc면 닫힌다. `aria-describedby`로 트리거에 이어진다. 트리거는 포커스되는 요소(IconButton 등) 하나.
- 모양: TDS Tooltip medium 실측(흰 면, 모서리 16, 15px 굵게, 큰 옅은 그림자). TDS의 꼬리 모양은 아직 없다.
- 쓴다: 아이콘 버튼·지표 이름의 짧은 보조 설명 한두 문장.
- 안 쓴다: 꼭 읽어야 하는 안내(hint·캡션으로 보이게), 누르는 동작·링크, 터치 기기 전용 화면(hover가 없다).

```tsx
<Tooltip content="전환율은 가입 수를 클릭 수로 나눈 값이에요."><IconButton icon="circle-help" label="전환율 설명" /></Tooltip>
```

### 4.29 ProgressBar, Spinner (`ui/ProgressBar.tsx`, `ui/Spinner.tsx`)

- `ProgressBar`: `{ value: number; label: string; showValue?: boolean; size?: "sm" | "md"; tone?: "accent" | "success" | "danger" }`. `value`는 0~1(밖이면 자름). `role="progressbar"` + `aria-valuenow`(0~100). `showValue`면 위에 라벨과 "42%".
- `Spinner`: `{ size?: "sm" | "md" | "lg" | "xl"; label?: string }`. 기본 `md`. `label`이 있으면 `role="status"`로 읽히고, 없으면 장식. 모양은 TDS Loader(강조색 원 호, 0.7초 뒤 나타남).
- `Loader`: `{ label?: string; size?: "md" | "lg" | "xl"; fill?: boolean }`. 기본 `lg`, 문구 "불러오는 중이에요". TDS Loader + label: 가운데 스피너 아래 15px 문구. `fill`이면 영역 가운데(최소 높이 화면 40%). 앱 첫 로그인 확인, 번호 인증·초대·온보딩 확인, `Suspense` fallback에 쓴다.
- 쓴다: 업로드·처리 진행률(ProgressBar), 작은 자리의 짧은 기다림(Spinner), 모양을 미리 보여 줄 수 없는 기다림(Loader).
- 안 쓴다: 화면 전체·목록 로딩(LoadingState), 버튼 진행(Button `loading`).

```tsx
<ProgressBar label="업로드" value={sent / total} showValue />
<Spinner label="미리보기를 만드는 중" />
```

### 4.30 TagInput (`ui/TagInput.tsx`)

- props: `{ label?; hint?; error?; value: string[]; onChange: (value: string[]) => void; id?: string; placeholder?: string; max?: number; required?: boolean; disabled?: boolean }`.
- Enter·쉼표로 칩 추가, 칩의 x 또는 빈 칸에서 Backspace로 마지막 칩 삭제, 칸을 벗어나면 친 글도 칩이 된다. 쉼표가 든 글을 붙여 넣으면 나눠서 넣는다. 앞뒤 공백·빈 값·중복(대소문자 무시)은 빠진다. 한글 조합 중 Enter는 조합 확정이라 추가하지 않는다.
- `max`에 닿으면 입력칸이 잠긴다(hint로 "n개까지"를 알린다). 라벨·도움말·오류 규칙은 TextField와 같다(7.1절).
- 쓴다: 키워드, 해시태그, 금지어처럼 짧은 글 여러 개.
- 안 쓴다: 정해진 선택지에서 고르기(ChoiceChips), 긴 문장 목록(Textarea 한 줄에 하나).

```tsx
<TagInput label="금지어" hint="Enter나 쉼표로 하나씩 넣어 주세요." value={words} onChange={setWords} error={fields.words} />
```

### 4.31 Disclosure (`ui/Disclosure.tsx`)

- props: `{ title: ReactNode; count?: number; description?: ReactNode; defaultOpen?: boolean; children: ReactNode }`.
- 네이티브 `details`/`summary`: Enter·Space로 열고 닫고, 낭독기가 펼침 상태를 읽는다. 왼쪽 화살표가 열리면 90도 돈다. `count`는 접혀 있어도 안에 몇 개인지 보이는 작은 숫자, `description`은 오른쪽 옅은 글.
- 쓴다: 평소엔 안 봐도 되는 묶음(지난 버전, 적용된 규칙 목록, 자주 묻는 질문). 여러 개를 이어 두면 아래 경계선으로 나뉜다.
- 안 쓴다: 처음부터 꼭 봐야 하는 내용, 화면 전환(Tabs), 열고 닫을 때 다른 동작이 필요한 패널(Drawer).

```tsx
<Disclosure title="적용된 브랜드 규칙" count={rules.length}>{rules.map((r) => <p key={r.id}>{r.text}</p>)}</Disclosure>
```

### 4.32 SelectMenu (`ui/SelectMenu.tsx`)

직접 그린 선택 드롭다운. WAI-ARIA combobox + listbox 패턴. 순수 로직은 `ui/selectMenuLogic.ts`(vitest), 위치는 `ui/usePopoverPosition.ts`, 키 동작은 `ui/useSelectMenu.ts`.

- props: `SelectMenuProps = SingleProps | MultiProps`.
  - 공통: `{ options: SelectOption[]; label?; hint?; error?; placeholder?: string; size?: "sm" | "md" | "lg"; disabled?; required?; searchable?: boolean; clearable?: boolean; emptyText?: string; searchPlaceholder?: string; id?: string; "aria-label"?: string }`.
  - 단일: `{ multiple?: false; value: string | null; onChange: (value: string | null) => void }`.
  - 다중: `{ multiple: true; value: string[]; onChange: (value: string[]) => void; display?: "chips" | "count" }`. 기본 `chips`(2개 + "+N"), `count`는 "N개 선택".
  - `SelectOption = { value: string; label: string; description?: string; disabled?: boolean; group?: string }`. 같은 `group`은 묶음 제목 아래 모인다(처음 나온 순서).
- 검색: `searchable`을 안 주면 선택지 8개 이상일 때 목록 위에 검색칸이 뜬다. 이름·설명에서 찾고, 없으면 `emptyText`(기본 "맞는 항목이 없어요").
- 키보드: 닫힌 칸에서 아래·위·Enter·Space·Home·End로 열기, 글자를 치면 그 글자로 시작하는 항목으로(검색칸이 없을 때). 열린 목록에서 아래·위·Home·End·PageUp·PageDown 이동(비활성 건너뜀, 끝에서 멈춤), Enter(검색칸 없으면 Space도) 고르기, Esc 닫고 칸으로 포커스 복귀(모달·드로어는 안 닫힘), Tab 닫고 다음 칸으로. 단일은 고르면 닫히고, 다중은 열린 채로 넣고 뺀다(`aria-multiselectable`).
- 위치: 목록은 `document.body`에 `position: fixed`로 붙어(`--z-select-menu`) 표·모달·드로어의 overflow에 잘리지 않는다. 아래 공간이 모자라면 위로 열리고, 스크롤하면 따라가며, 칸이 화면 밖으로 나가면 닫힌다.
- 휴대폰 폭(599 이하)에서는 `Drawer side="bottom"` 바텀시트로 연다. 다중 선택은 아래 고정 "완료"로 닫는다.
- 크기: `sm`(표 안·줄 안, 폭은 내용만큼), `md`, `lg`(공개 화면 주 입력, 56). 칸 모양은 TextField와 같다(채움형).
- **Select(네이티브)와 고르는 기준**
  - `Select`: 선택지가 짧고(대략 7개 이하) 이름만 있으면 된다. 휴대폰 OS 선택기를 그대로 쓰고 가장 가볍다. 필터 줄, 폼의 단순 선택.
  - `SelectMenu`: 검색이 필요할 만큼 많거나, 선택지에 설명 줄·묶음·비활성 이유를 보여야 하거나, 여러 개를 고르거나, 지우기 단추가 필요할 때.
  - `ChoiceChips`·`RadioGroup`: 2~6개를 펼쳐 보여 주는 편이 나을 때. `Dropdown`: 값이 아니라 동작 목록.

```tsx
<SelectMenu label="주 채널" options={CHANNELS} value={channel} onChange={setChannel} clearable />
<SelectMenu label="게시 채널" multiple options={CHANNELS} value={channels} onChange={setChannels} />
<SelectMenu aria-label={`${row.name} 상태`} size="sm" options={STATUS} value={row.status} onChange={(v) => save(row.id, v)} />
```

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
{rows === null ? <LoadingState pattern="table" /> : rows.length === 0 ? <EmptyState title="..." action={create} /> : <Table>...</Table>}
```

예: `src/client/features/campaigns/CampaignsListPage.tsx`(FilterBar + Table), `src/client/features/reviews/ReviewsPage.tsx`(Tabs + FilterBar + Table)

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

AppShell 밖. 모바일 우선, 넓은 화면에서는 가운데 560px. 바탕 `--color-surface-subtle`, 섹션은 흰 면 + `--radius-card`, 좌우 여백 `--layout-gutter`, 아래 고정 CTA(`FloatingActionBar`, 4.15.1). 문구는 i18n `t()`로. 머리글은 `PublicShell centerBrand`(브랜드 가운데, 오른쪽 언어 전환). 인플루언서 개인 링크(/g, /u, /f)는 머리글 아래에 같은 탭 줄(`InfluencerTabs`, LinkTabs)을 붙이고, 탭 주소에 `?lang=`을 붙여 언어를 유지한다.

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
| 읽기 전용 | TextField `readOnly` | 원래 바꾸는 값이 아닌 것(공유 URL, 아이디). 고르고 복사는 된다. "아직 못 바꿈"은 `disabled` |
| 진행 중 | `Button loading`, `Spinner`, `ProgressBar` | 버튼은 폭 유지 + `aria-busy`. 진행률을 알면 ProgressBar |
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

### 7.1 입력칸 문구(도움말·오류)

토스 오류 문구 원칙("다음으로 넘어갈 수 있게 안내", 해요체)을 따른다. 근거: `findings/toss-design-system-benchmark.md` 4절.

- **자리**: 도움말과 오류는 칸 바로 아래 한 자리. 오류가 생기면 도움말 자리를 오류가 차지한다. 단위는 문장에 넣지 말고 `suffix`로.
- **도움말(hint)**: 무엇을 넣으면 되는지 한 문장. 예시가 낫다. "가입에 쓴 주소를 넣어 주세요.", "숫자만 넣으면 쉼표는 저절로 붙어요."
- **오류(error)**: 무엇이 틀렸고 어떻게 고치는지를 한 문장에. 사용자를 탓하지 않는다.
  - 비었음: "~을/를 입력해 주세요." / 고르기: "~을/를 골라 주세요."
  - 형식: "이메일 주소 형식으로 입력해 주세요(예: name@brand.com)."
  - 범위: "1초 이상으로 입력해 주세요.", "30자 이내로 줄여 주세요."
  - 서버 확인: "이미 쓰고 있는 이름이에요. 다른 이름을 입력해 주세요."
  - 쓰지 않는다: "잘못된 입력입니다", "오류", "Invalid", 느낌표, 합쇼체.
- **검사 시점**: 제출할 때(6절). 입력 중에는 글자 수 넘침처럼 바로 보이는 것만 빨간 글자 수로 알린다.
- **라벨**: 명사로 짧게("원고료", "마감일"). 라벨에 "입력", "선택"을 붙이지 않는다. 자리 표시(placeholder)는 예시만, 라벨 대신 쓰지 않는다.

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
