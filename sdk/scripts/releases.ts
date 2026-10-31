import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";

export type Release = { bytes: number; sha256: string; integrity: string };
export type ReleaseManifest = { latest: Record<string, string>; files: Record<string, Release> };
export const releasesDirectory = fileURLToPath(new NodeURL("../releases/", import.meta.url));
export const RELEASE_NAME = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.(js|mjs)$/;
export function describeRelease(bytes: Uint8Array): Release {
  return { bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), integrity: `sha384-${createHash("sha384").update(bytes).digest("base64")}` };
}
export function assertRelease(name: string, bytes: Uint8Array, expected: Release): void {
  const actual = describeRelease(bytes);
  if (!RELEASE_NAME.test(name) || actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256 || actual.integrity !== expected.integrity) throw new Error(`SDK release mismatch: ${name}`);
}
export function readManifest(): ReleaseManifest {
  return JSON.parse(readFileSync(new NodeURL("../releases/manifest.json", import.meta.url), "utf8")) as ReleaseManifest;
}
