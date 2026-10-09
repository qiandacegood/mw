import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { emptyMw12KnownIds, knownIdCountOf, mw12Tmp, redactMw12 } from "./mw12-lib.mjs";

function hashId(id) {
  return createHash("sha256").update(String(id), "utf8").digest("hex");
}

function loadState() {
  const path = join(projectRoot(), "configs", "mw12-verify-state.json");
  if (!existsSync(path)) return { wroteDocs: false, knownIds: emptyMw12KnownIds() };
  return JSON.parse(readFileSync(path, "utf8"));
}

function docsFromFind(json) {
  const results = json?.data?.results;
  if (Array.isArray(results) && Array.isArray(results[0])) {
    return results[0].filter((item) => item && typeof item === "object" && (item._id || item.id));
  }
  const raw = json?.data?.results?.[0] || json?.data || json;
  const cursor = raw?.cursor || raw;
  const first = Array.isArray(cursor) ? cursor[0] : cursor;
  const batch = first?.cursor?.firstBatch || first?.firstBatch || first?.documents || first?.docs || [];
  if (Array.isArray(batch)) {
    return batch.filter((item) => item && typeof item === "object" && (item._id || item.id));
  }
  if (Array.isArray(raw)) return raw.filter((item) => item && typeof item === "object" && (item._id || item.id));
  return [];
}

async function findDocs(collection, filter = {}, limit = 200) {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([
      {
        TableName: collection,
        CommandType: "COMMAND",
        Command: JSON.stringify({ find: collection, filter, limit })
      }
    ]),
    "--json"
  ]);
  return docsFromFind(result.json);
}

function idOf(doc) {
  return typeof doc._id === "string" ? doc._id : typeof doc.id === "string" ? doc.id : "";
}

function hashSetOf(list) {
  return new Set((Array.isArray(list) ? list : []).filter((item) => typeof item === "string" && /^[0-9a-f]{64}$/i.test(item)));
}

const ready = await assertMwTestReady();
authorizedEnvId();
const state = loadState();
const hashes = {
  batches: hashSetOf(state.knownIds?.batches),
  rows: hashSetOf(state.knownIds?.rows),
  sourceKeys: hashSetOf(state.knownIds?.sourceKeys),
  questions: hashSetOf(state.knownIds?.questions),
  questionVersions: hashSetOf(state.knownIds?.questionVersions),
  papers: hashSetOf(state.knownIds?.papers),
  assets: hashSetOf(state.knownIds?.assets),
  tickets: hashSetOf(state.knownIds?.tickets)
};
const anyHash = Object.values(hashes).some((set) => set.size > 0);
if (!anyHash) {
  const empty = { wroteDocs: false, knownIds: emptyMw12KnownIds(), resolvedAt: new Date().toISOString() };
  writeFileSync(join(projectRoot(), "configs", "mw12-verify-state.json"), JSON.stringify(empty, null, 2), "utf8");
  console.log(JSON.stringify({ ok: true, wroteDocs: false, knownIdCount: 0 }, null, 2));
  process.exit(0);
}

function pick(docs, set) {
  return docs.map(idOf).filter((id) => id && set.has(hashId(id)));
}

const batchDocs = await findDocs("import_batches");
const batches = pick(batchDocs, hashes.batches);
const rowDocs = [];
const keyDocs = [];
const questionDocs = [];
const paperDocs = [];
for (const batchId of batches) {
  rowDocs.push(...(await findDocs("import_rows", { batchId })));
  keyDocs.push(...(await findDocs("source_keys", { batchId })));
  questionDocs.push(...(await findDocs("questions", { importBatchId: batchId })));
  paperDocs.push(...(await findDocs("papers", { importBatchId: batchId })));
}
const rows = [...new Set([...pick(rowDocs, hashes.rows.size ? hashes.rows : new Set(rowDocs.map((doc) => hashId(idOf(doc))))), ...rowDocs.map(idOf).filter(Boolean)])];
const sourceKeys = [...new Set(keyDocs.map(idOf).filter(Boolean))];
const questions = [...new Set(questionDocs.map(idOf).filter((id) => !hashes.questions.size || hashes.questions.has(hashId(id))))];
const qVersionDocs = [];
for (const questionId of questions) {
  qVersionDocs.push(...(await findDocs("question_versions", { questionId })));
}
const questionVersions = [...new Set(qVersionDocs.map(idOf).filter((id) => !hashes.questionVersions.size || hashes.questionVersions.has(hashId(id))))];
const papers = [...new Set(paperDocs.map(idOf).filter((id) => !hashes.papers.size || hashes.papers.has(hashId(id))))];
const assets = pick(await findDocs("media_assets", { kind: "import" }), hashes.assets);
const tickets = pick(await findDocs("upload_tickets", { purpose: "import" }), hashes.tickets);

const knownIds = {
  ...emptyMw12KnownIds(),
  batches,
  rows,
  sourceKeys,
  questions,
  questionVersions,
  papers,
  assets,
  tickets
};
const out = {
  wroteDocs: knownIdCountOf(knownIds) > 0,
  knownIds,
  resolvedAt: new Date().toISOString()
};
writeFileSync(join(projectRoot(), "configs", "mw12-verify-state.json"), JSON.stringify(out, null, 2), "utf8");
writeJson(join(mw12Tmp(), "mw12-resolve.json"), redactMw12({ wroteDocs: out.wroteDocs, knownIdCount: knownIdCountOf(knownIds) }));
console.log(JSON.stringify({ ok: true, wroteDocs: out.wroteDocs, knownIdCount: knownIdCountOf(knownIds) }, null, 2));
void ready;
