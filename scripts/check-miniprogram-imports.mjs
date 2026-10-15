import { existsSync, statSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { MP_FILE_EXTENSIONS, specsOfSource } from "./mp-module-specs.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mp = join(root, "apps", "miniprogram");
const skipDirs = new Set(["node_modules", "types"]);
const bundledShared = join(mp, "miniprogram_npm", "@mw", "shared", "index.js");
const generatedClient = join(mp, "services", "mock-client.js");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}

function relOf(file) {
  return relative(mp, file).split(sep).join("/");
}

async function walk(dir, acc = []) {
  for (const name of await readdir(dir)) {
    if (skipDirs.has(name)) continue;
    const full = join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) await walk(full, acc);
    else if (MP_FILE_EXTENSIONS.includes(extname(name)) && !name.endsWith(".test.js")) acc.push(full);
  }
  return acc;
}

function candidatesFor(base) {
  return [
    base,
    ...MP_FILE_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...MP_FILE_EXTENSIONS.map((ext) => join(base, `index${ext}`))
  ];
}

/**
 * 小程序运行时的解析规则：
 * - 相对路径：相对当前文件，可省略扩展名，也可落到目录 index。
 * - 裸包名：到 miniprogram_npm 下查找（覆盖 @mw/shared 与 tdesign-miniprogram 的 tslib 等）。
 */
function resolveSpec(fromFile, spec) {
  const base = spec.startsWith(".")
    ? resolve(dirname(fromFile), spec)
    : join(mp, "miniprogram_npm", spec);
  return candidatesFor(base).filter(isFile);
}

const files = await walk(mp);
if (files.length === 0) fail("no generated miniprogram files under apps/miniprogram");

const missing = [];
for (const file of files) {
  const ext = extname(file);
  const source = await readFile(file, "utf8");
  for (const spec of specsOfSource(source, ext)) {
    if (spec.startsWith("node:") || spec === "fs" || spec === "path") {
      missing.push(`${relOf(file)}: unexpected node import ${spec}`);
      continue;
    }
    const matches = resolveSpec(file, spec);
    // 组件的 usingComponents 必须落到真实组件定义（.json），只命中 .js 不算。
    const ok = ext === ".json" ? matches.some((match) => match.endsWith(".json")) : matches.length > 0;
    if (!ok) missing.push(`${relOf(file)}: cannot resolve ${spec}`);
  }
}

if (missing.length) fail(missing.join("\n"));
console.log(
  `checked ${files.length} miniprogram files (js/json/wxml/wxss); all runtime dependencies resolve from miniprogram root`
);

if (!existsSync(generatedClient)) fail("generated services/mock-client.js is missing");
if (!existsSync(bundledShared)) fail("generated miniprogram_npm/@mw/shared/index.js is missing");

function loadGeneratedCjs(file, source, requireFn) {
  const module = { exports: {} };
  const run = new Function("module", "exports", "require", "__filename", "__dirname", source);
  run(module, module.exports, requireFn, file, dirname(file));
  return module.exports;
}

const sharedExports = loadGeneratedCjs(bundledShared, await readFile(bundledShared, "utf8"), (spec) => {
  fail(`bundled @mw/shared unexpectedly required ${spec}`);
});
const clientExports = loadGeneratedCjs(generatedClient, await readFile(generatedClient, "utf8"), (spec) => {
  if (spec === "@mw/shared") return sharedExports;
  fail(`generated mock-client unexpectedly required ${spec}`);
});
const res = clientExports.fetchPaperDetail("paper_fict_logic_l1");
if (!res?.ok || res.data?.paperId !== "paper_fict_logic_l1") {
  fail(`generated mock-client did not return paper_fict_logic_l1: ${JSON.stringify(res)}`);
}
console.log("generated mock-client returned paper_fict_logic_l1");
