import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./mw04-lib.mjs";
import { emptyMw27Counts, isSha256Hex } from "./mw27-lib.mjs";

const raw = process.argv[2] || process.env.MW27_KNOWN_IDS_JSON || "";
if (!raw) {
  console.error("usage: node scripts/mw27-import-known-ids.mjs '<json>'");
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  console.error(JSON.stringify({ ok: false, reason: "JSON_INVALID" }, null, 2));
  process.exit(1);
}

const counts = { ...emptyMw27Counts(), ...(parsed.counts || {}) };
let hasCount = false;
for (const key of Object.keys(emptyMw27Counts())) {
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

const statePath = join(projectRoot(), "configs", "mw27-verify-state.json");
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
  fixtureRound: "MW27",
  fixtureMarker: "mw27-restore",
  seededAt: parsed.seededAt || previous.seededAt,
  counts,
  hashes,
  leftoverClaimedZero: false,
  note: "只收本轮夹具与隔离回档集合。不入册、不删除历史账本/种子十类/ranking_*/app_config。"
};
writeFileSync(statePath, `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, counts, hashCount: hashes.length, leftoverClaimedZero: false }, null, 2));
