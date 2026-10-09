import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { emptyMw10KnownIds, knownIdCountOf, mw10Tmp, redactMw10 } from "./mw10-lib.mjs";

function loadState() {
  const path = join(projectRoot(), "configs", "mw10-verify-state.json");
  if (!existsSync(path)) return { wroteDocs: false, knownIds: emptyMw10KnownIds() };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return { wroteDocs: parsed.wroteDocs === true, knownIds: parsed.knownIds || emptyMw10KnownIds() };
}

async function deleteExact(collection, id) {
  if (!id || typeof id !== "string") return { id, ok: false, reason: "MISSING_ID" };
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([
      {
        TableName: collection,
        CommandType: "DELETE",
        Command: JSON.stringify({ delete: collection, deletes: [{ q: { _id: id }, limit: 1 }] })
      }
    ]),
    "--json"
  ]);
  return { id, collection, code: result.code, ok: result.code === 0 };
}

async function deleteObject(objectKey) {
  if (!objectKey || typeof objectKey !== "string") return { objectKey, ok: false, reason: "MISSING_KEY" };
  const result = await runTcb(["storage", "delete", objectKey, "--yes"]);
  return { objectKey, code: result.code, ok: result.code === 0 };
}

const ready = await assertMwTestReady();
authorizedEnvId();
const state = loadState();
const known = state.knownIds;
if (state.wroteDocs && knownIdCountOf(known) === 0) {
  const summary = {
    marker: "MW10",
    enableOverrun: ready.enableOverrun,
    deleted: 0,
    failed: 1,
    exactIdsOnly: true,
    wroteDocs: true,
    reason: "KNOWN_IDS_MISSING_AFTER_WRITE"
  };
  writeJson(join(mw10Tmp(), "mw10-cleanup.json"), redactMw10(summary));
  console.log(JSON.stringify(redactMw10(summary), null, 2));
  process.exit(1);
}

const deleted = [];
const pairs = [
  ...(known.questions || []).map((id) => ["questions", id]),
  ...(known.versions || []).map((id) => ["question_versions", id]),
  ...(known.assets || []).map((id) => ["media_assets", id]),
  ...(known.tickets || []).map((id) => ["upload_tickets", id]),
  ...(known.idempotency || []).map((id) => ["idempotency", id]),
  ...(known.audits || []).map((id) => ["audit_logs", id])
];
for (const [collection, id] of pairs) deleted.push(await deleteExact(collection, id));
for (const objectKey of known.objects || []) deleted.push(await deleteObject(objectKey));

const summary = {
  marker: "MW10",
  enableOverrun: ready.enableOverrun,
  deleted: deleted.length,
  failed: deleted.filter((item) => !item.ok).length,
  exactIdsOnly: true,
  wroteDocs: state.wroteDocs,
  knownIdCount: knownIdCountOf(known)
};
writeJson(join(mw10Tmp(), "mw10-cleanup.json"), redactMw10(summary));
console.log(JSON.stringify(redactMw10(summary), null, 2));
if (summary.failed) process.exit(1);
