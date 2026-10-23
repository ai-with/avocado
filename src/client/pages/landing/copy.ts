// 랜딩 카피 v3. 원문: docs/16-pvc-landing-copy.md 3장 (구조는 docs/05-landing-copy.md v2). [서비스명]은 avocado 로 채웠다
// B10 증거는 G-Proof(파일럿 브랜드 동의 + 실측) 전까지 숨기는 섹션이라 넣지 않는다

export const BRAND = "avocado";
export const PAGE_TITLE = "avocado: 인플루언서 협업 검수·리드 도구";

export type Item = { title: string; body?: string };
export type FeatureSection = { id: string; title: string; sub: string; chips?: string[]; items: Item[]; note?: string };

export const NAV_ANCHORS = [
  { href: "#features", label: "기능" },
  { href: "#process", label: "진행 방식" },
  { href: "#faq", label: "FAQ" },
];

export const HERO = {
  badge: "첫 캠페인 1건 무료",
  // 줄바꿈 위치를 고정한다(.landing-display가 pre-line). 근거: docs/16 3장 히어로
  title: "해외 인플루언서 영상,\n고칠 장면만 보면 됩니다",
  sub: "영상은 링크 하나로 받습니다. 영어 대사는 한국어 번역과 나란히 봅니다.",
  primary: "무료 파일럿 신청",
  secondary: "로그인",
  checks: ["인플루언서는 가입하지 않아도 됩니다", "수정 요청은 장면 위에 바로 씁니다", "보내는 건 직접 고른 것만 나갑니다"],
};

// 히어로 오른쪽 검수 화면 목업. 값은 전부 예시
export const HERO_MOCK = {
  candidates: [
    { time: "00:14", label: "위반 후보: 금지 표현", tone: "danger" as const },
    { time: "00:03", label: "준수: 첫 3초 제품 노출", tone: "success" as const },
  ],
  line: "This serum made my skin glow in just a week.",
  translation: "이 세럼 덕분에 일주일 만에 피부가 빛나요.",
};

export const PROBLEM = {
  title: "영상은 드라이브로, 수정은 PDF로",
  items: [
    { title: "영상이 메일 속 링크로 옵니다", body: "사람마다 내려받고 최신본을 따로 챙깁니다." },
    { title: "수정 요청을 캡처해 PDF로 묶습니다", body: "장면마다 캡처하고 설명을 답니다. 두세 번은 기본입니다." },
    { title: "영어 대사를 하나하나 확인합니다", body: "가이드대로 말했는지 직접 돌려 봅니다." },
  ] satisfies Item[],
};

// 기능은 고객 흐름 4블록: 보내기 → 받기 → 고치기 → 올린 뒤 (docs/16 2장 행 번호가 근거)
export const FEATURES: FeatureSection[] = [
  {
    id: "guide",
    title: "가이드는 링크 하나만 보내면 됩니다",
    sub: "규정을 한 번 적으면 가이드 초안이 나옵니다. 인플루언서마다 다른 링크로 보냅니다.",
    chips: ["필수 문구", "금지 표현", "필수 장면", "광고 표기", "길이·비율", "말하는 언어"],
    items: [
      { title: "같은 안내를 복붙하지 않아도 됩니다", body: "링크만 보내면 휴대폰에서 바로 열립니다." },
      { title: "누가 열어 봤는지 보입니다", body: "인플루언서별로 열람 여부가 표시됩니다." },
      { title: "가이드 번역은 따로 안 해도 됩니다", body: "영어로 먼저 열리고, 한국어로도 바뀝니다." },
    ],
    note: "광고 표기 규칙은 기본으로 켜져 있습니다.",
  },
  {
    id: "review",
    title: "영상 열기 전에 고칠 장면부터 봅니다",
    sub: "인플루언서는 링크에서 바로 올립니다. 올라오면 자막과 확인할 장면이 먼저 준비됩니다.",
    chips: ["위반 후보", "확인 필요", "준수", "판단 불가"],
    items: [
      { title: "드라이브 링크를 안 기다려도 됩니다", body: "완성본과 클린본이 인플루언서별로 모입니다." },
      { title: "영어 대사, 한국어로 나란히 읽습니다", body: "문장을 누르면 그 장면으로 갑니다. 재편집용 대본도 받습니다." },
      { title: "가이드와 다른 장면부터 짚어 줍니다", body: "근거 장면과 대사가 함께 붙습니다." },
    ],
    note: "원본과 클린본은 그대로 보관합니다. 파일당 2GB, 3분 이하 영상을 받습니다.",
  },
  {
    id: "feedback",
    title: "캡처해서 PDF로 묶지 않아도 됩니다",
    sub: "장면 위에 표시하고 한국어로 쓰면 됩니다. 영어로 바꿔 전달합니다.",
    items: [
      { title: "장면 위에 바로 그립니다", body: "박스와 화살표를 그리면 시간이 붙습니다." },
      { title: "무엇이 남았는지 한눈에 봅니다", body: "인플루언서가 항목마다 반영 여부를 표시합니다." },
      { title: "고친 영상은 나란히 비교합니다", body: "지난 피드백이 반영됐는지 한 화면에서 봅니다." },
    ],
    note: "보내기를 눌러야 나갑니다. 고른 장면은 후보일 뿐, 보낼지는 직접 정합니다.",
  },
  {
    id: "links",
    title: "게시 뒤 반응도 한 표로 모입니다",
    sub: "인플루언서마다 다른 링크가 자동으로 생깁니다. 누구 영상에서 몇 명이 왔는지 나눠 봅니다.",
    items: [
      { title: "게시물을 일일이 안 열어도 됩니다", body: "게시 후 24시간·3일·7일 지표가 표에 쌓입니다." },
      { title: "어디서 사람이 빠지는지 봅니다", body: "클릭, 자료 열람, 신청을 단계별로 셉니다." },
      { title: "신청한 사람에게 안내가 바로 갑니다", body: "폼을 내면 안내 메일이 자동으로 나갑니다." },
    ],
    note: "저장·공유와 댓글 자동 답장은 연결 승인 뒤 켜집니다. 못 받은 값은 0이 아니라 빈칸으로 둡니다.",
  },
];

