import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { listIndexCommand, parseNosqlCount } from "./mw06-lib.mjs";
import { seedCategoryIds } from "../packages/shared/dist/category.js";
import {
  FORBIDDEN_FUTURE_COLLECTIONS,
  MW17_COLLECTIONS,
  MW17_INDEXES,
  mw17IndependentDecision,
  mw17Tmp,
  redactMw17
} from "./mw17-lib.mjs";
import { countSnapshotResidual, resolveScopes, sweepDocs } from "./mw17-sweep-lib.mjs";

/**
 * MW17 独立核查（不依赖 knownIds / 不做 id 推导）：
 * 1. 只用用户提交的 SHA-256 反查真实 _id 与 (memberId, paperId)，再按关系精确统计残留；
 * 2. 额外核查本轮标记的测试身份是否还留在榜单快照 ranking_rows 里（快照本身不删除，
 *    收口时用后台「重建并发布榜单快照」让其自然消失）。
 * 只读：不做任何删除。
 *
 * 注意：cleanup 之前、重建之前运行本脚本出现非 0 残留属预期诊断结果。
 */

function loadState() {
  const path = join(projectRoot(), "configs", "mw17-verify-state.json");
  if (!existsSync(path)) return { wroteDocs: false, resolved: false, hashes: {}, knownIds: {} };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    hashes: parsed.hashes || {},
    knownIds: parsed.knownIds || {}
  };
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
  if (listedText.includes("categories") === false) return false;
  let count = 0;
  for (const seedId of seedCategoryIds()) {
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
  return count === seedCategoryIds().length;
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

const decision = mw17IndependentDecision({
  wroteDocs: state.wroteDocs,
  resolved: state.resolved,
  independentTotal: swept.total,
  snapshotResidual: snapshot.confirmed ? snapshot.total : -1,
  seedPresent,
  forbiddenPresent
});
const summary = {
  marker: "MW17",
  mode: "independent-by-member-paper-with-snapshot",
  wroteDocs: state.wroteDocs,
  resolved: state.resolved,
  scope: {
    memberCount: scopes.memberIds.length,
    markedPaperCount: scopes.markedPaperIds.length,
    scopedPaperCount: scopes.scopedPaperIds.length,
    attemptCount: scopes.attemptIds.length,
    memberPaperPairs: scopes.pairs.length
  },
  counts: swept.counts,
  total: swept.total,
  snapshotResidual: snapshot.total,
  snapshotResidualConfirmed: snapshot.confirmed,
  snapshotResidualByMemberHash: snapshot.counts,
  snapshotNote: "ranking_heads / ranking_rows 是派生共享快照，不删除；收口由后台重建快照让本轮身份自然消失",
  seedPresent,
  forbiddenPresent,
  rankingIndexPresent: indexPresent,
  enableOverrun: ready.enableOverrun,
  exactIdSweepOnly: true,
  derivedIdsUsed: false,
  ...decision
};
writeJson(join(mw17Tmp(), "mw17-independent-check.json"), redactMw17(summary));
console.log(JSON.stringify(redactMw17(summary), null, 2));
process.exit(decision.exitCode);
