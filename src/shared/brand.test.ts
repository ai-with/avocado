/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_TITLE, SERVICE_NAME, SMS_PREFIX } from "./brand";

// "avocado" 리터럴을 허용하는 파일(src 기준 경로)과 이유. 서비스명이 아니라 바꾸면 깨지는 기술 식별자다
const ALLOWED: Record<string, string> = {
  "shared/brand.ts": "서비스명의 단일 원천",
  "server/jobs.ts": "Queue 이름 avocado-collect",
  "server/lib/snapshot.ts": "User-Agent AvocadoSnapshot",
  "server/lib/safe-fetch.ts": "User-Agent AvocadoProductReader",
  "server/routes/sites/shared.ts": "웹 SDK 설치 스니펫의 전역 함수 window.avocado",
  "client/features/sites/sections/SiteCard.tsx": "SDK 전역 함수 avocado() 사용 안내",
  "client/features/sites/sections/SiteFormModal.tsx": "SDK 전역 함수 avocado() 사용 안내",
  "client/pages/dev-ui/Page.tsx": "개발용 카탈로그 화면(사용자에게 노출 안 됨)",
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

const isComment = (line: string) => /^\s*(\/\/|\/\*|\*)/.test(line);
const SRC = join(process.cwd(), "src");

describe("brand", () => {
  it("파생값이 서비스명을 따른다", () => {
    expect(SMS_PREFIX).toBe(`[${SERVICE_NAME}]`);
    expect(PAGE_TITLE.startsWith(SERVICE_NAME)).toBe(true);
  });

  it("허용 목록 밖에는 서비스명 리터럴이 없다", () => {
    const hits = [...walk(join(SRC, "client")), ...walk(join(SRC, "server")), ...walk(join(SRC, "shared"))]
      .map((p) => relative(SRC, p))
      .filter((rel) => !(rel in ALLOWED))
      .flatMap((rel) =>
        readFileSync(join(SRC, rel), "utf8")
          .split("\n")
          .map((line, i) => ({ rel, line, n: i + 1 }))
          .filter(({ line }) => /avocado/i.test(line) && !isComment(line))
          .map(({ rel: r, n }) => `${r}:${n}`),
      );
    expect(hits, "brand.ts 의 SERVICE_NAME 을 쓰거나 ALLOWED 에 이유와 함께 추가").toEqual([]);
  });
});
