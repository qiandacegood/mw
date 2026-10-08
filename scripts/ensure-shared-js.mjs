import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "shared", "dist");
const tsconfig = join(root, "packages", "shared", "tsconfig.build.json");
const tsc = join(root, "node_modules", "typescript", "bin", "tsc");

if (!existsSync(tsc)) {
  console.error("typescript is not installed in the workspace");
  process.exit(1);
}

if (existsSync(dist)) {
  await rm(dist, { recursive: true, force: true });
}

const result = spawnSync(process.execPath, [tsc, "-p", tsconfig], {
  cwd: root,
  stdio: "inherit"
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (!existsSync(join(dist, "index.js")) || !existsSync(join(dist, "errors.js"))) {
  console.error("shared JS emit did not produce dist/index.js and dist/errors.js");
  process.exit(1);
}

console.log("emitted packages/shared/dist from src (Node/Vitest entry)");
