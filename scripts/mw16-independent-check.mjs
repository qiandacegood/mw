import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { listIndexCommand, parseNosqlCount } from "./mw06-lib.mjs";
import { seedCategoryIds } from "../packages/shared/dist/category.js";
import {
  FORBIDDEN_FUTURE_COLLECTIONS,
  MEDAL_GRANT_INDEXES,
  MW16_COLLECTIONS,
  mw16IndependentDecision,
  mw16Tmp,
  redactMw16
} from "./mw16-lib.mjs";
import { resolveScopes, sweepDocs } from "./mw16-sweep-lib.mjs";

/**
 * MW16 独立核查（不依赖 knownIds / 不做 id 推导）：
 * 只用用户提交的 SHA-256 反查真实 _id 与 (memberId, paperId)，再按关系精确统计残留。
 * 只读：不做任何删除。
 */

function loadState() {
  const path = join(projectRoot(), "configs", "mw16-verify-state.json");
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
      { TableName: MW16_COLLECTIONS[0], CommandType: "COMMAND", Command: JSON.stringify({ listCollections: 1 }) }
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

async function medalIndexPresent() {
  for (const index of MEDAL_GRANT_INDEXES) {
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
const listedText = await listCollectionsText();
const seedPresent = await seedTenPresent(listedText);
const forbiddenPresent = FORBIDDEN_FUTURE_COLLECTIONS.some((name) => listedText.includes(`"${name}"`));
const indexPresent = await medalIndexPresent();

const decision = mw16IndependentDecision({
  wroteDocs: state.wroteDocs,
  resolved: state.resolved,
  independentTotal: swept.total,
  seedPresent,
  forbiddenPresent
});
const summary = {
  marker: "MW16",
  mode: "independent-by-member-paper",
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
  seedPresent,
  forbiddenPresent,
  medalIndexPresent: indexPresent,
  enableOverrun: ready.enableOverrun,
  exactIdSweepOnly: true,
  derivedIdsUsed: false,
  ...decision
};
writeJson(join(mw16Tmp(), "mw16-independent-check.json"), redactMw16(summary));
console.log(JSON.stringify(redactMw16(summary), null, 2));
process.exit(decision.exitCode);
