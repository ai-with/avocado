// RFC 4180 수준의 작은 CSV 파서. 따옴표 안의 쉼표·줄바꿈·"" 이스케이프를 처리한다
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(cell), (cell = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// 엑셀이 한글을 깨뜨리지 않게 BOM 을 붙인다
export function toCsv(rows: (string | number | boolean | null)[][]): string {
  const esc = (v: string | number | boolean | null) => {
    const t = v === null ? "" : String(v);
    return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
}