export const PROCESS = {
  title: "첫 캠페인은 무료로 함께 시작합니다",
  steps: [
    { title: "파일럿 신청", body: "다음 캠페인 정보를 남기면 연락드립니다." },
    { title: "규정 옮기기", body: "브랜드 가이드라인을 함께 규칙으로 옮깁니다." },
    { title: "링크 보내기", body: "인플루언서마다 가이드 링크를 보냅니다." },
    { title: "검수하고 승인하기", body: "짚어 준 장면을 보고 피드백을 보냅니다." },
    { title: "결과 함께 보기", body: "수정 횟수와 걸린 시간을 보고 다음 방식을 정합니다." },
  ] satisfies Item[],
};

export const FAQ = {
  title: "파일럿 전에 많이 묻는 것들",
  items: [
    { q: "인플루언서도 가입해야 하나요?", a: "아니요. 받은 링크에서 보고, 동의하고, 올리면 끝입니다." },
    { q: "알아서 고른 장면, 믿어도 되나요?", a: "고른 장면은 후보일 뿐입니다. 보낼지는 직접 정합니다." },
    { q: "원본 영상이 망가지진 않나요?", a: "원본과 클린본은 그대로 보관합니다. 검수용 사본만 따로 만듭니다." },
    { q: "섭외나 대금 지급도 해 주나요?", a: "지금은 하지 않습니다. 함께하기로 한 인플루언서와의 가이드와 검수를 돕습니다." },
    { q: "파일럿 끝나면 얼마예요?", a: "첫 캠페인 1건은 무료입니다. 이용 방식은 파일럿이 끝난 뒤 안내드립니다." },
  ],
};

export const FINAL_CTA = {
  title: "다음 시딩은 고칠 장면만 보세요",
  note: "첫 캠페인 1건은 무료입니다. 비용은 이용 방식을 고른 뒤에만 생깁니다.",
};

export const FOOTER_LINKS = [
  { to: "/login", label: "로그인" },
  { to: "/signup", label: "가입" },
];
export const FOOTER_PLACEHOLDERS = ["문의 이메일", "이용약관", "개인정보 처리방침"];

// 인증 화면 오른쪽 카드. B10 증거가 아직 없어(G-Proof) 추천사 대신 일반 문장, 숫자는 카피에 이미 있는 사실만
export const AUTH_ASIDE = {
  quote: "가이드부터 검수, 리드까지 한 곳에서",
  quoteSub: "인플루언서별 링크 하나로 가이드를 보내고, 영상을 받고, 장면 위에서 고칩니다.",
  stats: [
    { value: "1건", label: "무료 첫 캠페인" },
    { value: "0단계", label: "인플루언서 가입" },
    { value: "2GB", label: "파일당 업로드" },
  ],
  logosLabel: "이런 브랜드가 씁니다",
  logosPlaceholder: "파일럿 브랜드 동의 후 공개",
};
