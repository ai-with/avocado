// 실제 SQLite에 D1 API를 연결해 SQL·FK·트리거·배치 롤백을 검증한다.
export type SqlValue = string | number | null;
export type SqlRow = Record<string, SqlValue>;
export type TestSqlite = {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): { run(...params: SqlValue[]): { changes: number }; all(...params: SqlValue[]): SqlRow[] };
};

// Node 23 SQLite는 같은 열 이름을 덮어쓰므로 Drizzle raw()의 열 이름을 서로 다르게 만든다.
function arraySql(sql: string): string {
  const start = /^\s*select\s+/i.exec(sql)?.[0].length;
  if (start === undefined) return sql;
  let quote = "", depth = 0, from = sql.length;
  const commas: number[] = [];
  for (let i = start; i < sql.length; i++) {
    const c = sql[i]!;
    if (quote) {
      if (c === quote) { if (sql[i + 1] === quote) i++; else quote = ""; }
    } else if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (!depth && c === ",") commas.push(i);
    else if (!depth && /^\sfrom\b/i.test(sql.slice(i))) { from = i; break; }
  }
  const cuts = [start - 1, ...commas.filter((n) => n < from), from];
  const fields = cuts.slice(1).map((end, i) => sql.slice(cuts[i]! + 1, end).trim());
  if (fields.some((field) => /(?:^|\.)\*$/.test(field))) return sql;
  return sql.slice(0, start) + fields.map((field, i) => `${field.replace(/\s+as\s+(?:"[^"]+"|`[^`]+`|\w+)\s*$/i, "")} AS "__d1_${i}"`).join(", ") + sql.slice(from);
}

export async function createSqliteD1(options: { migrateThrough?: number } = {}) {
  const sqlite = (await import("node:sqlite" as string)) as { DatabaseSync: new (path: string) => TestSqlite };
  const fs = (await import("node:fs" as string)) as { readdirSync(path: string): string[]; readFileSync(path: string, encoding: string): string };
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of fs.readdirSync("migrations").filter((f) => f.endsWith(".sql") && Number(f.slice(0, 4)) <= (options.migrateThrough ?? Infinity)).sort()) db.exec(fs.readFileSync(`migrations/${file}`, "utf8"));
  let serial = Promise.resolve();
  const atomic = <T>(work: () => T): Promise<T> => {
    const next = serial.then(work);
    serial = next.then(() => {}, () => {});
    return next;
  };
  const prepared = Symbol("test-d1-statement");
  type StatementData = { sql: string; params: SqlValue[] };
  const execute = ({ sql, params }: StatementData) => {
    const results = db.prepare(sql).all(...params);
    const changes = Number(db.prepare("SELECT changes() AS n").all()[0]?.n ?? 0);
    return { success: true, results, meta: { changes } };
  };
  const prepare = (sql: string, params: SqlValue[] = []): unknown => {
    const statement = { sql, params };
    const all = () => atomic(() => execute(statement));
    return {
      [prepared]: statement,
      bind: (...values: SqlValue[]) => prepare(sql, values),
      run: all,
      all,
      first: async (column?: string) => { const row = (await all()).results[0]; return column ? row?.[column] ?? null : row ?? null; },
      raw: () => atomic(() => db.prepare(arraySql(sql)).all(...params).map((row) => Object.values(row))),
    };
  };
  const d1 = {
    prepare,
    // 실제 D1처럼 API 호출을 직렬화하고 batch 중에는 다른 문장이 끼어들지 않는다.
    batch: (statements: D1PreparedStatement[]) => atomic(() => {
      db.exec("BEGIN");
      try {
        const results = statements.map((statement) => {
          const data = Reflect.get(statement, prepared) as StatementData | undefined;
          if (!data) throw new Error("test_d1_statement_unknown");
          return execute(data);
        });
        db.exec("COMMIT");
        return results;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    }),
  } as unknown as D1Database;
  return { db, sqlite: db, d1, close: () => db.close() };
}

// batch 안의 문장을 다시 세지 않고 바인딩 API 호출 자체를 센다. 동시 태스크에도 카운터를 공유한다.
export function countD1Calls(base: D1Database) {
  let calls = 0;
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(statement, { get(target, key) {
      if (key === "bind") return (...params: unknown[]) => wrap(target.bind(...params));
      if (["run", "all", "raw", "first"].includes(String(key))) return (...params: unknown[]) => {
        calls++;
        return Reflect.get(target, key).apply(target, params);
      };
      return Reflect.get(target, key);
    } });
    originals.set(proxy, statement);
    return proxy;
  };
  const d1 = { ...base, prepare: (sql: string) => wrap(base.prepare(sql)),
    batch: async (statements: D1PreparedStatement[]) => {
      calls++;
      return base.batch(statements.map((statement) => originals.get(statement) ?? statement));
    },
  } as D1Database;
  return { d1, getCalls: () => calls, reset: () => { calls = 0; } };
}
