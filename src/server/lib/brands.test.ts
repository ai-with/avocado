import { describe, expect, it } from "vitest";
import { brandDeleteBlock, resolveBrandName } from "./brands";

// 0017 이관 SQL 을 실제 SQLite(node:sqlite)에 적용해 본다. 서버 tsconfig 는 node 타입이 없어 동적 import 와 좁은 타입을 쓴다
type Row = Record<string, string | number | null>;
type Stmt = { all: (...p: (string | number)[]) => Row[]; get: (...p: (string | number)[]) => Row | undefined; run: (...p: (string | number)[]) => void };
type Sqlite = { exec: (sql: string) => void; prepare: (sql: string) => Stmt };
type SqliteModule = { DatabaseSync: new (path: string) => Sqlite };
type FsModule = { readdirSync: (p: string) => string[]; readFileSync: (p: string, enc: "utf8") => string };

const MIGRATIONS = "migrations";
const TARGET = "0017_brands_campaigns.sql";

async function load() {
  const sqlite = (await import("node:sqlite" as string)) as SqliteModule;
  const fs = (await import("node:fs" as string)) as FsModule;
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const read = (f: string) => fs.readFileSync(`${MIGRATIONS}/${f}`, "utf8");
  return { sqlite, before: files.filter((f) => f < TARGET).map(read), target: read(TARGET) };
}

async function dbBefore0017() {
  const { sqlite, before, target } = await load();
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const sql of before) db.exec(sql);
  return { db, target };
}

const T = 1_700_000_000_000;
const json = (v: unknown) => JSON.stringify(v);

function seed(db: Sqlite) {
  const ws = db.prepare("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)");
  ws.run("w1", "데모 브랜드", T);
  ws.run("w2", "빈 워크스페이스", T);
  const guide = db.prepare(
    "INSERT INTO guides (id, workspace_id, name, slug, extra_rules, product, deliverables, secondary_use_scope, created_at, updated_at) VALUES (?, 'w1', ?, ?, '[]', ?, ?, ?, ?, ?)",
  );
  const product = json({ name: "", benefits: [], usage: "", photos: [] });
  const deliverables = json({ final: true, clean: false, note: "" });
  const scope = json({ ads: false, media: [], regions: [], months: 0 });
  guide.run("g1", "가을 캠페인", "fall", product, deliverables, scope, T, T);
  guide.run("g2", "겨울 캠페인", "winter", product, deliverables, scope, T + 1, T + 1);
}

// 데이터 문장만 다시 돌린다(ALTER 는 wrangler 가 한 번만 적용)
const withoutAlter = (sql: string) => sql.replace(/^ALTER TABLE .*$/m, "");

describe("0017 브랜드·캠페인 이관", () => {
  it("빈 DB 에도 적용된다", async () => {
    const { db, target } = await dbBefore0017();
    db.exec(target);
    expect(db.prepare("SELECT count(*) n FROM brands").get()?.n).toBe(0);
    expect(db.prepare("SELECT count(*) n FROM campaigns").get()?.n).toBe(0);
  });

  it("워크스페이스마다 기본 브랜드, 가이드마다 캠페인(id 같음)을 만들고 다시 돌려도 늘지 않는다", async () => {
    const { db, target } = await dbBefore0017();
    seed(db);
    db.exec(target);
    db.exec(withoutAlter(target));
    const brands = db.prepare("SELECT workspace_id, name FROM brands ORDER BY workspace_id").all();
    expect(brands).toEqual([{ workspace_id: "w1", name: "데모 브랜드" }, { workspace_id: "w2", name: "빈 워크스페이스" }]);
    const rows = db.prepare("SELECT g.id, g.campaign_id, c.name, c.status, b.name brand FROM guides g JOIN campaigns c ON c.id = g.campaign_id JOIN brands b ON b.id = c.brand_id ORDER BY g.id").all();
    expect(rows).toEqual([
      { id: "g1", campaign_id: "g1", name: "가을 캠페인", status: "active", brand: "데모 브랜드" },
      { id: "g2", campaign_id: "g2", name: "겨울 캠페인", status: "active", brand: "데모 브랜드" },
    ]);
    expect(db.prepare("SELECT count(*) n FROM campaigns").get()?.n).toBe(2);
  });
});

describe("브랜드 이름·삭제 규칙", () => {
  it("캠페인 브랜드가 있으면 그 이름, 없거나 비면 워크스페이스 이름", () => {
    expect(resolveBrandName("오렌지랩", "에이전시")).toBe("오렌지랩");
    expect(resolveBrandName(null, "에이전시")).toBe("에이전시");
    expect(resolveBrandName("  ", "에이전시")).toBe("에이전시");
  });

  it("캠페인이 있는 브랜드와 마지막 브랜드는 지울 수 없다", () => {
    expect(brandDeleteBlock(2, 3)).toContain("캠페인이 2개");
    expect(brandDeleteBlock(0, 1)).toBe("브랜드는 하나 이상 있어야 해요.");
    expect(brandDeleteBlock(0, 2)).toBeNull();
  });
});
