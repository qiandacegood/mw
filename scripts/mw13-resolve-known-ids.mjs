import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import {
  emptyMw13KnownIds,
  isSha256Hex,
  knownIdCountOf,
  leftoverResolveDecision,
  mw13Tmp,
  parseLeftoverPaperHashes,
  redactMw13
} from "./mw13-lib.mjs";

const PAGE_SIZE = 50;

function hashId(id) {
  return createHash("sha256").update(String(id), "utf8").digest("hex");
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

function idOf(doc) {
  return typeof doc._id === "string" ? doc._id : typeof doc.id === "string" ? doc.id : "";
}

function fail(reason, extra = {}) {
  const summary = redactMw13({ ok: false, reason, ...extra });
  writeJson(join(mw13Tmp(), "mw13-resolve.json"), summary);
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

async function countQuery(collection, query = {}) {
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

async function findPage(collection, filter, skip, limit, projection) {
  const command = { find: collection, filter, limit, skip };
  if (projection) command.projection = projection;
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([
      {
        TableName: collection,
        CommandType: "COMMAND",
        Command: JSON.stringify(command)
      }
    ]),
    "--json"
  ]);
  return docsFromFind(result.json);
}

async function findAll(collection, filter = {}, projection = { _id: 1 }) {
  const total = await countQuery(collection, filter);
  if (total === null) return { ok: false, reason: "SCAN_INCOMPLETE", docs: [] };
  const docs = [];
  const seen = new Set();
  for (let skip = 0; skip < total; skip += PAGE_SIZE) {
    const page = await findPage(collection, filter, skip, PAGE_SIZE, projection);
    for (const doc of page) {
      const id = idOf(doc);
      if (id && !seen.has(id)) {
        seen.add(id);
        docs.push(doc);
      }
    }
    if (page.length === 0) break;
  }
  if (docs.length < total) return { ok: false, reason: "SCAN_INCOMPLETE", docs };
  return { ok: true, docs };
}

const statePath = join(projectRoot(), "configs", "mw13-verify-state.json");
if (!existsSync(statePath)) {
  console.error("missing configs/mw13-verify-state.json");
  process.exit(1);
}
const state = JSON.parse(readFileSync(statePath, "utf8"));
const hashSource = Array.isArray(state.hashes?.papers) && state.hashes.papers.length
  ? state.hashes.papers
  : (Array.isArray(state.knownIds?.papers) ? state.knownIds.papers : []).filter((item) => isSha256Hex(item));
const parsedHashes = parseLeftoverPaperHashes({ papers: hashSource });
if (!parsedHashes.ok) {
  fail(parsedHashes.reason, { importedHashCount: 0, matchedPaperCount: 0 });
}
const paperHashes = parsedHashes.hashes;

await assertMwTestReady();
authorizedEnvId();

const paperScan = await findAll("papers", {}, { _id: 1 });
if (!paperScan.ok) {
  fail(paperScan.reason, { importedHashCount: paperHashes.length, matchedPaperCount: 0 });
}

const paperIds = [
  ...new Set(paperScan.docs.map(idOf).filter((id) => id && paperHashes.includes(hashId(id))))
];
const resolveGate = leftoverResolveDecision({
  importedHashCount: paperHashes.length,
  matchedIdCount: paperIds.length,
  scanComplete: true
});
if (!resolveGate.ok) {
  fail(resolveGate.reason, {
    importedHashCount: paperHashes.length,
    matchedPaperCount: paperIds.length
  });
}

const versions = [];
for (const paperId of paperIds) {
  const versionScan = await findAll("paper_versions", { paperId }, { _id: 1, chunkIds: 1, answerChunkIds: 1 });
  if (!versionScan.ok) {
    fail(versionScan.reason, { importedHashCount: paperHashes.length, matchedPaperCount: paperIds.length });
  }
  versions.push(...versionScan.docs);
}
const versionIds = [...new Set(versions.map(idOf).filter(Boolean))];
const chunkIds = [
  ...new Set(versions.flatMap((doc) => (Array.isArray(doc.chunkIds) ? doc.chunkIds : [])).filter(Boolean))
];
const answerIds = [
  ...new Set(versions.flatMap((doc) => (Array.isArray(doc.answerChunkIds) ? doc.answerChunkIds : [])).filter(Boolean))
];

const knownIds = {
  ...emptyMw13KnownIds(),
  papers: paperIds,
  versions: versionIds,
  chunks: chunkIds,
  answers: answerIds,
  objects: []
};
const next = {
  wroteDocs: true,
  resolved: true,
  hashesOnly: true,
  hashes: { papers: paperHashes },
  knownIds,
  resolvedAt: new Date().toISOString(),
  matchedPaperCount: paperIds.length,
  leftoverObjectsConfirmed: true
};
writeJson(statePath, next);
const summary = {
  ok: true,
  matchedPaperCount: paperIds.length,
  importedHashCount: paperHashes.length,
  knownIdCount: knownIdCountOf(knownIds),
  counts: {
    papers: paperIds.length,
    versions: versionIds.length,
    chunks: chunkIds.length,
    answers: answerIds.length,
    objects: 0
  }
};
writeJson(join(mw13Tmp(), "mw13-resolve.json"), redactMw13(summary));
console.log(JSON.stringify(summary, null, 2));
