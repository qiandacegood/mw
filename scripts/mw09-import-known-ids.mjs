import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, writeJson } from "./mw04-lib.mjs";
import { emptyMw09KnownIds, knownIdCountOf, MW09_MARKER, redactMw09 } from "./mw09-lib.mjs";

function asIdList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && /^[0-9a-f]{64}$/i.test(item)) : [];
}

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/mw09-import-known-ids.mjs <json-file>");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(file, "utf8"));
const source = raw.knownIds && typeof raw.knownIds === "object" ? raw.knownIds : raw;
const fromSteps = Array.isArray(raw.steps)
  ? raw.steps.map((item) => item.categoryId).filter((item) => typeof item === "string")
  : [];
const knownIds = {
  categories: [...new Set([...asIdList(source.categories), ...asIdList(fromSteps)])],
  names: asIdList(source.names),
  idempotency: asIdList(source.idempotency),
  audits: asIdList(source.audits)
};
const count = knownIdCountOf(knownIds);
if (count === 0) {
  console.error("no hashed knownIds found");
  process.exit(1);
}

const state = {
  marker: MW09_MARKER,
  wroteDocs: true,
  knownIds,
  importedAt: new Date().toISOString()
};
writeJson(join(projectRoot(), "configs", "mw09-verify-state.json"), redactMw09(state));
console.log(
  JSON.stringify(
    redactMw09({
      ok: true,
      wroteDocs: true,
      knownIdCount: count,
      emptyTemplate: emptyMw09KnownIds()
    }),
    null,
    2
  )
);
