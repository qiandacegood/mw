import { existsSync, statSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { MP_FILE_EXTENSIONS, specsOfSource } from "./mp-module-specs.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mp = join(root, "apps", "miniprogram");
const sharedEntry = join(root, "packages", "shared", "src", "index.ts");
const npmDir = join(mp, "miniprogram_npm", "@mw", "shared");
const skipCleanDirs = new Set(["node_modules", "types"]);

/**
 * MW-UI01：TDesign 小程序组件的按需接入清单。
 * 这里只列样板页面与已确认的通用 UI 单元实际用到的组件，
 * 其余文件由 collectTdesignFiles 按真实依赖递归收集。
 */
const TDESIGN_COMPONENTS = [
  "button",
  "icon",
  "loading",
  "progress",
  "tag",
  "popup",
  "checkbox",
  "checkbox-group",
  "radio",
  "radio-group",
  // MW17 排行榜页：四榜切换与空榜状态
  "tabs",
  "tab-panel",
  "empty"
];
/**
 * app.wxss 显式引入的主题入口：TDesign 聚合的主题变量（品牌色阶、字体、圆角、间距、明暗）。
 * 它不被任何组件 wxss 引用，必须单独作为种子收集，否则 @import 会指向不存在的文件。
 */
const TDESIGN_STYLE_ENTRIES = ["common/style/theme/_index.wxss"];
const tdesignPackageDir = join(root, "node_modules", "tdesign-miniprogram");
const tdesignSrc = join(tdesignPackageDir, "miniprogram_dist");
const tdesignOut = join(mp, "miniprogram_npm", "tdesign-miniprogram");

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

function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}

/**
 * 解析一条小程序模块说明符。
 * - 相对路径：相对当前文件解析，允许省略扩展名与 index 文件。
 * - 裸包名：按 TDesign 发布产物内的 miniprogram_npm 目录解析（例如 tslib）。
 */
function resolveTdesignSpec(fromFile, spec) {
  const base = spec.startsWith(".")
    ? join(dirname(fromFile), spec)
    : join(tdesignSrc, "miniprogram_npm", spec);
  const candidates = [
    base,
    ...MP_FILE_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...MP_FILE_EXTENSIONS.map((ext) => join(base, `index${ext}`))
  ];
  return candidates.filter(isFile);
}

/** 源文件 → miniprogram_npm 内的目标路径；发布产物内自带的 miniprogram_npm 提升到顶层。 */
function tdesignTargetOf(sourceFile) {
  const rel = relative(tdesignSrc, sourceFile).split(sep).join("/");
  if (rel.startsWith("miniprogram_npm/")) {
    return join(mp, "miniprogram_npm", ...rel.slice("miniprogram_npm/".length).split("/"));
  }
  return join(tdesignOut, ...rel.split("/"));
}

async function assertTdesignPinned() {
  if (!existsSync(tdesignSrc)) {
    fail("node_modules/tdesign-miniprogram is missing; run npm install before building the miniprogram");
  }
  const mpPkg = JSON.parse(await readFile(join(mp, "package.json"), "utf8"));
  const declared = mpPkg.dependencies ? mpPkg.dependencies["tdesign-miniprogram"] : undefined;
  if (!declared || !/^\d+\.\d+\.\d+$/.test(declared)) {
    fail("apps/miniprogram/package.json must pin tdesign-miniprogram to an exact version (no ^ or latest)");
  }
  const installed = JSON.parse(await readFile(join(tdesignPackageDir, "package.json"), "utf8")).version;
  if (installed !== declared) {
    fail(`installed tdesign-miniprogram ${installed} does not match pinned ${declared}`);
  }
  return { declared, installed };
}

/** 从样板所需组件出发，按真实依赖递归收集需要复制的最小文件集合。 */
async function collectTdesignFiles() {
  const queue = [];
  for (const name of TDESIGN_COMPONENTS) {
    const componentDir = join(tdesignSrc, name);
    if (!existsSync(componentDir)) {
      fail(`tdesign-miniprogram component missing: ${name}`);
    }
    for (const file of await readdir(componentDir)) {
      if (MP_FILE_EXTENSIONS.includes(extname(file))) queue.push(join(componentDir, file));
    }
  }
  for (const entry of TDESIGN_STYLE_ENTRIES) {
    const styleFile = join(tdesignSrc, ...entry.split("/"));
    if (!isFile(styleFile)) fail(`tdesign-miniprogram style entry missing: ${entry}`);
    queue.push(styleFile);
  }

  const seen = new Set();
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const specs = specsOfSource(await readFile(file, "utf8"), extname(file));
    for (const spec of specs) {
      const targets = resolveTdesignSpec(file, spec);
      if (targets.length === 0) {
        fail(
          `tdesign-miniprogram dependency unresolved: ${relative(tdesignSrc, file).split(sep).join("/")} -> ${spec}`
        );
      }
      queue.push(...targets);
    }
  }
  return [...seen];
}

async function copyTdesignRuntime() {
  const { declared, installed } = await assertTdesignPinned();
  const files = await collectTdesignFiles();
  let bytes = 0;
  for (const sourceFile of files) {
    const target = tdesignTargetOf(sourceFile);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(sourceFile, target);
    bytes += statSync(sourceFile).size;
  }
  console.log(
    `tdesign-miniprogram ${installed} copied: ${files.length} files, ${(bytes / 1024).toFixed(1)} KB ` +
      `(pinned ${declared}, license MIT, components: ${TDESIGN_COMPONENTS.join(",")})`
  );
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

await copyTdesignRuntime();

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
  `miniprogram js emitted; ${entryPoints.size} entries from app.json/services; ` +
    `@mw/shared bundled from packages/shared/src; tdesign-miniprogram copied from node_modules (miniprogram_npm rebuilt from scratch)`
);
