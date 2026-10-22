import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
const major = version.split(".")[0];

/** 버전 고정본(v1.x.y.js)과 같은 내용으로 최신 경로(v1.js)도 만든다 (docs/14 9-2) */
function latestAlias(): Plugin {
  return {
    name: "avocado-sdk-latest-alias",
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk" || !chunk.fileName.endsWith(".js")) continue;
        this.emitFile({ type: "asset", fileName: `v${major}.js`, source: chunk.code });
      }
    },
  };
}

const sdkDefine = { __SDK_VERSION__: JSON.stringify(version) };

export default defineConfig({
  define: sdkDefine,
  plugins: [latestAlias()],
  build: {
    target: "es2019",
    outDir: "../public/sdk",
    emptyOutDir: true,
    sourcemap: false,
    lib: {
      entry: "src/index.ts",
      formats: ["iife", "es"],
      // vite가 iife에 요구하는 이름. 진입 파일에 export가 없어 전역 변수는 생기지 않는다 (window.avocado만 쓴다)
      name: "avocadoSdk",
      fileName: (format) => (format === "es" ? `v${version}.mjs` : `v${version}.js`),
    },
  },
});
