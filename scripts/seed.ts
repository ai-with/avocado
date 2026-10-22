// 로컬 데모 데이터. `npm run dev`가 떠 있는 상태에서 `npm run seed:local`로 돌린다
// DB에 직접 넣지 않고 앱 API를 그대로 불러서 토큰·링크·집계가 실제 흐름과 같게 만든다
// 개발 모드(.dev.vars 에 APP_ENV=development)여야 휴대폰 인증번호(devCode)를 응답으로 받는다
const BASE = process.env.SEED_BASE_URL ?? "http://localhost:5173";
const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "demo1234!";
// 실제로 쓰이지 않는 형식상 번호. 이미 다른 계정이 쓰면 가입 단계에서 멈춘다
const DEMO_PHONE = "010-0000-0001";

const INFLUENCERS = [
  { displayName: "달밤툰", igHandle: "dalbam_toon_demo" },
  { displayName: "출근길 컷툰", igHandle: "commute_cut_demo" },
  { displayName: "야근일기", igHandle: "overtime_diary_demo" },
];
const LEADS = [
  { email: "lead1@demo-company.co.kr", name: "김데모", marketingOptIn: true },
  { email: "lead2@demo-company.co.kr", name: "이데모", marketingOptIn: false },
  { email: "lead3@demo-startup.kr", name: "박데모", marketingOptIn: true },
  { email: "lead4@demo-startup.kr", name: "최데모", marketingOptIn: false },
  { email: "lead5@demo-agency.kr", name: "정데모", marketingOptIn: true },
];

type Json = Record<string, unknown>;
let cookie = "";

async function call<T>(method: string, path: string, body?: Json): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect: "manual",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sid = res.headers.getSetCookie().find((c) => c.startsWith("sid="));
  if (sid) cookie = sid.split(";")[0] ?? "";
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return (res.status === 204 ? {} : await res.json()) as T;
}

async function signupDemo() {
  await call("POST", "/api/auth/signup", { name: "데모 담당자", email: DEMO_EMAIL, password: DEMO_PASSWORD, workspaceName: "데모 브랜드" });
  const sent = await call<{ devCode?: string }>("POST", "/api/auth/phone/send", { phone: DEMO_PHONE });
  if (!sent.devCode) throw new Error("devCode 가 없어요. .dev.vars 에 APP_ENV=development 를 넣고 dev 서버를 다시 띄워 주세요.");
  await call("POST", "/api/auth/phone/verify", { phone: DEMO_PHONE, code: sent.devCode });
}

async function createGuide(): Promise<string> {
  const { set } = await call<{ set: { id: string } }>("POST", "/api/guideline-sets", { name: "기본 규정" });
  await call("POST", `/api/guideline-sets/${set.id}/rules`, { type: "forbidden_phrase", content: "무조건, 100% 보장", severity: "must", targets: ["speech", "caption"] });
  const { guide } = await call<{ guide: { id: string } }>("POST", "/api/guides", {
    name: "업무 자동화 툴 소개 인스타툰",
    guidelineSetId: set.id,
    product: { name: "데모 워크플로", benefits: ["반복 업무 줄이기"], usage: "팀 업무 보드에 연결", photos: [] },
    purpose: "직장인 독자에게 제품을 자연스럽게 알리는 인스타툰",
    lang: "ko",
    deliverables: { final: true, clean: false, note: "" },
  });
  // 초안 생성은 실패해도 빈 템플릿을 돌려주므로 결과를 그대로 저장한다
  const draft = await call<{ videoGuide: Json }>("POST", `/api/guides/${guide.id}/generate`);
  await call("PATCH", `/api/guides/${guide.id}`, { videoGuide: draft.videoGuide });
  await call("POST", `/api/guides/${guide.id}/publish`);
  for (const inf of INFLUENCERS) await call("POST", `/api/guides/${guide.id}/influencers`, { ...inf, email: "", lang: "ko", country: "KR" });
  return guide.id;
}

async function createLeads(guideId: string) {
  const { form } = await call<{ form: { id: string } }>("POST", "/api/forms", {
    title: "무료 체험 신청",
    guideId,
    fields: { base: [{ key: "name", enabled: true, required: true }, { key: "company", enabled: false, required: false }, { key: "phone", enabled: false, required: false }], questions: [] },
    afterSubmit: { type: "message", text: "신청해 주셔서 고마워요.", documentId: null },
  });
  await call("POST", `/api/guides/${guideId}/links/issue`, { destination: { type: "form", id: form.id }, target: "all", channelKeys: ["ig_bio"] });
  const { links } = await call<{ links: { slug: string; influencerName: string | null }[] }>("GET", `/api/guides/${guideId}/links`);
  const influencerLinks = links.filter((l) => l.influencerName);
  // 방문자는 로그인 쿠키 없이 들어온다 (팀원 클릭은 집계에서 빠지므로)
  const ownerCookie = cookie;
  cookie = "";
  for (const [i, lead] of LEADS.entries()) {
    const link = influencerLinks[i % influencerLinks.length]!;
    await fetch(`${BASE}/l/${link.slug}`, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 (iPhone) seed" } });
    await call("POST", `/api/public/form/${link.slug}/submit`, { ...lead, privacyAgreed: true });
  }
  cookie = ownerCookie;
  await call("POST", "/api/leads/groups", { name: "마케팅 동의자", rules: { all: [{ field: "marketing_opt_in", op: "eq", value: true }] } });
}

async function main() {
  try {
    await call("POST", "/api/auth/login", { email: DEMO_EMAIL, password: DEMO_PASSWORD });
    console.log(`이미 데모 계정이 있어요. ${BASE} 에서 ${DEMO_EMAIL} / ${DEMO_PASSWORD} 로 로그인하세요.`);
    return;
  } catch {
    // 계정이 없으면 새로 만든다
  }
  await signupDemo();
  const guideId = await createGuide();
  await createLeads(guideId);
  console.log(`데모 워크스페이스를 만들었어요. ${BASE} 에서 ${DEMO_EMAIL} / ${DEMO_PASSWORD} 로 로그인하세요.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
