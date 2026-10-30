// D1은 쿼리 하나에 바인딩이 100개까지라, IN 조건 배열을 나눠 조회한다
export const IN_CHUNK_SIZE = 90; // 다른 조건의 바인딩 여유를 남긴다

export async function selectInChunks<T, R>(ids: readonly T[], run: (part: T[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) out.push(...(await run(ids.slice(i, i + IN_CHUNK_SIZE))));
  return out;
}

// 여러 행 insert 도 같은 한도를 받는다. 행마다 바인딩이 columns 개라 한 문장에 넣을 행 수를 줄인다
export const D1_MAX_BINDINGS = 100;
export function chunkRows<T>(rows: readonly T[], columns: number): T[][] {
  const size = Math.max(1, Math.floor(D1_MAX_BINDINGS / columns));
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
