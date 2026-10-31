export const SHEETS_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const SHEETS_TOKEN_URL = "https://oauth2.googleapis.com/token";
const TIMEOUT_MS = 10_000;

// 오류 본문에는 토큰·사용자 자료가 들어갈 수 있으므로 저장하거나 로그로 남기지 않는다.
export class SheetsProviderError extends Error {
  constructor(public code: string, public uncertain = false) { super(code); }
}
export type SheetsTokens = { accessToken: string; refreshToken?: string; expiresIn: number; scope: string };

export function validSheetsScope(scope: string): boolean {
  const scopes = scope.trim().split(/\s+/);
  return scopes.length === 1 && scopes[0] === SHEETS_SCOPE;
}
export async function sheetsFetch(url: string, init: RequestInit): Promise<Response> {
  // Workers rejects redirect:error before sending. manual keeps credentials at
  // the intended provider; every caller rejects the returned non-2xx response.
  return fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
}

export async function requestSheetsTokens(params: URLSearchParams, previousScope?: string): Promise<SheetsTokens> {
  let response: Response;
  try { response = await sheetsFetch(SHEETS_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params }); }
  catch { throw new SheetsProviderError("google_unavailable"); }
  if (!response.ok) throw new SheetsProviderError(response.status === 400 || response.status === 401 ? "reconnect_required" : "google_unavailable");
  let body: Record<string, unknown>;
  try { body = await response.json(); } catch { throw new SheetsProviderError("google_invalid_response"); }
  const scope = typeof body.scope === "string" ? body.scope : previousScope ?? "";
  if (!validSheetsScope(scope)) throw new SheetsProviderError("scope_not_granted");
  if (typeof body.access_token !== "string" || !body.access_token || String(body.token_type).toLowerCase() !== "bearer" || typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in) || body.expires_in <= 0 || body.expires_in > 86_400) throw new SheetsProviderError("google_invalid_response");
  return { accessToken: body.access_token, refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : undefined, expiresIn: body.expires_in, scope };
}

export async function sheetsAccountEmail(accessToken: string): Promise<string> {
  const response = await sheetsFetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new SheetsProviderError("google_account_unavailable");
  const body = await response.json() as { user?: { emailAddress?: unknown } };
  if (typeof body.user?.emailAddress !== "string" || !body.user.emailAddress.includes("@") || body.user.emailAddress.length > 320) throw new SheetsProviderError("google_account_unavailable");
  return body.user.emailAddress;
}

// Google Workspace 파일은 pre-generated ID를 지원하지 않는다. 불명확한 create 실패는 절대 자동 재시도하지 않는다.
// https://developers.google.com/workspace/drive/api/guides/manage-uploads#use_a_pre-generated_id_to_upload_files
export async function createExportSpreadsheet(accessToken: string, title: string, rows: number, columns: number): Promise<string> {
  let response: Response;
  try {
    response = await sheetsFetch("https://sheets.googleapis.com/v4/spreadsheets?fields=spreadsheetId", {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ properties: { title }, sheets: [{ properties: { title: "내보내기", gridProperties: { rowCount: Math.max(1, rows), columnCount: columns } } }] }),
    });
  } catch { throw new SheetsProviderError("create_unknown", true); }
  if (!response.ok) throw new SheetsProviderError(response.status === 401 ? "reconnect_required" : "google_create_failed", response.status >= 500 || response.status >= 300 && response.status < 400 || response.status === 408 || response.status === 429);
  try {
    const body = await response.json() as { spreadsheetId?: unknown };
    if (typeof body.spreadsheetId === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(body.spreadsheetId)) return body.spreadsheetId;
  } catch { /* 응답을 잃었을 수 있으므로 생성 여부는 확정할 수 없다. */ }
  throw new SheetsProviderError("create_unknown", true);
}

export type SheetsValues = (string | number)[][];
export async function writeExportSpreadsheet(accessToken: string, id: string, values: SheetsValues): Promise<void> {
  let response: Response;
  try {
    response = await sheetsFetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent("'내보내기'!A1")}?valueInputOption=RAW&includeValuesInResponse=false`, {
      method: "PUT", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ range: "'내보내기'!A1", majorDimension: "ROWS", values }),
    });
  } catch { throw new SheetsProviderError("write_failed"); }
  if (!response.ok) throw new SheetsProviderError(response.status === 401 ? "reconnect_required" : "write_failed");
}
