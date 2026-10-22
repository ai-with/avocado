import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), cloudflare()],
  // Vite 빌드에서는 wrangler 의 "minify" 가 무시되므로 Worker 환경(이름 = wrangler name)에 직접 켠다
  environments: { avocado: { build: { minify: true } } },
});
