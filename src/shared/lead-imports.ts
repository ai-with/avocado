export const IMPORT_CHUNK_ROWS = 100;
export const IMPORT_BODY_BYTES = 256 * 1024;
export const IMPORT_FILE_BYTES = 16 * 1024 * 1024;
export const IMPORT_TTL_MS = 24 * 60 * 60 * 1000;
export type ImportRow = { email: string; name?: string; company?: string; phone?: string; marketing_opt_in?: string };
export type ImportJob = { id: string; generation: string; fingerprint: string; status: "active" | "completed" | "cancelled" | "blocked" | "expired"; totalRows: number; nextChunk: number; processed: number; imported: number; invalid: number; skipped: number; expiresAt: number };
export type ImportReceipt = { chunkNo: number; imported: number; invalid: number[]; skipped: number[]; job: ImportJob };
export type ImportContext = { scope: string; csrfToken: string; serverTime: number };
