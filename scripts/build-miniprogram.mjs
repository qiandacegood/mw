import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mp = join(root, "apps", "miniprogram");
const sharedEntry = join(root, "packages", "shared", "src", "index.ts");
const npmDir = join(mp, "miniprogram_npm", "@mw", "shared");
const skipCleanDirs = new Set(["node_modules", "types"]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function removeGeneratedJs(dir) {
  if (!existsSync(dir)) return;
  for (const name of await readdir(dir)) {
    if (skipCleanDirs.has(name)) continue;
    const full = join(dir, name);
    const info = await stat(full);
    if (info.isDirectory()) {
      if (name === "miniprogram_npm") {
        await rm(full, { recursive: true, force: true });
        continue;
      }
      await removeGeneratedJs(full);
      continue;
    }
    if (
      name.endsWith(".js") &&
      !name.endsWith(".test.js") &&
      !name.endsWith(".example.js") &&
      name !== "cloud.local.js" &&
      name !== "cloud.runtime.js"
    ) {
      await rm(full, { force: true });
    }
  }
}

async function collectServiceEntries(dir, acc) {
  if (!existsSync(dir)) return acc;
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    const info = await stat(full);
    if (info.isDirectory()) {
      await collectServiceEntries(full, acc);
      continue;
    }
    if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

await removeGeneratedJs(mp);

const localCloud = join(mp, "cloud.local.js");
const localCloudExample = join(mp, "cloud.local.example.js");
const runtimeCloud = join(mp, "services", "cloud.runtime.js");
if (!existsSync(localCloud) && existsSync(localCloudExample)) {
  await copyFile(localCloudExample, localCloud);
}
if (!existsSync(runtimeCloud) && existsSync(localCloudExample)) {
  await mkdir(join(mp, "services"), { recursive: true });
  await copyFile(localCloudExample, runtimeCloud);
}

const appJsonPath = join(mp, "app.json");
if (!existsSync(appJsonPath)) fail("apps/miniprogram/app.json is missing");
const appJson = JSON.parse(await readFile(appJsonPath, "utf8"));
if (!Array.isArray(appJson.pages) || appJson.pages.length === 0) {
  fail("app.json pages must list at least one page");
}

const appTs = join(mp, "app.ts");
if (!existsSync(appTs)) fail("apps/miniprogram/app.ts is missing");
if (!existsSync(sharedEntry)) fail(`shared source missing: ${sharedEntry}`);

const entryPoints = new Set([appTs]);
for (const page of appJson.pages) {
  const pageTs = join(mp, `${page}.ts`);
  if (!existsSync(pageTs)) fail(`app.json page missing TypeScript source: ${page}.ts`);
  entryPoints.add(pageTs);
}
for (const serviceTs of await collectServiceEntries(join(mp, "services"), [])) {
  entryPoints.add(serviceTs);
}

await mkdir(npmDir, { recursive: true });

await esbuild.build({
  absWorkingDir: root,
  entryPoints: [sharedEntry],
  bundle: true,
  format: "cjs",
  platform: "neutral",
  outfile: join(npmDir, "index.js"),
  logLevel: "info"
});

await writeFile(
  join(npmDir, "package.json"),
  `${JSON.stringify({ name: "@mw/shared", version: "0.0.1", main: "index.js" }, null, 2)}\n`
);

await esbuild.build({
  absWorkingDir: mp,
  entryPoints: [...entryPoints],
  bundle: false,
  format: "cjs",
  platform: "neutral",
  outdir: mp,
  outbase: mp,
  logLevel: "info"
});

for (const page of appJson.pages) {
  for (const ext of [".js", ".json", ".wxml", ".wxss"]) {
    const file = join(mp, `${page}${ext}`);
    if (!existsSync(file)) fail(`app.json page ${page} missing ${ext}`);
  }
}

console.log(
  `miniprogram js emitted; ${entryPoints.size} entries from app.json/services; @mw/shared bundled from packages/shared/src`
);
