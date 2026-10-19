import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./mw04-lib.mjs";
import { emptyMw26Counts, isSha256Hex } from "./mw26-lib.mjs";

const raw = process.argv[2] || process.env.MW26_KNOWN_IDS_JSON || "";
if (!raw) {
  console.error("usage: node scripts/mw26-import-known-ids.mjs '<json>'");
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  console.error(JSON.stringify({ ok: false, reason: "JSON_INVALID" }, null, 2));
  process.exit(1);
}

const counts = { ...emptyMw26Counts(), ...(parsed.counts || {}) };
let hasCount = false;
for (const key of Object.keys(emptyMw26Counts())) {
  const n = Number(counts[key] || 0);
  if (!Number.isInteger(n) || n < 0) {
    console.error(JSON.stringify({ ok: false, reason: "COUNT_INVALID", key }, null, 2));
    process.exit(1);
  }
  counts[key] = n;
  if (n > 0) hasCount = true;
}

const hashes = [];
const incoming = parsed.knownIds || parsed.hashes || [];
if (Array.isArray(incoming)) {
  for (const id of incoming) {
    if (!isSha256Hex(id)) {
      console.error(JSON.stringify({ ok: false, reason: "HASH_NOT_SHA256" }, null, 2));
      process.exit(1);
    }
    hashes.push(id.toLowerCase());
  }
}

if (!hasCount && hashes.length === 0) {
  console.error(JSON.stringify({ ok: false, reason: "EMPTY_IMPORT" }, null, 2));
  process.exit(1);
}

const statePath = join(projectRoot(), "configs", "mw26-verify-state.json");
let previous = {};
if (existsSync(statePath)) {
  try {
    previous = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    previous = {};
  }
}
const out = {
  ...previous,
  wroteDocs: true,
  resolved: false,
  fixtureRound: "MW26",
  fixtureMarker: "mw26-load",
  seededAt: parsed.seededAt || previous.seededAt,
  weekKeyShanghai: parsed.weekKeyShanghai || previous.weekKeyShanghai,
  monthKeyShanghai: parsed.monthKeyShanghai || previous.monthKeyShanghai,
  counts,
  hashes,
  note: "只收本轮夹具。不入册、不删除 orders/refunds/vip_*/审计/种子十类/非本轮会员。清理须保留周/月键。"
};
writeFileSync(join(projectRoot(), "configs", "mw26-verify-state.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, counts, hashCount: hashes.length }, null, 2));
