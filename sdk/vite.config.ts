import { URL as NodeURL } from "node:url";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { assertRelease, readManifest, RELEASE_NAME } from "./scripts/releases.ts";

const { version } = JSON.parse(readFileSync(new NodeURL("./package.json", import.meta.url), "utf8")) as { version: string };
const major = version.split(".")[0];

// Every clean build restores tracked releases; an existing version can never change.
function releases(): Plugin {
  return {
    name: "avocado-sdk-releases",
    generateBundle(_options, bundle) {
      const manifest = readManifest();
      for (const [name, expected] of Object.entries(manifest.files)) {
        if (!RELEASE_NAME.test(name)) throw new Error("Invalid SDK release name");
        const bytes = readFileSync(new NodeURL(`./releases/${name}`, import.meta.url));
        assertRelease(name, bytes, expected);
        const generated = bundle[name];
        if (generated) {
          if (generated.type !== "chunk") throw new Error("Unexpected SDK release output");
          assertRelease(name, new TextEncoder().encode(generated.code), expected);
        } else this.emitFile({ type: "asset", fileName: name, source: bytes });
      }
      const current = bundle[`v${version}.js`];
      if (current?.type === "chunk") this.emitFile({ type: "asset", fileName: `v${major}.js`, source: current.code });
    },
  };
}

export default defineConfig({
  define: { __SDK_VERSION__: JSON.stringify(version) },
  plugins: [releases()],
  build: {
    target: "es2019",
    outDir: "../public/sdk",
    emptyOutDir: true,
    sourcemap: false,
    lib: {
      entry: "src/index.ts",
      formats: ["iife", "es"],
      name: "avocadoSdk",
      fileName: (format) => (format === "es" ? `v${version}.mjs` : `v${version}.js`),
    },
  },
});
