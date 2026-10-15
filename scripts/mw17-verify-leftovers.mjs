import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { listIndexCommand, parseNosqlCount } from "./mw06-lib.mjs";
import { seedCategoryIds } from "../packages/shared/dist/category.js";
import {
  FORBIDDEN_FUTURE_COLLECTIONS,
  MW17_COLLECTIONS,
  MW17_INDEXES,
  emptyMw17KnownIds,
  knownIdCountOf,
  mw17Tmp,
  mw17VerifyDecision,
  redactMw17
} from "./mw17-lib.mjs";
import { countSnapshotResidual, resolveScopes, sweepDocs } from "./mw17-sweep-lib.mjs";

/**
 * leftover 收口核验：三条互相独立的路径都必须为 0。
 * - knownIds 路径：resolve 出来的 id 逐个点查。
 * - 独立路径：按 memberId / paperId 关系精确统计（不依赖 knownIds，不做 id 推导）。
 * - 快照路径：本轮标记的测试身份不得再出现在 ranking_rows（收口末尾重建快照后应自然消失）。
 */

function loadState() {
  const path = join(projectRoot(), "configs", "mw17-verify-state.json");
  if (!existsSync(path)) {
    return { wroteDocs: false, resolved: false, knownIds: emptyMw17KnownIds(), hashes: {} };
  }
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    knownIds: parsed.knownIds || emptyMw17KnownIds(),
    hashes: parsed.hashes || {}
  };
}

/**
 * 计入 leftoverDocs 的集合。
 * 刻意不含 members / member_stats / identities：会员账号与总分是真实数据，永不删除，
 * 也永远不作为 leftover 计数（本人身份只用于锚定按 member 的关系核查）。
 * 也不含 ranking_heads / ranking_rows / app_config：派生共享快照，单独按"成员是否残留"核查。
 */
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

async function countExact(collection, ids) {
  let leftover = 0;
  for (const id of ids) {
    const result = await runTcb([
      "db",
      "nosql",
      "execute",
      "--command",
      JSON.stringify([
        { TableName: collection, CommandType: "COMMAND", Command: JSON.stringify({ count: collection, query: { _id: id } }) }
      ]),
      "--json"
    ]);
    leftover += parseNosqlCount(result) || 0;
  }
  return leftover;
}

async function listCollectionsText() {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([
      { TableName: MW17_COLLECTIONS[0], CommandType: "COMMAND", Command: JSON.stringify({ listCollections: 1 }) }
    ]),
    "--json"
  ]);
  return result.code === 0 ? JSON.stringify(result.json || {}) : "";
}

async function seedTenPresent(listedText) {
  if (!listedText.includes("categories")) return false;
  const ids = seedCategoryIds();
  let count = 0;
  for (const seedId of ids) {
    const counted = await runTcb([
      "db",
      "nosql",
      "execute",
      "--command",
      JSON.stringify([
        {
          TableName: "categories",
          CommandType: "COMMAND",
          Command: JSON.stringify({ count: "categories", query: { _id: seedId } })
        }
      ]),
      "--json"
    ]);
    if (parseNosqlCount(counted) === 1) count += 1;
  }
  return count === ids.length;
}

async function rankingIndexPresent() {
  for (const index of MW17_INDEXES) {
    const result = await runTcb([
      "db",
      "nosql",
      "execute",
      "--command",
      JSON.stringify([listIndexCommand(index.collection)]),
      "--json"
    ]);
    if (result.code !== 0 || !JSON.stringify(result.json || {}).includes(index.name)) return false;
  }
  return true;
}

const ready = await assertMwTestReady();
authorizedEnvId();
const state = loadState();

const knownIdCounts = {};
for (const [key, collection] of Object.entries(COLLECTION_OF_KNOWN_ID_KEY)) {
  const ids = state.knownIds[key] || [];
  if (!ids.length) continue;
  knownIdCounts[collection] = await countExact(collection, ids);
}
const knownIdLeftoverDocs = Object.values(knownIdCounts).reduce((sum, value) => sum + value, 0);

const hashes = {
  papers: Array.isArray(state.hashes?.papers) ? state.hashes.papers : [],
  attempts: Array.isArray(state.hashes?.attempts) ? state.hashes.attempts : [],
  members: Array.isArray(state.hashes?.members) ? state.hashes.members : []
};
const scopes = await resolveScopes(hashes);
const swept = await sweepDocs(scopes);
const snapshot = await countSnapshotResidual(scopes.memberIds);

const listedText = await listCollectionsText();
const seedPresent = await seedTenPresent(listedText);
const forbiddenPresent = FORBIDDEN_FUTURE_COLLECTIONS.some((name) => listedText.includes(`"${name}"`));
const indexPresent = await rankingIndexPresent();

const dirtyReason = !state.wroteDocs
  ? "WROTE_DOCS_FALSE"
  : !state.resolved
    ? "KNOWN_IDS_NOT_RESOLVED"
    : knownIdCountOf(state.knownIds) === 0
      ? "EMPTY_KNOWN_IDS"
      : "";

const decision = mw17VerifyDecision({
  wroteDocs: state.wroteDocs,
  cloudWriteClaimed: state.wroteDocs,
  exactIdSweepOnly: true,
  knownIdLeftoverDocs,
  independentTotal: swept.total,
  independentConfirmed: true,
  snapshotResidual: snapshot.confirmed ? snapshot.total : -1,
  snapshotConfirmed: snapshot.confirmed,
  seedPresent,
  forbiddenPresent,
  dirtyReason
});

const summary = {
  marker: "MW17",
  wroteDocs: state.wroteDocs,
  resolved: state.resolved,
  cloudWriteClaimed: state.wroteDocs,
  exactIdSweepOnly: true,
  knownIdCount: knownIdCountOf(state.knownIds),
  knownIdLeftoverDocs,
  knownIdCounts,
  independentCounts: swept.counts,
  independentTotal: swept.total,
  independentScope: {
    members: scopes.memberIds.length,
    markedPapers: scopes.markedPaperIds.length,
    scopedPapers: scopes.scopedPaperIds.length,
    attempts: scopes.attemptIds.length,
    memberPaperPairs: scopes.pairs.length
  },
  snapshotResidual: snapshot.total,
  snapshotResidualConfirmed: snapshot.confirmed,
  snapshotResidualByMemberHash: snapshot.counts,
  snapshotNote: "快照不删除；重建并发布后本轮测试身份不应再出现在 ranking_rows",
  seedPresent,
  forbiddenPresent,
  rankingIndexPresent: indexPresent,
  enableOverrun: ready.enableOverrun,
  ...decision
};
writeJson(join(mw17Tmp(), "mw17-leftover-verify.json"), redactMw17(summary));
console.log(JSON.stringify(redactMw17(summary), null, 2));
if (!summary.ok) process.exit(1);
