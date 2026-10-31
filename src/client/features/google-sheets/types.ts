export type SheetsKind = "leads" | "performance";
export type SheetsConnection = { configured: boolean; connected: boolean; generation: string | null; csrfToken: string | null; maxRows: number; accountEmail?: string | null };
export type SheetsJob = {
  id: string;
  status: "prepared" | "creating" | "writing" | "done" | "failed" | "unknown" | "cancelled";
  spreadsheetUrl?: string;
  rows: number;
  retryable?: boolean;
  errorCode?: string;
};

export const sheetsFileUrl = (raw: string | undefined) => {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === "docs.google.com" && !url.username && !url.password && (!url.port || url.port === "443") && /^\/spreadsheets\/d\/[\w-]+(?:\/|$)/.test(url.pathname) ? url.href : null;
  } catch { return null; }
};
