import type { DestinationType, DocJson, DocumentGate, DocumentSourceType, OgCard, Utm, AfterSubmit, FormFields } from "../../../shared/leads";

// pdfjs 는 무거워서(약 400KB) 자료를 열거나 올릴 때만 불러온다
export async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

export type Channel = { id: string; key: string; name: string; sort: number };
export type DocumentViewStats = { clicks: number; measuredClicks: number; views: number; uniqueViews: number; reViews: number; unattributedViews: number };
export type DocumentSourceStats = DocumentViewStats & { linkId: string | null; channelKey: string | null; influencerName: string | null; completed: number };
// site*: 웹 SDK 사이트 집계(구성원 제외). visited·scroll50·converted 는 '방문이 생긴 클릭 ID' 수
export type LinkStats = DocumentViewStats & { unique: number; leads: number; siteSessions: number; siteVisited: number; siteScroll50: number; siteConverted: number; siteConversions: number; siteConversionValue: number };
export type LinkRow = {
  id: string;
  slug: string;
  url: string;
  guideId: string | null;
  guideName: string | null;
  influencerId: string | null;
  influencerName: string | null;
  channelKey: string;
  // null 이면 칸의 기본 링크, 값이 있으면 콘텐츠별 링크(c2, c3 ...)
  contentKey: string | null;
  contentLabel: string | null;
  destinationType: DestinationType;
  destinationId: string | null;
  destinationUrl: string | null;
  utm: Utm;
  og: OgCard;
  createdAt: number;
  stats: LinkStats;
};
export type DocumentRow = {
  id: string;
  guideId: string | null;
  title: string;
  pages: number;
  sizeMb: number;
  allowDownload: boolean;
  gate: DocumentGate;
  sourceType: DocumentSourceType;
  sourceUrl: string | null;
  fetchedHtmlKey: string | null;
  fetchedAt: number | null;
  createdAt: number;
  stats: DocumentViewStats & { completed: number; leads: number };
};
export type DocumentDetail = Omit<DocumentRow, "stats"> & { contentJson: DocJson | null; contentHtml: string | null };
export type FormRow = {
  id: string;
  guideId: string | null;
  title: string;
  description: string;
  headerImageKey: string | null;
  fields: FormFields;
  closesAt: number | null;
  maxSubmissions: number | null;
  closedMessage: string;
  afterSubmit: AfterSubmit;
  createdAt: number;
  submissions: number;
};

export const gateLabel = (g: DocumentGate) => (g.position === "none" ? "없음" : g.scrollPct === 0 ? "열자마자" : `${g.scrollPct}% 읽은 뒤`);
export const docSize = (d: Pick<DocumentRow, "sourceType" | "pages" | "sizeMb" | "sourceUrl" | "fetchedHtmlKey">) =>
  d.sourceType === "pdf" ? `${d.pages}페이지 · ${d.sizeMb}MB` : d.sourceType === "url" ? `${d.sourceUrl ?? ""}${d.fetchedHtmlKey ? "" : " (불러오지 못함)"}` : "본문 직접 작성";

export const ZERO_HINT = "리드 링크를 인플루언서에게 보내면 쌓여요";
export const pct = (n: number) => `${Math.round(n * 100)}%`;
export const countText = (n: number) => n.toLocaleString("ko-KR");
export const documentViewRate = ({ uniqueViews, measuredClicks }: Pick<DocumentViewStats, "uniqueViews" | "measuredClicks">) => measuredClicks > 0 ? pct(uniqueViews / measuredClicks) : "-";
export const VIEW_METRICS_HELP = {
  views: "새 기록은 실제 자료 화면을 연 뒤 집계해요. 과거 기록에는 열림 여부를 확인할 수 없는 폼 예약 기록이 포함될 수 있어요.",
  clicks: "봇과 로그인한 팀원의 클릭을 제외한 전체 클릭이에요.",
  measuredClicks: "자료 열람을 연결할 수 있는 클릭이에요. 연결 정보를 확인할 수 없는 이전 클릭은 제외해요.",
  uniqueViews: "자료를 연 링크 클릭 수예요. 같은 클릭으로 여러 번 열어도 한 번만 세며, 사람 수와는 달라요.",
  reViews: "같은 자료를 같은 브라우저로 다시 연 횟수의 추정값이에요. 클릭 기준 고유 열람과는 별도 지표예요.",
  unattributedViews: "직접 방문이나 과거 기록처럼 클릭에 연결하지 못한 기록이에요. 열람률에서 제외해요.",
  rate: "고유 열람을 측정 가능한 클릭으로 나눈 비율이에요. 측정 가능한 클릭이 없으면 -로 표시해요.",
};
export const documentStatsText = (stats: DocumentRow["stats"]) => stats.views || stats.clicks
  ? `전체 열람 ${countText(stats.views)} · 고유 열람(클릭) ${countText(stats.uniqueViews)} · 재열람(브라우저 추정) ${countText(stats.reViews)} · 미연결 열람 ${countText(stats.unattributedViews)} · 열람률 ${documentViewRate(stats)} · 완독 ${countText(stats.completed)} · 리드 ${countText(stats.leads)}`
  : ZERO_HINT;
export const seconds = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}분 ${Math.round((ms % 60_000) / 1000)}초` : `${Math.round(ms / 1000)}초`);
export const dateTime = (ms: number | null | undefined) =>
  ms ? new Date(ms).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
export const randomId = () => Math.random().toString(36).slice(2, 10);

// PDF 페이지 수는 클라이언트가 읽어서 서버에 넘긴다
export async function uploadPdf(file: File, guideId?: string): Promise<DocumentRow> {
  if (file.size > 50 * 1024 * 1024) throw new Error("50MB 이하 PDF만 올릴 수 있어요.");
  const buf = await file.arrayBuffer();
  const pdf = await (await loadPdfjs()).getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
  const params = new URLSearchParams({ title: file.name.replace(/\.pdf$/i, ""), pages: String(pdf.numPages) });
  if (guideId) params.set("guideId", guideId);
  const res = await fetch(`/api/documents?${params}`, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: buf, credentials: "same-origin" });
  const data: { document?: DocumentRow; error?: { message: string } } = await res.json();
  if (!res.ok || !data.document) throw new Error(data.error?.message ?? "업로드하지 못했어요.");
  return { ...data.document, stats: { clicks: 0, measuredClicks: 0, views: 0, uniqueViews: 0, reViews: 0, unattributedViews: 0, completed: 0, leads: 0 } };
}

export async function uploadImage(file: File): Promise<{ key: string; url: string }> {
  const res = await fetch("/api/links/assets", { method: "POST", headers: { "Content-Type": file.type }, body: file, credentials: "same-origin" });
  const data: { key?: string; url?: string; error?: { message: string } } = await res.json();
  if (!res.ok || !data.key || !data.url) throw new Error(data.error?.message ?? "이미지를 올리지 못했어요.");
  return { key: data.key, url: data.url };
}
