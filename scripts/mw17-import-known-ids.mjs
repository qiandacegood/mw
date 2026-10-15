import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./mw04-lib.mjs";
import { emptyMw17KnownIds, isSha256Hex, parseLeftoverHashes } from "./mw17-lib.mjs";

const raw = process.argv[2] || process.env.MW17_KNOWN_IDS_JSON || "";
if (!raw) {
  console.error("usage: node scripts/mw17-import-known-ids.mjs '<json>'");
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
/** 只校验哈希类字段；`steps` / `summary` 这类非哈希字段原样忽略，不做推断。 */
const HASH_KEYS = [
  "papers",
  "attempts",
  "members",
  "questions",
  "questionVersions",
  "versions",
  "chunks",
  "answers",
  "assets",
  "batches",
  "rows",
  "sourceKeys",
  "objects",
  "activeAttempts",
  "bests",
  "events",
  "metrics",
  "grants"
];
if (incoming && typeof incoming === "object" && !Array.isArray(incoming)) {
  for (const key of HASH_KEYS) {
    const list = incoming[key];
    if (Array.isArray(list) && list.length && !list.every((item) => isSha256Hex(item))) {
      console.error(JSON.stringify({ ok: false, reason: "HASH_NOT_SHA256", key }, null, 2));
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
  hashes: {
    papers: parsedHashes.papers,
    attempts: parsedHashes.attempts,
    members: parsedHashes.members,
    questions: parsedHashes.questions,
    questionVersions: parsedHashes.questionVersions,
    assets: parsedHashes.assets
  },
  knownIds: emptyMw17KnownIds(),
  importedAt: new Date().toISOString()
};
writeFileSync(join(projectRoot(), "configs", "mw17-verify-state.json"), JSON.stringify(out, null, 2), "utf8");
console.log(
  JSON.stringify(
    {
      ok: true,
      wroteDocs: true,
      importedHashCount: parsedHashes.importedHashCount,
      counts: {
        papers: parsedHashes.papers.length,
        attempts: parsedHashes.attempts.length,
        members: parsedHashes.members.length,
        questions: parsedHashes.questions.length,
        questionVersions: parsedHashes.questionVersions.length,
        assets: parsedHashes.assets.length
      }
    },
    null,
    2
  )
);
