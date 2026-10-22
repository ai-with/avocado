// 휴대폰 번호를 E.164(+국가번호...)로 바꾼다. 0으로 시작하면 한국 번호로 본다. 형식이 틀리면 null
export function normalizePhone(input: string): string | null {
  const raw = input.trim().replace(/[\s().-]/g, "");
  let e164: string;
  if (raw.startsWith("+")) e164 = raw.startsWith("+820") ? `+82${raw.slice(4)}` : raw;
  else if (raw.startsWith("0")) e164 = `+82${raw.slice(1)}`;
  else return null;
  if (e164.startsWith("+82")) return /^\+821[016789]\d{7,8}$/.test(e164) ? e164 : null; // 한국은 휴대폰(01X)만
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

// 화면 표시용. 한국 번호는 010-****-5678, 그 밖은 끝 4자리만
export function maskPhone(e164: string): string {
  if (e164.startsWith("+82")) {
    const local = `0${e164.slice(3)}`;
    return `${local.slice(0, 3)}-****-${local.slice(-4)}`;
  }
  return `${e164.slice(0, 3)} ****${e164.slice(-4)}`;
}

// SMS 발송용 국내 표기 (+821012345678 -> 01012345678)
export const toKrLocal = (e164: string) => (e164.startsWith("+82") ? `0${e164.slice(3)}` : e164.slice(1));

export const CODE_TTL_MS = 5 * 60 * 1000;
export const MAX_ATTEMPTS = 5;

export function newCode(): string {
  return String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, "0");
}

type CodeRow = { attempts: number; expiresAt: number; verifiedAt: number | null; codeHash: string };
export type CodeVerdict = "ok" | "used" | "expired" | "too_many" | "mismatch";

// 시도 횟수 증가 전 상태로 판정한다. mismatch 면 호출자가 attempts 를 1 올린다
export function judgeCode(row: CodeRow, codeHash: string, at: number): CodeVerdict {
  if (row.verifiedAt) return "used";
  if (row.attempts >= MAX_ATTEMPTS) return "too_many";
  if (row.expiresAt < at) return "expired";
  return row.codeHash === codeHash ? "ok" : "mismatch";
}
