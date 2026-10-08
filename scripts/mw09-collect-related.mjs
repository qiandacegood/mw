import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { emptyMw09KnownIds, knownIdCountOf, MW09_MARKER, mw09Tmp, redactMw09 } from "./mw09-lib.mjs";
import { categoryNameId, seedCategoryIds } from "../packages/shared/dist/category.js";

function loadState() {
  const path = join(projectRoot(), "configs", "mw09-verify-state.json");
  if (!existsSync(path)) return { wroteDocs: false, knownIds: emptyMw09KnownIds() };
  return JSON.parse(readFileSync(path, "utf8"));
}

function asHex(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : "";
}

function extractDocs(json) {
  const raw = json?.data?.results?.[0] || json?.data || json;
  const cursor = raw?.cursor || raw;
  const first = Array.isArray(cursor) ? cursor[0] : cursor;
  const batch = first?.cursor?.firstBatch || first?.firstBatch || first?.documents || raw?.cursor?.firstBatch || [];
  return Array.isArray(batch) ? batch : [];
}

async function findBy(collection, query) {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([
      {
        TableName: collection,
        CommandType: "COMMAND",
        Command: JSON.stringify({ find: collection, filter: query, limit: 20 })
      }
    ]),
    "--json"
  ]);
  return extractDocs(result.json).map((row) => asHex(row._id || row.id)).filter(Boolean);
}

const ready = await assertMwTestReady();
authorizedEnvId();
const state = loadState();
const categories = [...new Set((state.knownIds?.categories || []).map(asHex).filter(Boolean))];
const seeds = new Set(seedCategoryIds());
if (categories.some((id) => seeds.has(id))) {
  throw new Error("refusing to collect: known category id overlaps a seed root");
}

const computedNames = [
  categoryNameId("285ed461ccf0ef4839af4a3cee9580cb8b206b510923b20b83aadd4c17f4b547", "MW09测试二级"),
  categoryNameId("285ed461ccf0ef4839af4a3cee9580cb8b206b510923b20b83aadd4c17f4b547", "MW09测试三级A"),
  categoryNameId("95488c33fb0ac16bc25088d5f7506257082cf677fdff2444a87bdc24169456a3", "MW09测试三级"),
  categoryNameId(null, "MW09测试删除")
];

const names = new Set(computedNames.map((id) => id.toLowerCase()));
const audits = new Set();
const idem = new Set();

for (const id of categories) {
  for (const found of await findBy("category_names", { categoryId: id })) names.add(found);
  for (const found of await findBy("audit_logs", { target: id })) audits.add(found);
  for (const found of await findBy("idempotency", { "resultRef.categoryId": id })) idem.add(found);
}

const knownIds = {
  categories,
  names: [...names],
  idempotency: [...idem],
  audits: [...audits]
};
const next = {
  marker: MW09_MARKER,
  wroteDocs: true,
  knownIds,
  importedAt: state.importedAt || new Date().toISOString(),
  collectedAt: new Date().toISOString()
};
writeJson(join(projectRoot(), "configs", "mw09-verify-state.json"), redactMw09(next));
const summary = redactMw09({
  ok: true,
  wroteDocs: true,
  knownIdCount: knownIdCountOf(knownIds),
  counts: {
    categories: knownIds.categories.length,
    names: knownIds.names.length,
    idempotency: knownIds.idempotency.length,
    audits: knownIds.audits.length
  },
  enableOverrun: ready.enableOverrun,
  seedOverlap: false
});
writeJson(join(mw09Tmp(), "mw09-collect.json"), summary);
console.log(JSON.stringify(summary, null, 2));
