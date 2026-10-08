import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { emptyMw09KnownIds, knownIdCountOf, mw09Tmp, redactMw09 } from "./mw09-lib.mjs";

function loadState() {
  const path = join(projectRoot(), "configs", "mw09-verify-state.json");
  if (!existsSync(path)) {
    return { wroteDocs: false, knownIds: emptyMw09KnownIds() };
  }
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    knownIds: parsed.knownIds || emptyMw09KnownIds()
  };
}

async function deleteExact(collection, id) {
  if (!id || typeof id !== "string") {
    return { id, ok: false, reason: "MISSING_ID" };
  }
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([
      {
        TableName: collection,
        CommandType: "DELETE",
        Command: JSON.stringify({
          delete: collection,
          deletes: [{ q: { _id: id }, limit: 1 }]
        })
      }
    ]),
    "--json"
  ]);
  return { id, collection, code: result.code, ok: result.code === 0 };
}

const ready = await assertMwTestReady();
authorizedEnvId();
const state = loadState();
const known = state.knownIds;
if (state.wroteDocs && knownIdCountOf(known) === 0) {
  const summary = {
    marker: "MW09",
    enableOverrun: ready.enableOverrun,
    deleted: 0,
    failed: 1,
    exactIdsOnly: true,
    wroteDocs: true,
    reason: "KNOWN_IDS_MISSING_AFTER_WRITE"
  };
  writeJson(join(mw09Tmp(), "mw09-cleanup.json"), redactMw09(summary));
  console.log(JSON.stringify(redactMw09(summary), null, 2));
  process.exit(1);
}

const deleted = [];
const pairs = [
  ...(known.categories || []).map((id) => ["categories", id]),
  ...(known.names || []).map((id) => ["category_names", id]),
  ...(known.idempotency || []).map((id) => ["idempotency", id]),
  ...(known.audits || []).map((id) => ["audit_logs", id])
];

for (const [collection, id] of pairs) {
  deleted.push(await deleteExact(collection, id));
}

const summary = {
  marker: "MW09",
  enableOverrun: ready.enableOverrun,
  deleted: deleted.length,
  failed: deleted.filter((item) => !item.ok).length,
  exactIdsOnly: true,
  wroteDocs: state.wroteDocs,
  knownIdCount: knownIdCountOf(known)
};
writeJson(join(mw09Tmp(), "mw09-cleanup.json"), redactMw09(summary));
console.log(JSON.stringify(redactMw09(summary), null, 2));
process.exit(summary.failed ? 1 : 0);
