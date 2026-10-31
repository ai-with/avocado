import { describe, expect, it } from "vitest";
import { createSqliteD1 } from "../test/sqlite-d1";

describe("기존 미디어 동의 세대 이관", () => {
  it("확정된 과거 철회만 예약하고 재동의 새 제출물·모호한 이력은 추정하지 않는다", async () => {
    const { db, close } = await createSqliteD1({ migrateThrough: 23 });
    try {
      db.exec("INSERT INTO workspaces(id,name,created_at) VALUES('w','team',1)");
      db.exec("INSERT INTO guides(id,workspace_id,name,slug,extra_rules,product,deliverables,secondary_use_scope,created_at,updated_at) VALUES('g','w','guide','g','[]','{}','{}','{}',1,1)");
      for (const id of ["one", "overlap", "missing"]) {
        db.prepare("INSERT INTO influencers(id,workspace_id,display_name,created_at) VALUES(?,'w','person',1)").run(id);
        db.prepare("INSERT INTO guide_influencers(id,guide_id,influencer_id,guide_token,upload_token,feedback_token,connect_token,token_expires_at,created_at) VALUES(?,'g',?,?,?,?,?,99999,1)").run(id, id, `${id}-g`, `${id}-u`, `${id}-f`, `${id}-c`);
      }
      const consent = (id: string, gi: string, agreed: number, withdrawn: number | null) => db.prepare("INSERT INTO consents(id,guide_influencer_id,doc_version,items,secondary_use_scope,name,email,country,age_confirmed,agreed_at,withdrawn_at) VALUES(?,?,'v1','{}','{}','person','test@example.com','KR',1,?,?)").run(id, gi, agreed, withdrawn);
      consent("old", "one", 100, 200);
      consent("new", "one", 300, null);
      consent("overlap1", "overlap", 100, 400);
      consent("overlap2", "overlap", 120, 350);
      db.exec("INSERT INTO events(id,workspace_id,name,props,at) VALUES('event','w','consent_withdrawn','{\"gi_id\":\"missing\"}',200)");
      const sub = (id: string, gi: string, created: number) => db.prepare("INSERT INTO submissions(id,guide_influencer_id,version,kind,status,created_at) VALUES(?,?,1,'final','uploaded',?)").run(id, gi, created);
      sub("old-video", "one", 150);
      sub("new-video", "one", 350);
      sub("gap-video", "one", 250);
      sub("boundary-video", "one", 200);
      sub("overlap-video", "overlap", 150);
      sub("missing-video", "missing", 150);
      const fs = (await import("node:fs" as string)) as { readFileSync(path: string, encoding: string): string };
      db.exec(fs.readFileSync("migrations/0024_privacy_purge.sql", "utf8"));
      const generations = Object.fromEntries(db.prepare("SELECT id,consent_id FROM submissions").all().map((row) => [row.id, row.consent_id]));
      expect(generations).toEqual({ "old-video": "old", "new-video": "new", "gap-video": null, "boundary-video": null, "overlap-video": null, "missing-video": null });
      expect(db.prepare("SELECT submission_id,consent_id,requested_at,due_at FROM media_purges").all()).toEqual([{ submission_id: "old-video", consent_id: "old", requested_at: 200, due_at: 200 }]);
      expect(() => db.prepare("INSERT INTO submissions(id,guide_influencer_id,consent_id,version,kind,status,created_at) VALUES('late-old','one','old',1,'final','uploading',400)").run()).toThrow(/consent_withdrawn/);
      db.prepare("INSERT INTO submissions(id,guide_influencer_id,consent_id,version,kind,status,created_at) VALUES('fresh-new','one','new',1,'final','uploading',400)").run();
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { close(); }
  });
});
