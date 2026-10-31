import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { SERVICE_NAME } from "./src/shared/brand.ts";

export default defineConfig({
  plugins: [
    react(),
    cloudflare(),
    // index.html 의 %SERVICE_NAME% 를 brand.ts 값으로 바꾼다 (탭 제목)
    { name: "brand-html", transformIndexHtml: (html: string) => html.replaceAll("%SERVICE_NAME%", SERVICE_NAME) },
  ],
  // Vite 빌드에서는 wrangler 의 "minify" 가 무시되므로 Worker 환경(이름 = wrangler name)에 직접 켠다
  environments: { avocado: { build: { minify: true } } },
});
