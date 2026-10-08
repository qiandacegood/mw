import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { mw08Tmp, redactMw08 } from "./mw08-lib.mjs";

function loadKnown() {
  const path = join(projectRoot(), "configs", "mw08-verify-state.json");
  if (!existsSync(path)) {
    return { identities: [], members: [], stats: [], idempotency: [], audits: [] };
  }
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return parsed.knownIds || { identities: [], members: [], stats: [], idempotency: [], audits: [] };
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
const known = loadKnown();
const deleted = [];
const pairs = [
  ...known.identities.map((id) => ["identities", id]),
  ...known.members.map((id) => ["members", id]),
  ...known.stats.map((id) => ["member_stats", id]),
  ...known.idempotency.map((id) => ["idempotency", id]),
  ...known.audits.map((id) => ["audit_logs", id])
];

for (const [collection, id] of pairs) {
  deleted.push(await deleteExact(collection, id));
}

const summary = {
  marker: "MW08",
  enableOverrun: ready.enableOverrun,
  deleted: deleted.length,
  failed: deleted.filter((item) => !item.ok).length,
  exactIdsOnly: true
};
writeJson(join(mw08Tmp(), "mw08-cleanup.json"), redactMw08(summary));
console.log(JSON.stringify(redactMw08(summary), null, 2));
if (summary.failed) process.exit(1);
