import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import {
  emptyMw15KnownIds,
  isSha256Hex,
  knownIdCountOf,
  leftoverResolveDecision,
  mw15Tmp,
  parseLeftoverHashes,
  redactMw15
} from "./mw15-lib.mjs";
import {
  categoryMetricIdsOf,
  METRIC_GENERATION_BASE,
  paperBestId,
  scoreEventId,
  scoreMetricId
} from "../packages/shared/dist/scoring.js";
import { monthKeyShanghai, weekKeyShanghai } from "../packages/shared/dist/clock.js";

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
  const summary = redactMw15({ ok: false, reason, ...extra });
  writeJson(join(mw15Tmp(), "mw15-resolve.json"), summary);
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

async function countQuery(collection, query = {}) {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([{ TableName: collection, CommandType: "COMMAND", Command: JSON.stringify({ count: collection, query }) }]),
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
    JSON.stringify([{ TableName: collection, CommandType: "COMMAND", Command: JSON.stringify(command) }]),
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

const statePath = join(projectRoot(), "configs", "mw15-verify-state.json");
if (!existsSync(statePath)) {
  console.error("missing configs/mw15-verify-state.json");
  process.exit(1);
}
const state = JSON.parse(readFileSync(statePath, "utf8"));
const hashSource = {
  papers: Array.isArray(state.hashes?.papers) ? state.hashes.papers : [],
  attempts: Array.isArray(state.hashes?.attempts) ? state.hashes.attempts : []
};
if (!hashSource.papers.length && Array.isArray(state.knownIds?.papers)) {
  hashSource.papers = state.knownIds.papers.filter((item) => isSha256Hex(item));
}
if (!hashSource.attempts.length && Array.isArray(state.knownIds?.attempts)) {
  hashSource.attempts = state.knownIds.attempts.filter((item) => isSha256Hex(item));
}
const parsedHashes = parseLeftoverHashes(hashSource);
if (!parsedHashes.ok) {
  fail(parsedHashes.reason, { importedHashCount: 0, matchedIdCount: 0 });
}

await assertMwTestReady();
authorizedEnvId();

const paperIds = [];
if (parsedHashes.papers.length) {
  const paperScan = await findAll("papers", {}, { _id: 1, categoryId: 1 });
  if (!paperScan.ok) fail(paperScan.reason, { importedHashCount: parsedHashes.papers.length + parsedHashes.attempts.length });
  paperIds.push(...paperScan.docs.map(idOf).filter((id) => id && parsedHashes.papers.includes(hashId(id))));
}

const attemptDocs = [];
if (parsedHashes.attempts.length) {
  const attemptScan = await findAll("attempts", {}, {
    _id: 1,
    attemptId: 1,
    memberId: 1,
    paperId: 1,
    gradeRevision: 1,
    submittedAt: 1
  });
  if (!attemptScan.ok) fail(attemptScan.reason, { importedHashCount: parsedHashes.papers.length + parsedHashes.attempts.length });
  for (const doc of attemptScan.docs) {
    const id = idOf(doc);
    if (id && parsedHashes.attempts.includes(hashId(id))) attemptDocs.push(doc);
  }
}

const attemptIds = attemptDocs.map(idOf).filter(Boolean);
const importedHashCount = parsedHashes.papers.length + parsedHashes.attempts.length;
const matchedIdCount = paperIds.length + attemptIds.length;
const resolveGate = leftoverResolveDecision({
  importedHashCount,
  matchedIdCount,
  scanComplete: true
});
if (!resolveGate.ok) {
  fail(resolveGate.reason, { importedHashCount, matchedPaperCount: paperIds.length, matchedAttemptCount: attemptIds.length });
}

const versions = [];
for (const paperId of paperIds) {
  const versionScan = await findAll("paper_versions", { paperId }, { _id: 1, chunkIds: 1, answerChunkIds: 1 });
  if (!versionScan.ok) fail(versionScan.reason, { importedHashCount, matchedIdCount });
  versions.push(...versionScan.docs);
}
const versionIds = [...new Set(versions.map(idOf).filter(Boolean))];
const chunkIds = [...new Set(versions.flatMap((doc) => (Array.isArray(doc.chunkIds) ? doc.chunkIds : [])).filter(Boolean))];
const answerIds = [
  ...new Set(versions.flatMap((doc) => (Array.isArray(doc.answerChunkIds) ? doc.answerChunkIds : [])).filter(Boolean))
];

const activeIds = [];
if (attemptIds.length) {
  const activeScan = await findAll("active_attempts", {}, { _id: 1, attemptId: 1 });
  if (!activeScan.ok) fail(activeScan.reason, { importedHashCount, matchedIdCount });
  const wanted = new Set(attemptIds);
  for (const doc of activeScan.docs) {
    if (wanted.has(String(doc.attemptId || ""))) activeIds.push(idOf(doc));
  }
}

const bestIds = [];
const eventIds = [];
const metricIds = [];
for (const doc of attemptDocs) {
  const memberId = String(doc.memberId || "");
  const paperId = String(doc.paperId || "");
  const attemptId = idOf(doc);
  const gradeRevision = Number(doc.gradeRevision || 1);
  if (memberId && paperId) bestIds.push(paperBestId(memberId, paperId));
  if (attemptId) eventIds.push(scoreEventId(attemptId, gradeRevision));
  if (memberId && paperId) {
    const paperScan = await findAll("papers", { _id: paperId }, { _id: 1, categoryId: 1 });
    if (!paperScan.ok) fail(paperScan.reason, { importedHashCount, matchedIdCount });
    const categoryId = String(paperScan.docs[0]?.categoryId || "");
    let ancestorIds = [];
    if (categoryId) {
      const catScan = await findAll("categories", { _id: categoryId }, { _id: 1, ancestorIds: 1 });
      if (!catScan.ok) fail(catScan.reason, { importedHashCount, matchedIdCount });
      ancestorIds = Array.isArray(catScan.docs[0]?.ancestorIds) ? catScan.docs[0].ancestorIds.filter(Boolean) : [];
    }
    const submittedAt = doc.submittedAt ? new Date(String(doc.submittedAt)) : new Date();
    const weekKey = weekKeyShanghai(submittedAt);
    const monthKey = monthKeyShanghai(submittedAt);
    const specs = [
      { scope: "total", periodKey: "all", categoryId: "" },
      { scope: "week", periodKey: weekKey, categoryId: "" },
      { scope: "month", periodKey: monthKey, categoryId: "" },
      ...categoryMetricIdsOf(categoryId, ancestorIds).map((id) => ({ scope: "category", periodKey: "all", categoryId: id }))
    ];
    for (const spec of specs) {
      metricIds.push(
        scoreMetricId({
          metricGeneration: METRIC_GENERATION_BASE,
          scope: spec.scope,
          periodKey: spec.periodKey,
          categoryId: spec.categoryId,
          memberId
        })
      );
    }
  }
}

const knownIds = {
  ...emptyMw15KnownIds(),
  attempts: attemptIds,
  activeAttempts: [...new Set(activeIds.filter(Boolean))],
  papers: paperIds,
  versions: versionIds,
  chunks: chunkIds,
  answers: answerIds,
  bests: [...new Set(bestIds.filter(Boolean))],
  events: [...new Set(eventIds.filter(Boolean))],
  metrics: [...new Set(metricIds.filter(Boolean))],
  objects: []
};
const next = {
  wroteDocs: true,
  resolved: true,
  hashesOnly: true,
  hashes: { papers: parsedHashes.papers, attempts: parsedHashes.attempts },
  knownIds,
  resolvedAt: new Date().toISOString(),
  matchedPaperCount: paperIds.length,
  matchedAttemptCount: attemptIds.length,
  leftoverObjectsConfirmed: true
};
writeJson(statePath, next);
const summary = {
  ok: true,
  importedHashCount,
  matchedPaperCount: paperIds.length,
  matchedAttemptCount: attemptIds.length,
  knownIdCount: knownIdCountOf(knownIds),
  counts: {
    attempts: attemptIds.length,
    activeAttempts: knownIds.activeAttempts.length,
    papers: paperIds.length,
    versions: versionIds.length,
    chunks: chunkIds.length,
    answers: answerIds.length,
    bests: knownIds.bests.length,
    events: knownIds.events.length,
    metrics: knownIds.metrics.length,
    objects: knownIds.objects.length
  }
};
writeJson(join(mw15Tmp(), "mw15-resolve.json"), redactMw15(summary));
console.log(JSON.stringify(summary, null, 2));
