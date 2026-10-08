import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mp = join(root, "apps", "miniprogram");
const skipDirs = new Set(["node_modules", "types"]);
const bundledShared = join(mp, "miniprogram_npm", "@mw", "shared", "index.js");
const generatedClient = join(mp, "services", "mock-client.js");

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function walk(dir, acc = []) {
  for (const name of await readdir(dir)) {
    if (skipDirs.has(name)) continue;
    const full = join(dir, name);
    const info = await stat(full);
    if (info.isDirectory()) await walk(full, acc);
    else if (name.endsWith(".js") && !name.endsWith(".test.js")) acc.push(full);
  }
  return acc;
}

function specs(source) {
  const found = [];
  const patterns = [
    /require\(\s*["']([^"']+)["']\s*\)/g,
    /from\s+["']([^"']+)["']/g,
    /import\(\s*["']([^"']+)["']\s*\)/g
  ];
  for (const re of patterns) {
    for (const match of source.matchAll(re)) found.push(match[1]);
  }
  return found;
}

function resolveSpec(fromFile, spec) {
  if (spec.startsWith(".")) {
    const base = resolve(dirname(fromFile), spec);
    return [base, `${base}.js`, join(base, "index.js")].find((candidate) => existsSync(candidate)) ?? null;
  }
  if (spec === "@mw/shared") {
    return existsSync(bundledShared) ? bundledShared : null;
  }
  return null;
}

const files = await walk(mp);
if (files.length === 0) fail("no generated JavaScript under apps/miniprogram");

const missing = [];
for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const spec of specs(source)) {
    if (spec.startsWith("node:") || spec === "fs" || spec === "path") {
      missing.push(`${file}: unexpected node import ${spec}`);
      continue;
    }
    if (!resolveSpec(file, spec)) {
      missing.push(`${file}: cannot resolve ${spec} from miniprogram root`);
    }
  }
}

if (missing.length) fail(missing.join("\n"));
console.log(`checked ${files.length} js files; all runtime imports resolve`);

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
