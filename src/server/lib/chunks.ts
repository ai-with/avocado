// D1은 쿼리 하나에 바인딩이 100개까지라, IN 조건 배열을 나눠 조회한다
export const IN_CHUNK_SIZE = 90; // 다른 조건의 바인딩 여유를 남긴다

export async function selectInChunks<T, R>(ids: readonly T[], run: (part: T[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) out.push(...(await run(ids.slice(i, i + IN_CHUNK_SIZE))));
  return out;
}
