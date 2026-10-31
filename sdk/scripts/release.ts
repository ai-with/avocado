import { URL as NodeURL } from "node:url";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { assertRelease, describeRelease, readManifest, RELEASE_NAME } from "./releases.ts";

// Explicit local release preparation. Never uploads or replaces a released byte.
const { version } = JSON.parse(readFileSync(new NodeURL("../package.json", import.meta.url), "utf8")) as { version: string };
const manifest = readManifest();
const pending = ["js", "mjs"].map((extension) => {
  const name = `v${version}.${extension}`;
  if (!RELEASE_NAME.test(name)) throw new Error("Invalid SDK release version");
  const bytes = readFileSync(new NodeURL(`../../public/sdk/${name}`, import.meta.url));
  const target = new NodeURL(`../releases/${name}`, import.meta.url);
  if (manifest.files[name]) assertRelease(name, bytes, manifest.files[name]);
  if (existsSync(target) && !readFileSync(target).equals(bytes)) throw new Error(`SDK release overwrite refused: ${name}`);
  return { name, bytes, target };
});
for (const { name, bytes, target } of pending) {
  if (!existsSync(target)) writeFileSync(target, bytes, { flag: "wx" });
  manifest.files[name] = describeRelease(bytes);
}
manifest.latest[version.split(".")[0]!] = version;
writeFileSync(new NodeURL("../releases/manifest.json", import.meta.url), JSON.stringify(manifest, null, 2) + "\n");
console.log(`SDK ${version} verified locally; no remote upload`);
