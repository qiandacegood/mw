import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, writeJson } from "./mw04-lib.mjs";
import { emptyMw16KnownIds, knownIdCountOf, mw16Tmp, redactMw16 } from "./mw16-lib.mjs";
import { deleteExact, hashId, resolveScopes, sweepDocs } from "./mw16-sweep-lib.mjs";

/**
 * 两条独立路径同时收口：
 * 1. 已解析 knownIds（含 resolve 推导 id）；
 * 2. 按 memberId / paperId 关系精确读到的真实 _id（不依赖 knownIds，也不做 id 推导）。
 * 去重后按真实 _id 精确删除；不扫整表猜删；不删 members / member_stats / identities / categories。
 */

function loadState() {
  const path = join(projectRoot(), "configs", "mw16-verify-state.json");
  if (!existsSync(path)) return { wroteDocs: false, resolved: false, knownIds: emptyMw16KnownIds(), hashes: {} };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    knownIds: parsed.knownIds || emptyMw16KnownIds(),
    hashes: parsed.hashes || {}
  };
}

/** 不含 members / member_stats / identities：会员账号与总分永不删除（本人身份只用于锚定关系核查）。 */
const COLLECTION_OF_KNOWN_ID_KEY = {
  metrics: "score_metrics",
  events: "score_events",
  bests: "paper_bests",
  grants: "medal_grants",
  activeAttempts: "active_attempts",
  attempts: "attempts",
  answers: "paper_answers",
  chunks: "paper_chunks",
  versions: "paper_versions",
  papers: "papers",
  questions: "questions",
  questionVersions: "question_versions",
  assets: "assets"
};
const PROTECTED_COLLECTIONS = new Set(["members", "member_stats", "identities", "categories"]);

const ready = await assertMwTestReady();
authorizedEnvId();
const state = loadState();
const knownIdCount = knownIdCountOf(state.knownIds);
if (!state.wroteDocs || knownIdCount === 0) {
  const summary = {
    marker: "MW16",
    enableOverrun: ready.enableOverrun,
    deleted: 0,
    failed: 1,
    exactIdsOnly: true,
    wroteDocs: state.wroteDocs,
    reason: "KNOWN_IDS_NOT_RESOLVED"
  };
  writeJson(join(mw16Tmp(), "mw16-cleanup.json"), redactMw16(summary));
  console.log(JSON.stringify(redactMw16(summary), null, 2));
  process.exit(1);
}

const targets = new Map();
function addTarget(collection, id) {
  if (!id || PROTECTED_COLLECTIONS.has(collection)) return;
  if (!targets.has(collection)) targets.set(collection, new Set());
  targets.get(collection).add(id);
}

for (const [key, collection] of Object.entries(COLLECTION_OF_KNOWN_ID_KEY)) {
  for (const id of state.knownIds[key] || []) addTarget(collection, id);
}

const scopes = await resolveScopes(state.hashes);
const swept = await sweepDocs(scopes);
for (const [collection, rows] of Object.entries(swept.docs)) {
  for (const row of rows) addTarget(collection, typeof row._id === "string" ? row._id : "");
}

const deleted = [];
for (const [collection, ids] of targets) {
  for (const id of ids) {
    const result = await deleteExact(collection, id);
    deleted.push({ collection, ok: result.ok, idHash: hashId(id).slice(0, 12), code: result.code });
  }
}

const after = await sweepDocs(scopes);
const summary = {
  marker: "MW16",
  enableOverrun: ready.enableOverrun,
  targetCount: [...targets.values()].reduce((sum, set) => sum + set.size, 0),
  deleted: deleted.length,
  failed: deleted.filter((item) => !item.ok).length,
  exactIdsOnly: true,
  wroteDocs: state.wroteDocs,
  knownIdCount,
  independentBefore: swept.counts,
  independentBeforeTotal: swept.total,
  independentAfter: after.counts,
  independentAfterTotal: after.total,
  independentScopes: {
    members: scopes.memberIds.length,
    markedPapers: scopes.markedPaperIds.length,
    scopedPapers: scopes.scopedPaperIds.length,
    attempts: scopes.attemptIds.length,
    pairs: scopes.pairs.length
  }
};
writeJson(join(mw16Tmp(), "mw16-cleanup.json"), redactMw16(summary));
console.log(JSON.stringify(redactMw16(summary), null, 2));
if (summary.failed) process.exit(1);
