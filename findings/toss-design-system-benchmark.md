# 토스 디자인 시스템(TDS) 벤치마킹: 입력칸·선택 컨트롤·상태 컴포넌트

작성 2026-10-30, Jira AIWITH-536 (상위 AIWITH-535), 구현 AIWITH-531~534.

## 0. 전제

- **색은 가져오지 않는다.** avocado 색은 `src/client/styles/tokens.css`의 의미 토큰(`--color-*`) 그대로 쓴다. TDS에서는 구조, 상태 규칙, props 설계, 접근성 규칙만 본다.
- 공개 자료만 봤다. 앱인토스 개발자 문서(TDS Mobile 컴포넌트 문서)와 toss.tech 블로그 글이다. 토스 코드·Figma 자산·아이콘은 복사하지 않았다. TDS는 앱인토스 서비스 제공 목적에 한해 쓰도록 공개돼 있다 [웹: https://developers-apps-in-toss.toss.im/design/components]. 그래서 패턴만 참고하고 구현은 직접 했다.
- TDS Mobile은 모바일 웹뷰용이다. avocado는 PC 대시보드가 주 화면이고 공개 화면(인플루언서용)만 모바일 우선이라, 모바일 전용 부품(키패드, 상단 고정 검색창 등)은 뺐다.
- 표기: [웹: URL]은 문서에서 확인한 것, [추론]은 문서에 없어서 우리가 판단한 것.

## 1. TDS 컴포넌트 목록과 역할

TDS Mobile 문서 사이드바 기준 [웹: https://tossmini-docs.toss.im/tds-mobile/components/button/].

| 컴포넌트 | 역할 |
|-|-|
| Badge | 상태·분류 작은 표시 |
| Board Row | 펼치고 접는 글 행(공지·FAQ류) [추론: 이름 기준] |
| Border | 구분선 |
| Bottom Info | 화면 아래 안내 문단 [추론: 이름 기준] |
| Bottom Sheet | 화면 아래에서 올라오는 패널. 제목, 부제, 아래 CTA, 선택 목록 |
| Bubble | 말풍선 [추론: 이름 기준] |
| Button / Icon Button / Text Button | 동작 실행. 크기 4단(small~xlarge), fill·weak, 로딩, 비활성 |
| Checkbox | 하나 이상 고르기. 원형·선형 두 모양, 라디오 모드 |
| Dialog (Alert, Confirm) | 확인 하나 / 취소·확인 둘 모달 |
| Grid List | 격자 목록 |
| Highlight | 특정 영역 강조 [추론: 이름 기준] |
| Keypad (숫자·영문·보안) | 앱 안 자체 키패드 |
| List Header / List Footer | 목록 머리·꼬리 |
| ListRow | 왼쪽(아이콘)·가운데(글)·오른쪽(부가 정보·버튼) 세 칸 행 |
| Loader | 불러오는 중 회전 표시, 크기 3단, 아래 글 |
| Menu | 버튼 뒤 동작 목록 |
| Modal | 모달 바탕 |
| Numeric Spinner | 숫자 하나 올리고 내리기 |
| Paragraph | 본문 문단 글자 스타일 |
| Post | 글 본문 |
| Progress Bar / Progress Stepper / Stepper | 진행률 막대 / 단계 표시 |
| Rating | 별점 |
| Result | 결과 화면(완료·실패) |
| Search Field | 검색 입력. 지우기 버튼, 상단 고정 |
| Segmented Control | 몇 개 중 하나 고르기 |
| Skeleton | 불러오는 동안 화면 골격 |
| Slider | 범위 값 |
| Switch | 켜고 끄기 |
| Tab | 탭 |
| Table Row | 표 한 줄(이름·값) |
| TextField / SplitTextField / TextArea | 한 줄 입력, 칸 나뉜 입력(인증번호류), 여러 줄 입력 |
| Toast | 잠깐 뜨고 사라지는 알림 |
| Tooltip | 작은 요소의 보조 설명 |
| Top | 화면 머리(제목) |
| Agreement, Asset, BottomCTA, Chart | 약관 동의 목록, 이미지·아이콘 틀, 아래 고정 CTA, 막대 차트 |

## 2. 입력칸 패턴

출처: TextField [웹: https://tossmini-docs.toss.im/tds-mobile/components/TextField/text-field/], TextArea [웹: https://tossmini-docs.toss.im/tds-mobile/components/TextField/text-area/], Search Field [웹: https://tossmini-docs.toss.im/tds-mobile/components/search-field/].

| 항목 | TDS | avocado 결정 |
|-|-|-|
| 모양 | `variant` 필수: box(사각), line(밑줄), big(큰 글자), hero(눈에 띄는 큰 글자) | box 하나만. 대시보드는 여러 칸이 한 화면에 모여 있어 밑줄·큰 글자형이 맞지 않음 [추론]. 크기만 sm·md·lg 3단 |
| 라벨 위치 | 칸 위. `labelOption`: appear(값이 들어오면 라벨 표시, 기본) / sustain(항상 표시). sustain은 "여러 입력 필드가 함께 있을 때" 목적을 늘 알게 해 줌 | 항상 표시(sustain에 해당)만. 폼에 칸이 여러 개라서 [추론] |
| 도움말·오류 | 칸 아래 `help` 한 자리. 오류는 `hasError`로 상태만 바꾸고 문구는 `help`에 같이 넣으라고 권함(3글자 제한 예시) | 이미 같은 구조(`hint` 자리를 `error`가 대신 차지). 그대로 유지 |
| 지우기 | `TextField.Clearable`, `onClear` 콜백(검색 결과·최근 검색 갱신용) | `clearable` + `onClear` 추가. 값이 있고 비활성·읽기 전용이 아닐 때만 버튼 노출 |
| 앞뒤 단위 | `prefix`·`suffix`는 문자열(통화, kg, 원), `right`는 버튼·아이콘 같은 컴포넌트 | 같은 이름으로 `prefix`·`suffix`(ReactNode) 추가. `right` 대신 `suffix`에 넣는다(한 칸으로 충분) [추론] |
| 서식 | `format: { transform, reset }`로 입력값 변환 | 금액·숫자 전용 `NumberField`로 고정(천 단위 쉼표, 숫자만). 범용 transform은 안 만듦(쓸 곳 하나) [추론] |
| 글자 수 | 문서에 없음 | 우리 기능(가이드 규칙, 메모 길이 제한)에 필요해서 `showCount` + `maxLength` 추가. 칸 아래 오른쪽 "12/100" |
| 비밀번호 | `TextField.Password`, 보이기·숨기기 토글 | 이번엔 안 만듦. 비밀번호 칸은 로그인·가입 두 곳뿐이고 화면 파일은 이번 작업 범위 밖 |
| 버튼형 입력 | `TextField.Button`(입력처럼 보이는 버튼, 아래 화살표) | 안 만듦. Select·Dropdown으로 충분 |
| 상태 | disabled: 서버 요청 중이거나 조건 충족 전 수정 막기. 포커스 모양·읽기 전용은 문서에 없음 | 기존 포커스 링·오류 테두리·비활성 바탕 유지. 읽기 전용은 새로 정의: 바탕 subtle, 테두리 기본, 커서 기본, 지우기 숨김 |
| 여러 줄 | TextArea는 내용 양에 따라 높이가 자동으로 늘고 `minHeight`, 고정 `height` | `Textarea`에 `autoGrow` 추가(기본 꺼짐, 지금 모양 유지). 최소 높이는 기존 96px |
| 검색 | 검색·삭제 아이콘, 지우면 `onDeleteClick`, 상단 고정 `fixed` | `SearchField`: 앞 돋보기, 지우기, `type="search"`. 상단 고정은 뺌(대시보드 FilterBar 안에 놓임) |

## 3. 버튼·선택 컨트롤·목록·오버레이·상태 규칙

| 컴포넌트 | TDS 규칙 | 출처 |
|-|-|-|
| Button | 크기 4단, 기본 xlarge. fill(채움, 주 동작)·weak(반투명, 보조). 색 primary·danger·light·dark. display inline·block·full. **loading이면 점 3개가 돌고 버튼 너비는 변하지 않음**, `aria-busy`로 알림. 아이콘만 있으면 `aria-label` | [웹: https://tossmini-docs.toss.im/tds-mobile/components/button/] |
| Checkbox | 원형(Circle)·선형(Line), 크기 기본 24, 제어·비제어, `inputType="radio"`로 하나만 고르기. 비활성은 눌러도 안 바뀌고 좌우로 흔들림. 접근성 라벨에 "체크박스"를 넣지 말 것(낭독기가 이미 읽음) | [웹: https://tossmini-docs.toss.im/tds-mobile/components/checkbox/] |
| Switch | `checked` + `onChange(event, checked)`, `role="switch"`, `aria-checked` 자동, 글이 없으면 `aria-label` 필수. 라벨에 "스위치·켜짐·꺼짐"을 넣지 말 것 | [웹: https://tossmini-docs.toss.im/tds-mobile/components/switch/] |
| Segmented Control | 하나 고르기, 라디오 그룹처럼 동작. 크기 small(기본)·large, 배치 fixed(같은 폭)·fluid(글 폭). 넘치면 가로 스크롤. `role="radiogroup"`, 항목 `role="radio"` + `aria-checked` | [웹: https://tossmini-docs.toss.im/tds-mobile/components/segmented-control/] |
| 라디오 vs 체크박스 | 사용자는 모양보다 질문 맥락에 반응. "선택해야 할 개수를 자연스럽게 이해할 수 있도록" 맥락을 주라. 다만 낭독기는 둘을 다르게 읽으므로 의미 구분은 지킨다 | [웹: https://toss.tech/article/mysterydesignclub1] |
| ListRow | left·contents·right 세 칸, `withArrow`, onClick이 있으면 눌림 효과, disabled, 위아래 여백 4단(8·12·16·24px, 기본 12) | [웹: https://tossmini-docs.toss.im/tds-mobile/components/ListRow/list-row-overview/] |
| Bottom Sheet | 아래에서 올라옴. 제목(`header`), 부제, 아래 CTA(하나·둘), 선택 목록. 바깥을 누르면 닫히는 것이 권장 동작. 포커스 잠금이 기본이고 끄면 직접 접근성 대응 필요. 입력칸이 있으면 키보드 위로 | [웹: https://tossmini-docs.toss.im/tds-mobile/components/bottom-sheet/] |
| Dialog | 확인 하나(Alert): 완료·상태 변경 알림. 취소·확인 둘(Confirm): 중요한 동작 전 확인. 제목 + 설명(선택) + 버튼 | [웹: https://tossmini-docs.toss.im/tds-mobile/components/Dialog/dialog/] |
| Toast | 위·아래 위치, 기본 3000ms, 버튼이 있으면 5000ms. 왼쪽 아이콘으로 성격(성공·경고·오류) 표시. `aria-live` 기본 polite | [웹: https://tossmini-docs.toss.im/tds-mobile/components/toast/] |
| Tooltip | 아이콘·버튼 같은 작은 요소의 보조 정보. 위·아래, 화면 밖이면 뒤집기, hover·focus로 열기, 바깥 클릭·Escape로 닫기, 크기 3단 | [웹: https://tossmini-docs.toss.im/tds-mobile/components/tooltip/] |
| Skeleton | 불러오는 동안 화면 골격. 미리 정한 패턴 9종(목록, 아이콘 목록, 카드 등) + 직접 조합, 마지막 항목 반복(기본 3) | [웹: https://tossmini-docs.toss.im/tds-mobile/components/skeleton/] |
| Loader | 크기 3단(기본 medium), 아래 글(여러 줄 가능), 어두운 바탕용 light | [웹: https://tossmini-docs.toss.im/tds-mobile/components/loader/] |
| Progress Bar | 0~1 값, 굵기 3단, 값이 바뀔 때 애니메이션 선택 | [웹: https://tossmini-docs.toss.im/tds-mobile/components/progress-bar/] |

## 4. 접근성 규칙

- **컴포넌트에 접근성을 미리 넣는다.** 열리고 닫힐 때 초점을 지정하고, 낭독기용 투명 닫기 버튼을 두고, 오른쪽 장식 아이콘은 읽지 않게 했다. 만드는 사람이 화면마다 정하지 않게 하는 것이 목적 [웹: https://toss.tech/article/toss-design-system].
- **큰 글자·긴 글.** 글자가 커지면 줄바꿈 단위를 바꾸고 아이콘도 함께 키운다. 목록이 길면 위아래 흐림으로 더 있음을 알린다 [웹: https://toss.tech/article/toss-design-system].
- **가이드 맨 아래 접근성 체크리스트.** 큰 텍스트, 보이스오버, 동작 줄이기, 다크모드 [웹: https://toss.tech/article/toss-design-system-guide].
- **역할·상태 속성 자동.** Switch `role="switch"`·`aria-checked`, Checkbox `aria-checked`·`aria-disabled`, Segmented `radiogroup/radio`, Button 로딩 `aria-busy` [웹: 2·3절 각 문서].
- **라벨에 요소 종류를 쓰지 않는다**("체크박스", "스위치"는 낭독기가 붙여 읽음) [웹: https://tossmini-docs.toss.im/tds-mobile/components/checkbox/].
- **오류 문구는 다음 화면으로 넘어가게 안내하는 것.** 토스 잘못이어도 해요체, 상황별 템플릿으로 통일 [웹: https://toss.tech/article/introducing-toss-error-message-system].
- 문서에 없어서 우리가 정한 것 [추론]: 라디오·세그먼트 화살표 키 이동, 스위치 Space 토글(네이티브 체크박스 동작), 도움말·오류·글자 수를 `aria-describedby`로 연결, 오류 시 `aria-invalid`, 움직임 줄이기(`prefers-reduced-motion`)에서 스켈레톤·스피너 애니메이션 멈춤.

## 5. 컴포넌트별 결정표

"우리 현재"는 `src/client/ui/` 작업 전 파일 기준.

| TDS | 우리 현재 | 결정 | 이유 |
|-|-|-|-|
| TextField | `Input`(라벨·도움말·오류·필수) | **새 `TextField`** (`ui/TextField.tsx`), `Input`은 그대로 | prefix·suffix·지우기·글자 수·크기·읽기 전용이 필요. `Input` 마크업을 바꾸면 TASK-079와 기존 화면이 흔들려서 감싸기로 분리 |
| TextArea | `Textarea` | **확장**: `autoGrow`, `showCount` | 기본값은 지금 모양 |
| TextField format(금액) | 없음 | **새 `NumberField`** | 비용·정산 금액 입력용. 천 단위 쉼표, 숫자만 |
| Search Field | FilterBar 안 `Input` + 아이콘 없음 | **새 `SearchField`** | 돋보기, 지우기. 상단 고정은 제외(모바일 앱 패턴) |
| 날짜 | 화면마다 `Input type="date"` | **새 컴포넌트 안 만듦**, `TextField type="date"`로 문서화 | 네이티브 날짜 선택기로 충분 |
| (Select) | `Select` md·sm | **확장**: `size="lg"`, 읽기 전용 모양은 해당 없음(네이티브 select엔 readOnly 없음) | TextField 크기와 맞춤 |
| Checkbox | `Checkbox`(라벨만) | **확장**: `description`, `indeterminate` | 원형 모양은 안 만듦(네이티브 체크박스 + 강조색 유지) |
| Checkbox radio 모드 | 없음(ChoiceChips 단일) | **새 `RadioGroup`** | 설명이 붙는 긴 선택지는 칩보다 라디오 목록이 맞음. 네이티브 radio라 화살표 키가 기본 동작 |
| Switch | 없음 | **새 `Switch`** | 알림·설정 켜고 끄기. 즉시 반영되는 설정엔 체크박스보다 맞음 |
| Segmented Control | `Tabs`(화면 전환), `ChoiceChips`(칩) | **새 `SegmentedControl`** | 기간(7일·30일)·보기 방식 전환처럼 내용 일부만 바꾸는 선택. Tabs는 탭 패널 의미라 구분 |
| ListRow | 없음(화면마다 목록 마크업) | **새 `ListRow`** | 설정·연결 계정·알림 목록에 반복 |
| Bottom Sheet | `Drawer`(오른쪽) | **확장**: `Drawer side="bottom"` | 공개 화면(모바일) 선택 목록용. 포커스 잠금은 기존 `useDialog` 재사용 |
| Dialog Confirm | `Modal` + 화면에서 `confirm()` | 안 만듦(이번) | 쓰는 곳이 화면 파일이라 범위 밖. 다음 작업 후보로 남김 |
| Toast | `ToastProvider` 성공·오류 아이콘 | 그대로 | 이미 같은 규칙(아이콘으로 성격, polite). 버튼 달린 토스트는 쓸 곳 없음 |
| Tooltip | 사이드바 접힘 `data-tip`(셸 전용 CSS) | **새 `Tooltip`** | 아이콘 버튼·지표 설명. hover·focus 열기, Escape 닫기, `aria-describedby` |
| Skeleton | `LoadingState`(줄 3개) | **확장**: `pattern="list" \| "card"` | 새 컴포넌트 대신 기존 확장 |
| Loader | 없음 | **새 `Spinner`**, `Button loading` | 버튼 안 진행 표시. 너비 유지 규칙 따름 |
| Progress Bar | 화면마다 막대(성과 화면) | **새 `ProgressBar`** | 업로드·진행률. `role="progressbar"` |
| Asset(이미지 틀) | 셸 안 지역 `Avatar` | **새 `Avatar`** | 인플루언서·워크스페이스 첫 글자 원. 셸 쪽은 다음에 옮김 |
| Border | `.dev-part`처럼 테두리 CSS | 안 만듦 | 테두리 1px 한 줄. 네이티브 `<hr>`나 카드 경계로 충분 |
| Badge, Tab, Menu, Modal, Top, List Header | Badge, Tabs, Dropdown, Modal, PageHeader, SectionCard | 그대로 | 이미 있음 |
| BottomCTA | FloatingActionBar | 그대로 | 이미 있음 |
| Result | EmptyState | 그대로 | 이미 있음 |
| Table Row | Table | 그대로 | 대시보드는 표가 맞음 |
| Text Button | `.link-button` | 그대로 | 이미 있음 |
| Keypad, SplitTextField | 없음 | 안 만듦 | 앱 자체 키패드는 웹 대시보드에 안 맞음. 인증번호 칸은 지금 한 칸 입력으로 충분 |
| Numeric Spinner, Slider, Rating, Stepper | 없음 | 안 만듦 | 쓸 화면이 없음 |
| Board Row | 없음 | **새 `Disclosure`** (TASK-079 요청) | 지난 버전·적용 규칙처럼 접어 두는 묶음. 네이티브 details/summary 라 키보드·낭독기 기본 지원 |
| (TDS에 없음) 칩 입력 | 없음 | **새 `TagInput`** (TASK-079 요청) | 금지어·키워드 여러 개 입력. 라벨·도움말·오류는 TextField 규칙 |
| Bubble, Highlight, Post, Paragraph, Grid List, Chart, Agreement | 없음 | 안 만듦 | 쓸 화면이 없거나 화면 전용(약관은 공개 화면 동의 폼이 따로 있음) |

## 6. 바꾸지 않은 것

- 기존 `Input`·`Select`·`Textarea`·`Checkbox`의 기본 모양과 props는 그대로다. TDS에 맞춰 바꿀 근거(라벨 appear 방식, 밑줄형)는 대시보드에 맞지 않는다고 봤다 [추론].
- 색 토큰은 하나도 바꾸지 않았다. 새 토큰은 크기·모션만(`--control-height-lg`, `--switch-*`, `--duration-slow` 등, DESIGN.md 3절).

## 7. 한계

- TDS Mobile 문서는 컴포넌트마다 접근성 서술 깊이가 다르다. 키보드 조작은 대부분 문서에 없어 WAI-ARIA 관례로 정했다 [추론].
- Board Row, Bottom Info, Bubble, Highlight는 상세 페이지를 열지 않고 이름으로 역할을 적었다 [추론].
- TDS 웹(PC)용 문서는 찾지 못했다. 모바일 문서를 PC 대시보드에 옮긴 판단은 모두 [추론]이다.

## 8. 크기·모양 값 (AIWITH-542, 2026-10-30)

TASK-080은 TDS의 기능·상태·접근성 규칙만 가져오고 높이·모서리·여백·글자는 기존 값을 유지했다. 이번에는 **색만 우리 것으로 두고 크기·모양은 TDS를 따른다.**

### 8.1 조사 방법과 근거 표기

- TDS Mobile 문서 본문에는 컴포넌트 수치가 거의 없다. Button 문서는 size 이름(small·medium·large·xlarge)만 있고 높이·모서리 값은 없다 [웹: https://tossmini-docs.toss.im/tds-mobile/components/button/]. TextField 문서도 `paddingTop`·`paddingBottom` 기본값이 "-"로 적혀 있다 [웹: https://tossmini-docs.toss.im/tds-mobile/components/TextField/text-field/].
- 대신 문서 페이지 안의 예시(.preview)는 **실제 TDS 컴포넌트가 렌더된 것**이다. 헤드리스 Chrome으로 각 문서 페이지를 열어 예시 요소의 계산된 스타일(getComputedStyle, getBoundingClientRect)을 쟀다. 측정 스크립트와 원자료는 `.agent_work/scratch/083/toss/`(measure.mjs, *.json).
- 표기: **[실측: 문서 URL]** 공개 문서 예시 컴포넌트에서 잰 값. **[웹: URL]** 문서 글이나 외부 정리 자료. **[추론]** 수치 근거가 없어 우리가 정한 값.
- 외부 정리 자료 oh-my-design(비공식)도 같은 버튼 값(32/8, 38/10, 48/14, 56/16)을 적고 있어 실측과 맞았다 [웹: https://oh-my-design.kr/design-systems/toss]. 눌림 `scale(0.96)`과 포커스 이중 링(1px + 3px)은 이 자료의 실측 재인용이다(우리는 직접 재지 못함).

### 8.2 TDS 실측 값

| 컴포넌트 | TDS 값 | 근거 |
|-|-|-|
| Button small | 높이 32, 좌우 10, 13px, 굵기 600, 모서리 8 | [실측: https://tossmini-docs.toss.im/tds-mobile/components/button/] |
| Button medium | 높이 38, 좌우 16, 15px, 600, 모서리 10 | 같은 곳 [실측] |
| Button large | 높이 48, 좌우 16, 17px, 600, 모서리 14 | 같은 곳 [실측] |
| Button xlarge(기본) | 높이 56, 좌우 28, 17px, 600, 모서리 16 | 같은 곳 [실측] |
| Button 테두리 | 모든 variant 테두리 0. weak는 반투명 면 | 같은 곳 [실측] |
| Button 눌림·포커스 | 눌림 scale(0.96), 포커스 1px + 3px 이중 링 | [웹: https://oh-my-design.kr/design-systems/toss] |
| TextField box | 높이 56, 안쪽 14·16, 모서리 14, **채움형**(아주 옅은 회색 면) + 아주 옅은 1px 테두리, 그림자 없음, 글자 17px/400 | [실측: https://tossmini-docs.toss.im/tds-mobile/components/TextField/text-field/] |
| TextField 라벨 | 13px/400, 칸과 6px | 같은 곳 [실측] |
| TextField 도움말 | 13px/400, 칸과 6px, 회색 | 같은 곳 [실측] |
| TextField 포커스 | box 모양은 면·테두리가 그대로이고 커서 색만 강조색 | 같은 곳 [실측: input.focus() 뒤 재측정] |
| TextField 비활성 | 면이 한 단계 진한 회색(grey200) | 같은 곳 [실측] |
| Search Field | 높이 44, 안쪽 8·10, 모서리 12, 채움형, 아이콘 24, 사이 8 | [실측: https://tossmini-docs.toss.im/tds-mobile/components/search-field/] |
| Checkbox | 24×24 (원형·선형 모두) | [실측: https://tossmini-docs.toss.im/tds-mobile/components/checkbox/] |
| Switch | 50×30, 모서리 15(완전 둥긂), 손잡이 24 | [실측: https://tossmini-docs.toss.im/tds-mobile/components/switch/] |
| Segmented large | 홈 48, 홈 안쪽 4·5, 홈 모서리 14, 칸 40 모서리 10, 고른 칸 흰 면 + 0 1px 2px 그림자, 17px 고름 600 / 안 고름 500 | [실측: https://tossmini-docs.toss.im/tds-mobile/components/segmented-control/] |
| Segmented small | 글자 15px, 같은 굵기 규칙 | 같은 곳 [실측] |
| Tab | 높이 47, 칸 좌우 8, 글자 위 12·아래 14, 17px, 고름 700 / 안 고름 600, 아래 막대 | [실측: https://tossmini-docs.toss.im/tds-mobile/components/tab/] |
| Badge | xsmall 10px/600 모서리 9, small 12px/700 높이 24 모서리 11, medium 13px/700 높이 26 모서리 12, large 14px/700 높이 29 모서리 13. 안쪽 3·7(large 4·8) | [실측: https://tossmini-docs.toss.im/tds-mobile/components/badge/] |
| ListRow | 안쪽 12·24, 칸 사이 16, 눌림 면 모서리 12, 제목 17px/500(굵게 700), 부제 15px/400 | [실측: https://tossmini-docs.toss.im/tds-mobile/components/ListRow/list-row-overview/] |
| Bottom Sheet | 모서리 28, 화면 가장자리와 떨어져 뜸, 위 손잡이 자리 16, 본문 좌우 24, 17px | [실측: https://tossmini-docs.toss.im/tds-mobile/components/bottom-sheet/] |
| Dialog | 폭 320, 모서리 24, 안쪽 22, 제목 20px/700, 설명 15px/500, 버튼 48 모서리 14 사이 8, 전환 0.1s ease-in-out | [실측: https://tossmini-docs.toss.im/tds-mobile/components/Dialog/dialog/] |
| Toast | 완전 둥근 알약(100px), 안쪽 12·16, 15px/600, 그림자 0 2px 30px 옅게 | [실측: https://tossmini-docs.toss.im/tds-mobile/components/toast/] |
| Tooltip | 크기 3단(문서), 수치는 못 잼(예시가 hover로만 열림) | [웹: https://tossmini-docs.toss.im/tds-mobile/components/tooltip/] |
| 글자 단계 | t5 17/25.5, t6 15/22.5, t7 13/19.5 (위 실측 글자들과 일치) | [웹: https://oh-my-design.kr/design-systems/toss], 실측과 대조 |
| 칩 | TDS Mobile에 칩 컴포넌트 문서 없음(주소 404) | [웹: https://tossmini-docs.toss.im/tds-mobile/components/chip/] |

### 8.3 웹 대시보드로 옮기는 판단

- TDS Mobile은 손가락 기준이라 기본 버튼이 56이다. 대시보드는 표·필터·폼이 한 화면에 빽빽하다. **PC 기본(md)은 높이 40을 유지**하고(입력칸·필터 줄 정렬이 모두 40 기준), 모양(모서리·굵기·글자·채움)은 TDS 비율을 따른다 [추론].
- 56(TDS xlarge, box 입력칸)은 **공개 화면(인플루언서 휴대폰) 주 동작용 단계로 따로 둔다**: Button `xl`, 입력칸 `lg`.
- 모서리는 TDS가 높이에 따라 커진다(32→8, 38→10, 48→14, 56→16). 이 규칙을 그대로 크기별 토큰으로 만든다.
- 휴대폰에서 버튼을 알약(radius-full)으로 바꾸던 규칙은 뺀다. TDS는 휴대폰에서도 알약 버튼을 쓰지 않는다 [실측].
- 입력칸은 TDS처럼 **채움형**(옅은 면, 그림자 없음)으로 바꾼다. 다만 테두리는 docs/13의 3:1 대비 규칙(`--border-control`) 때문에 진한 테두리를 유지한다. TDS의 아주 옅은 테두리는 WCAG 1.4.11(입력칸 경계 3:1)을 못 맞춘다 [추론].
- 포커스: TDS box는 커서 색만 바뀌지만 키보드로 쓰는 PC 대시보드에서는 포커스 위치가 보여야 한다(WCAG 2.4.7). 링 모양만 TDS식 이중 링(1px 진한 선 + 3px 옅은 번짐)으로 바꾼다 [추론].
- 글자: TDS 15(t6)를 PC 컨트롤 기본 글자로, 13(t7)을 작은 컨트롤·라벨·도움말로, 17(t5)을 큰 컨트롤로 쓴다. 본문 글자(14) 자체는 이번 범위가 아니라 그대로 [추론].
- 굵기: TDS 버튼·고른 탭·배지는 600~700이다. 우리 굵기 토큰에 700(`--weight-bold`)을 추가한다.

### 8.4 컴포넌트별 지금 값과 바꿀 값

| 컴포넌트 | TDS | 우리 지금 | 바꿀 값 | 이유 |
|-|-|-|-|-|
| Button sm | 32 / 10 / 13px 600 / r8 | 32 / 12 / 13px 500 / r10 | 32 / 12 / 13px **600** / **r8** | TDS small. 좌우 10은 간격 토큰에 없어 12 [추론] |
| Button md | 38 / 16 / 15px 600 / r10 | 40 / 16 / 14px 500 / r10 | 40 / 16 / **15px 600** / r10 | 높이만 PC 정렬 때문에 40 유지 |
| Button lg (새) | 48 / 16 / 17px 600 / r14 | 없음 | 48 / 20 / 17px 600 / r14 | 공개 화면 보조 동작. 좌우 20은 글자 17에 맞춰 [추론] |
| Button xl (새) | 56 / 28 / 17px 600 / r16 | 없음 | 56 / 24 / 17px 600 / r16 | 공개 화면 아래 주 동작. 28은 토큰에 없어 24 [추론] |
| Button 눌림 | scale(0.96) | translateY(1px) | scale(0.96), 0.1s | TDS 눌림 |
| Button 휴대폰 | 알약 아님 | radius-full(알약) | 크기별 모서리 그대로 | TDS 실측 |
| 입력칸 md | 56 / 14·16 / 17px / r14 / 채움 | 40 / 0·12 / 14px / r10 / 흰 면 + 그림자 | 40 / 0·16 / **15px** / r10 / **채움(surface-subtle), 그림자 없음** | 높이는 PC 정렬, 모양은 TDS |
| 입력칸 sm | 없음 | 32 / 13px / r10 | 32 / 13px / **r8** | 버튼 sm과 같은 모서리 |
| 입력칸 lg | box 56 | 48 / 16px / r10 | **56** / **17px** / **r14** | TDS box 그대로(공개 화면 주 입력) |
| 입력칸 포커스 | 커서 색만 | 진한 테두리 + 3px 옅은 링 | 진한 테두리 + 흰 면 + 이중 링 | 키보드 포커스 보이기 [추론] |
| 입력칸 비활성 | 한 단계 진한 면 | surface-subtle | **surface-muted** | 채움형 기본 면(subtle)과 구분 |
| 라벨 | 13px 400, 6px | 13px 500, 6px | 13px **400**, 색 **secondary**, 6px | TDS |
| 도움말·오류 | 13px, 6px | 12px, 6px | **13px**/20 | TDS |
| Checkbox·Radio | 24 | 18 | **20** | PC는 24가 표 줄 높이(40)에 비해 큼. 사이값 [추론] |
| Switch | 50×30, 손잡이 24 | 36×20, 16 | **40×24, 20** | TDS 비율(5:3)에 가깝게 PC 크기로 [추론] |
| Segmented | 홈 r14 안쪽 4, 칸 r10, 600/500 | 홈 r10 안쪽 2, 칸 r8, 500 | 홈 r10 안쪽 **4**, 칸 r**6**(홈 r - 안쪽), 고름 **600** / 안 고름 500, md 15px | 높이 40 안에서 TDS 비율 |
| ChoiceChips | 문서 없음 | 32 / 0·16 / 13px 500 / 알약 | 32 / 0·**14** / 13px 500 / 알약, 고름 600 | 칩은 TDS에 없어 버튼 sm 글자 규칙만 맞춤 [추론] |
| Badge | small 24 / 12px 700 / r11, medium 26 / 13px 700 | 20 / 12px 500 / 알약 | **24** / 12px **600** / 알약 / 안쪽 0·8 | TDS small. 700은 표 안에서 무거워 600 [추론] |
| ListRow | 12·24 / 사이 16 / 제목 17 500 / 부제 15 / 눌림 r12 | 12·0 / 12 / 14 500 / 12 / r6 | 12·(누를 때 16) / **16** / 제목 **15** 500 / 부제 **13** / 눌림 **r12** | 글자는 t5·t6 대신 한 단계 작은 t6·t7 [추론] |
| Tabs | 47 / 12·14 / 17px 700·600 | 40 / 8·12 / 14px 500 | 높이 **44** / 위 **10** 아래 **12** · 좌우 **8** / **15px**, 고름 **700**, 안 고름 **600** | PC 글자 한 단계 작게 |
| Drawer bottom | r28, 손잡이 자리 16 | r16, 손잡이 없음 | **r28**(위 모서리) + **손잡이**(36×4, 위 여백 8) | TDS. 떠 있는 모양은 뺌(공개 화면 폭이 좁아 좌우 여백 손해) [추론] |
| Modal | r24, 안쪽 22, 제목 20/700 | r16, 안쪽 24 | **r24**, 안쪽 24, 휴대폰 시트도 **r28** | TDS Dialog. 22는 토큰에 없어 24 |
| Toast | 알약, 12·16, 15px 600 | r12, 8·16, 13px 500 | **알약**, **12·20**, **15px 600** | TDS |
| Tooltip | 수치 없음 | r6, 6·8, 12px | **r8**, 6·**10**, **13px** | 글자 t7, 모서리는 작은 컨트롤 r8과 같게 [추론] |
| 포커스 링 | 1px + 3px 이중 | 3px 한 겹 | `0 0 0 1px` 진한 선 + `0 0 0 4px` 옅은 번짐 | 색은 기존 그대로, 모양만 [웹: oh-my-design 재인용] |
| 모션 | 0.1s ease-in-out(Dialog 버튼) | 150ms ease-out | 눌림 전용 `--duration-press: 100ms`, `--ease-in-out` 추가 | 나머지 전환은 그대로 |

### 8.5 한계

- 문서 예시 실측은 그 시점 문서 사이트에 실린 TDS 버전 값이다. 버전이 바뀌면 달라질 수 있다.
- Tooltip, TextField 오류 모양, Bottom Sheet 손잡이 크기는 예시가 hover·입력·애니메이션 뒤에만 보여 재지 못했다 [추론으로 정함].
- TDS 웹(PC)용 수치는 공개 자료에서 찾지 못했다. PC 단계(md 40)는 모두 우리 판단이다 [추론].
