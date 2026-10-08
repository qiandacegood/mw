import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "cloudfunctions", "_official");
const outfile = join(outDir, "runtime.cjs");

mkdirSync(outDir, { recursive: true });

await esbuild.build({
  absWorkingDir: root,
  entryPoints: [join(root, "services", "api", "src", "cloud-main.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile,
  external: ["@cloudbase/node-sdk", "wx-server-sdk"],
  logLevel: "info"
});

const hash = createHash("sha256").update(readFileSync(outfile)).digest("hex");
writeFileSync(join(outDir, "runtime.sha256"), `${hash}\n`, "utf8");

const officialFns = [
  "cloudbase_auth",
  "mw-public",
  "mw-member",
  "mw-admin",
  "mw-upload",
  "mw-pay-hook",
  "mw-jobs"
];
const template = join(outDir, "function-template.js");
for (const name of officialFns) {
  const dest = join(root, "cloudfunctions", name);
  mkdirSync(dest, { recursive: true });
  copyFileSync(outfile, join(dest, "runtime.cjs"));
  copyFileSync(template, join(dest, "function-template.js"));
}

console.log(`emitted official runtime ${hash.slice(0, 12)}`);
