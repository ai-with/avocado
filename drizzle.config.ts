import { defineConfig } from "drizzle-kit";

// generate 보조용. 결과는 정리해서 migrations/000N_*.sql 로 옮긴다
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema/index.ts",
  out: "./.agent_work/scratch/drizzle",
});
