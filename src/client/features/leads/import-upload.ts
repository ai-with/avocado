import { ApiError } from "../../lib/api";
import { parseCsv } from "../../../shared/csv";
import { IMPORT_CHUNK_ROWS, IMPORT_FILE_BYTES, type ImportContext, type ImportJob, type ImportReceipt, type ImportRow } from "../../../shared/lead-imports";

export const IMPORT_COLUMNS = [
  { key: "email", label: "이메일 (필수)", guess: /e-?mail|이메일|메일/i },
  { key: "name", label: "이름", guess: /name|이름|성명/i },
  { key: "company", label: "소속", guess: /company|소속|회사/i },
  { key: "phone", label: "전화번호", guess: /phone|tel|전화|연락처|휴대/i },
  { key: "marketing_opt_in", label: "마케팅 동의", guess: /marketing|opt|동의|수신/i },
] as const;
export type ColumnMap = Record<typeof IMPORT_COLUMNS[number]["key"], number>;
export const UNMAPPED: ColumnMap = { email: -1, name: -1, company: -1, phone: -1, marketing_opt_in: -1 };
type Intent = { version: 1; requestId: string; requestedAt: number };
export type SelectedImport = { rows: string[][]; fileHash: string };
const hash = async (value: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", value as Uint8Array<ArrayBuffer>))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
export async function readImportFile(file: File): Promise<SelectedImport> {
  if (file.size > IMPORT_FILE_BYTES) throw new Error("파일이 커요. 16MB 이하 CSV로 나눠 주세요.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error("UTF-8 CSV 파일을 선택해 주세요."); }
  if (text.includes("\0")) throw new Error("CSV 파일 내용을 확인해 주세요.");
  let quoted = false;
  for (let i = 0; i < text.length; i++) if (text[i] === '"') { if (quoted && text[i + 1] === '"') i++; else quoted = !quoted; }
  if (quoted) throw new Error("CSV의 닫히지 않은 따옴표를 확인해 주세요.");
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("제목과 연락처 행이 있는 CSV를 선택해 주세요.");
  return { rows, fileHash: await hash(bytes) };
}
export function mappedRows(rows: string[][], map: ColumnMap): ImportRow[] {
  return rows.slice(1).map((row) => Object.fromEntries(IMPORT_COLUMNS.filter((column) => map[column.key] >= 0).map((column) => [column.key, row[map[column.key]] ?? ""])) as ImportRow);
}
export async function fileFingerprint(selected: SelectedImport, map: ColumnMap) {
  return hash(new TextEncoder().encode(JSON.stringify([1, selected.fileHash, IMPORT_COLUMNS.map(({ key }) => map[key]), selected.rows.length - 1])));
}
async function request<T>(path: string, method = "GET", body?: unknown, csrf?: string): Promise<T> {
  let response: Response;
  try { response = await fetch("/api/leads/import" + path, { method, credentials: "same-origin", signal: AbortSignal.timeout(15_000), headers: body === undefined ? undefined : { "Content-Type": "application/json", "X-CSRF-Token": csrf ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new ApiError(503, "import_unconfirmed", "완료 응답을 확인하지 못했어요. 같은 파일을 다시 선택하면 완료된 묶음부터 확인해요."); }
  const data = await response.json().catch(() => null) as { error?: { code: string; message: string } } | null;
  if (!response.ok) throw new ApiError(response.status, data?.error?.code ?? "import_unconfirmed", data?.error?.message ?? "가져오기 상태를 확인하지 못했어요.");
  if (!data) throw new ApiError(503, "import_unconfirmed", "완료 응답을 확인하지 못했어요. 같은 파일로 다시 확인해 주세요.");
  return data as T;
}
export const getImportContext = () => request<ImportContext>("/context");
export const getExistingImport = (id: string) => request<ImportJob>("/jobs/" + id);
function intentFor(context: ImportContext, fingerprint: string, fresh: boolean): Intent {
  const key = "lead-import:" + context.scope + ":" + fingerprint;
  try {
    const saved = localStorage.getItem(key);
    if (saved && !fresh) {
      const value = JSON.parse(saved) as Intent;
      if (value.version !== 1 || !/^[a-f0-9-]{36}$/.test(value.requestId) || !Number.isSafeInteger(value.requestedAt)) throw new Error();
      return value;
    }
    const value: Intent = { version: 1, requestId: crypto.randomUUID(), requestedAt: context.serverTime };
    localStorage.setItem(key, JSON.stringify(value)); return value;
  } catch { throw new Error("브라우저의 가져오기 기록을 저장하지 못했어요. 기록을 사용할 수 있는 브라우저에서 다시 열어 주세요."); }
}
export async function resolveImport(context: ImportContext, fingerprint: string, totalRows: number, consent: boolean, fresh = false): Promise<ImportJob> {
  if (!consent) throw new Error("수신 동의를 받은 연락처만 올린다는 확인이 필요해요.");
  const intent = intentFor(context, fingerprint, fresh);
  try {
    const job = await getExistingImport(intent.requestId);
    if (job.fingerprint !== fingerprint || job.totalRows !== totalRows) throw new Error("파일이나 열 매핑이 달라요. 원래 파일로 다시 확인해 주세요.");
    return job;
  } catch (error) { if (!(error instanceof ApiError) || error.status !== 404) throw error; }
  return request<ImportJob>("/jobs", "POST", { requestId: intent.requestId, requestedAt: intent.requestedAt, fingerprint, totalRows, consentConfirmed: true }, context.csrfToken);
}
export async function uploadImport(job: ImportJob, rows: ImportRow[], context: ImportContext, consent: boolean, onProgress: (value: ImportJob) => void, stopped: () => boolean): Promise<ImportJob> {
  if (!consent) throw new Error("수신 동의를 확인해 주세요.");
  if (job.status !== "active" && job.status !== "completed") throw new Error("이 작업은 이어서 가져올 수 없어요. 완료된 행을 확인하고 새 작업으로 시작해 주세요.");
  onProgress(job);
  while (job.status === "active" && !stopped()) {
    const chunkRows = rows.slice(job.nextChunk * IMPORT_CHUNK_ROWS, (job.nextChunk + 1) * IMPORT_CHUNK_ROWS);
    const response = await request<ImportReceipt>(`/jobs/${job.id}/chunks`, "POST", { generation: job.generation, chunkNo: job.nextChunk, rows: chunkRows, consentConfirmed: true }, context.csrfToken);
    if (response.chunkNo !== job.nextChunk || response.job?.id !== job.id || response.job.generation !== job.generation || response.job.totalRows !== job.totalRows || response.job.fingerprint !== job.fingerprint || response.job.nextChunk !== job.nextChunk + 1 || response.job.processed !== job.processed + chunkRows.length || !["active", "completed"].includes(response.job.status)) throw new ApiError(503, "import_unconfirmed", "완료된 묶음을 확인하지 못했어요. 같은 파일로 다시 확인해 주세요.");
    job = response.job; onProgress(job);
  }
  return job;
}
export const cancelImport = (job: ImportJob, context: ImportContext) => request<ImportJob>(`/jobs/${job.id}/cancel`, "POST", { generation: job.generation }, context.csrfToken);
