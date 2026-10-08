import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { emptyMw09KnownIds, mw09Tmp, redactMw09 } from "./mw09-lib.mjs";
import { seedCategoryIds } from "../packages/shared/dist/category.js";

function loadState() {
  const path = join(projectRoot(), "configs", "mw09-verify-state.json");
  if (!existsSync(path)) return { wroteDocs: false, knownIds: emptyMw09KnownIds() };
  return JSON.parse(readFileSync(path, "utf8"));
}

async function deleteByQuery(collection, query) {
  return runTcb([
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
          deletes: [{ q: query, limit: 1 }]
        })
      }
    ]),
    "--json"
  ]);
}

async function countBy(collection, query) {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([
      {
        TableName: collection,
        CommandType: "COMMAND",
        Command: JSON.stringify({ count: collection, query })
      }
    ]),
    "--json"
  ]);
  return parseNosqlCount(result);
}

const ready = await assertMwTestReady();
authorizedEnvId();
const state = loadState();
const categories = state.knownIds?.categories || [];
const seeds = new Set(seedCategoryIds());
if (categories.some((id) => seeds.has(id))) {
  throw new Error("refusing related cleanup: seed id in known categories");
}

const deleted = [];
for (const id of categories) {
  let guard = 0;
  while (guard < 20) {
    const n = await countBy("audit_logs", { target: id });
    if (n === 0 || n === null) break;
    const result = await deleteByQuery("audit_logs", { target: id });
    deleted.push({ collection: "audit_logs", target: id, code: result.code });
    guard += 1;
  }
  guard = 0;
  while (guard < 20) {
    const n = await countBy("idempotency", { "resultRef.categoryId": id });
    if (n === 0 || n === null) break;
    const result = await deleteByQuery("idempotency", { "resultRef.categoryId": id });
    deleted.push({ collection: "idempotency", target: id, code: result.code });
    guard += 1;
  }
}

const remaining = {};
for (const id of categories) {
  remaining[id] = {
    audits: await countBy("audit_logs", { target: id }),
    idem: await countBy("idempotency", { "resultRef.categoryId": id })
  };
}

const summary = redactMw09({
  marker: "MW09",
  enableOverrun: ready.enableOverrun,
  relatedDeletes: deleted.length,
  remaining,
  exactTargetsOnly: true
});
writeJson(join(mw09Tmp(), "mw09-cleanup-related.json"), summary);
console.log(JSON.stringify(summary, null, 2));
