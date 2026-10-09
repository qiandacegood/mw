import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./mw04-lib.mjs";
import { emptyMw11KnownIds } from "./mw11-lib.mjs";

const raw = process.argv[2] || process.env.MW11_KNOWN_IDS_JSON || "";
if (!raw) {
  console.error("usage: node scripts/mw11-import-known-ids.mjs '<json>'");
  process.exit(1);
}
const parsed = JSON.parse(raw);
const knownIds = { ...emptyMw11KnownIds(), ...(parsed.knownIds || parsed) };
const out = {
  wroteDocs: true,
  knownIds,
  importedAt: new Date().toISOString()
};
writeFileSync(join(projectRoot(), "configs", "mw11-verify-state.json"), JSON.stringify(out, null, 2), "utf8");
console.log(JSON.stringify({ ok: true, wroteDocs: true, knownIdKeys: Object.keys(knownIds) }, null, 2));
