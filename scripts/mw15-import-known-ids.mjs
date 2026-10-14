import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./mw04-lib.mjs";
import { emptyMw15KnownIds, isSha256Hex, parseLeftoverHashes } from "./mw15-lib.mjs";

const raw = process.argv[2] || process.env.MW15_KNOWN_IDS_JSON || "";
if (!raw) {
  console.error("usage: node scripts/mw15-import-known-ids.mjs '<json>'");
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  console.error(JSON.stringify({ ok: false, reason: "HASH_NOT_SHA256" }, null, 2));
  process.exit(1);
}

const incoming = parsed.knownIds || parsed;
const extraKeys = ["versions", "chunks", "answers", "objects", "activeAttempts", "bests", "events", "metrics"];
if (incoming && typeof incoming === "object" && !Array.isArray(incoming)) {
  for (const key of extraKeys) {
    const list = incoming[key];
    if (Array.isArray(list) && list.length && !list.every((item) => isSha256Hex(item))) {
      console.error(JSON.stringify({ ok: false, reason: "HASH_NOT_SHA256" }, null, 2));
      process.exit(1);
    }
  }
}

const parsedHashes = parseLeftoverHashes(incoming);
if (!parsedHashes.ok) {
  console.error(JSON.stringify({ ok: false, reason: parsedHashes.reason }, null, 2));
  process.exit(1);
}

const out = {
  wroteDocs: true,
  resolved: false,
  hashesOnly: true,
  hashes: { papers: parsedHashes.papers, attempts: parsedHashes.attempts },
  knownIds: emptyMw15KnownIds(),
  importedAt: new Date().toISOString()
};
writeFileSync(join(projectRoot(), "configs", "mw15-verify-state.json"), JSON.stringify(out, null, 2), "utf8");
console.log(
  JSON.stringify(
    {
      ok: true,
      wroteDocs: true,
      importedHashCount: parsedHashes.papers.length + parsedHashes.attempts.length
    },
    null,
    2
  )
);
