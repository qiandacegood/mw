import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  join(root, "docs", "design", "prototypes", "index.html"),
  join(root, "docs", "design", "prototypes", "miniprogram.html"),
  join(root, "docs", "design", "prototypes", "admin.html")
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let checked = 0;

for (const file of files) {
  if (!existsSync(file)) fail(`prototype file missing: ${file}`);
  const html = await readFile(file, "utf8");
  const blocks = [...html.matchAll(scriptRe)];
  let parsedHere = 0;
  for (const [index, match] of blocks.entries()) {
    const attrs = match[1] ?? "";
    const source = (match[2] ?? "").trim();
    if (/\bsrc\s*=/.test(attrs)) continue;
    if (!source) fail(`${file} script #${index + 1} is empty`);
    try {
      new vm.Script(source, { filename: `${file}#script${index + 1}` });
      parsedHere += 1;
      checked += 1;
    } catch (error) {
      fail(`${file} script #${index + 1} failed to parse: ${error.message}`);
    }
  }
  if (parsedHere === 0 && /(?:admin|miniprogram)\.html$/.test(file)) {
    fail(`${file} has no parseable inline script`);
  }
  if (parsedHere === 0) console.log(`${file}: no inline scripts`);
}

console.log(`checked ${checked} inline prototype scripts; all parsed`);
