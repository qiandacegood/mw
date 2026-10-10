import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { seedCategoryIds } from "../packages/shared/dist/category.js";
import {
  ATTEMPT_INDEXES,
  FORBIDDEN_FUTURE_COLLECTIONS,
  MW14_COLLECTIONS,
  emptyMw14KnownIds,
  knownIdCountOf,
  leftoverVerifyDecision,
  mw14Tmp
} from "./mw14-lib.mjs";

// 种子十类的真实 id 由 seedCategoryId(seedKey) 生成（哈希），不是字面 "seed-*"。
export const SEED_CATEGORY_IDS = seedCategoryIds();

// 承载种子与试卷树的真实集合；mw-test 上没有 sessions / rate_limits / maintenance_windows。
export const SEED_SUPPORT_COLLECTIONS = [
  "categories",
  "papers",
  "paper_versions",
  "paper_chunks",
  "paper_answers"
];

export function hashId(id) {
  return createHash("sha256").update(String(id), "utf8").digest("hex");
}

export function loadMw14VerifyState() {
  const path = join(projectRoot(), "configs", "mw14-verify-state.json");
  if (!existsSync(path)) {
    return { wroteDocs: false, resolved: false, leftoverObjectsConfirmed: false, knownIds: emptyMw14KnownIds() };
  }
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    leftoverObjectsConfirmed: parsed.leftoverObjectsConfirmed === true,
    knownIds: parsed.knownIds || emptyMw14KnownIds()
  };
}

export function leftoverCollectionsOf(knownIds) {
  return {
    attempts: knownIds.attempts || [],
    active_attempts: knownIds.activeAttempts || [],
    papers: knownIds.papers || [],
    paper_versions: knownIds.versions || [],
    paper_chunks: knownIds.chunks || [],
    paper_answers: knownIds.answers || []
  };
}

export function leftoverObjectIdsOf(knownIds) {
  return Array.isArray(knownIds.objects) ? knownIds.objects.filter(Boolean) : [];
}

export function verifyStateDirtyReason(state) {
  if (!state.wroteDocs) return "WROTE_DOCS_FALSE";
  if (!state.resolved) return "KNOWN_IDS_NOT_RESOLVED";
  if (knownIdCountOf(state.knownIds) === 0) return "EMPTY_KNOWN_IDS";
  return "";
}

export function leftoverDocsFromCounts(counts) {
  return Object.values(counts).reduce((sum, n) => sum + Number(n || 0), 0);
}

export function leftoverObjectsConfirmedOf(state, leftoverObjects) {
  return state.leftoverObjectsConfirmed === true && leftoverObjects === leftoverObjectIdsOf(state.knownIds).length;
}

export function leftoverVerifySummary({
  state,
  leftoverCounts,
  leftoverObjects,
  leftoverObjectsConfirmed,
  seedPresent,
  forbiddenPresent,
  indexesPresent,
  exactIdSweepOnly,
  cloudWriteClaimed
}) {
  const leftoverDocs = leftoverDocsFromCounts(leftoverCounts);
  const dirty = verifyStateDirtyReason(state);
  const decision = leftoverVerifyDecision({
    wroteDocs: state.wroteDocs,
    cloudWriteClaimed,
    exactIdSweepOnly,
    leftoverDocs,
    leftoverObjectsConfirmed,
    seedPresent,
    forbiddenPresent,
    dirtyReason: dirty
  });
  return {
    marker: "MW14",
    wroteDocs: state.wroteDocs,
    resolved: state.resolved,
    cloudWriteClaimed,
    exactIdSweepOnly,
    leftoverDocs,
    leftoverCounts,
    leftoverObjects,
    leftoverObjectsConfirmed,
    seedPresent,
    forbiddenPresent,
    indexesPresent,
    knownIdCount: knownIdCountOf(state.knownIds),
    collections: MW14_COLLECTIONS,
    forbiddenCollections: FORBIDDEN_FUTURE_COLLECTIONS,
    attemptIndexes: ATTEMPT_INDEXES,
    tmp: mw14Tmp(),
    ...decision
  };
}

export function parseCountResult(result) {
  return parseNosqlCount(result);
}

export { leftoverVerifyDecision };
