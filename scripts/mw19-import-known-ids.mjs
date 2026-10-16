import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./mw04-lib.mjs";
import { isSha256Hex } from "./mw13-lib.mjs";
import { emptyMw19KnownIds, knownIdCountOf } from "./mw19-lib.mjs";

const raw = process.argv[2] || process.env.MW19_KNOWN_IDS_JSON || "";
if (!raw) {
  console.error("usage: node scripts/mw19-import-known-ids.mjs '<json>'");
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  console.error(JSON.stringify({ ok: false, reason: "JSON_INVALID" }, null, 2));
  process.exit(1);
}

const incoming = parsed.knownIds || parsed;
const next = emptyMw19KnownIds();
for (const key of Object.keys(next)) {
  const list = incoming[key];
  if (!Array.isArray(list)) continue;
  for (const id of list) {
    if (!isSha256Hex(id)) {
      console.error(JSON.stringify({ ok: false, reason: "HASH_NOT_SHA256", key }, null, 2));
      process.exit(1);
    }
    next[key].push(id.toLowerCase());
  }
}

const out = {
  wroteDocs: true,
  resolved: false,
  knownIds: next,
  note: "只收本轮专用测试哈希；jobs/audit/ranking/seeds/账号 不入册、不删除"
};
writeFileSync(join(projectRoot(), "configs", "mw19-verify-state.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, knownIdCount: knownIdCountOf(next) }, null, 2));
