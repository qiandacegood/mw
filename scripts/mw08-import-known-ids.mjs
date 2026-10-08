import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, writeJson } from "./mw04-lib.mjs";
import { emptyMw08KnownIds, knownIdCountOf, MW08_MARKER, redactMw08 } from "./mw08-lib.mjs";

function asIdList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && /^[0-9a-f]{64}$/i.test(item)) : [];
}

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/mw08-import-known-ids.mjs <json-file>");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(file, "utf8"));
const source = raw.knownIds && typeof raw.knownIds === "object" ? raw.knownIds : raw;
const knownIds = {
  identities: asIdList(source.identities),
  members: asIdList(source.members),
  stats: asIdList(source.stats ?? source.members),
  idempotency: asIdList(source.idempotency),
  audits: asIdList(source.audits)
};
const count = knownIdCountOf(knownIds);
if (count === 0) {
  console.error("no hashed knownIds found");
  process.exit(1);
}

const state = {
  marker: MW08_MARKER,
  wroteDocs: true,
  knownIds,
  importedAt: new Date().toISOString()
};
writeJson(join(projectRoot(), "configs", "mw08-verify-state.json"), redactMw08(state));
console.log(
  JSON.stringify(
    redactMw08({
      ok: true,
      wroteDocs: true,
      knownIdCount: count,
      emptyTemplate: emptyMw08KnownIds()
    }),
    null,
    2
  )
);
