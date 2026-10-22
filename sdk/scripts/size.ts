import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

// 브랜드 사이트 성능 예산: gzip 10KB 이하, 넘으면 빌드 실패 (docs/14 8-4)
const LIMIT_BYTES = 10 * 1024;
const file = new URL("../../public/sdk/v1.js", import.meta.url);
const raw = readFileSync(file);
const gzipped = gzipSync(raw, { level: 9 }).length;
console.log(`sdk v1.js: raw ${raw.length} B, gzip ${gzipped} B (limit ${LIMIT_BYTES} B)`);
if (gzipped > LIMIT_BYTES) {
  console.error("SDK bundle exceeds the 10KB gzip budget");
  process.exit(1);
}
