import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { seedCategoryIds } from "../packages/shared/dist/category.js";
import {
  SCORE_INDEXES,
  FORBIDDEN_FUTURE_COLLECTIONS,
  MW15_COLLECTIONS,
  emptyMw15KnownIds,
  knownIdCountOf,
  leftoverVerifyDecision,
  mw15Tmp
} from "./mw15-lib.mjs";

export const SEED_CATEGORY_IDS = seedCategoryIds();

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

export function loadMw15VerifyState() {
  const path = join(projectRoot(), "configs", "mw15-verify-state.json");
  if (!existsSync(path)) {
    return { wroteDocs: false, resolved: false, leftoverObjectsConfirmed: false, knownIds: emptyMw15KnownIds() };
  }
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    wroteDocs: parsed.wroteDocs === true,
    resolved: parsed.resolved === true,
    leftoverObjectsConfirmed: parsed.leftoverObjectsConfirmed === true,
    knownIds: parsed.knownIds || emptyMw15KnownIds()
  };
}

export function leftoverCollectionsOf(knownIds) {
  return {
    attempts: knownIds.attempts || [],
    active_attempts: knownIds.activeAttempts || [],
    papers: knownIds.papers || [],
    paper_versions: knownIds.versions || [],
    paper_chunks: knownIds.chunks || [],
    paper_answers: knownIds.answers || [],
    paper_bests: knownIds.bests || [],
    score_events: knownIds.events || [],
    score_metrics: knownIds.metrics || []
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
    marker: "MW15",
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
    collections: MW15_COLLECTIONS,
    forbiddenCollections: FORBIDDEN_FUTURE_COLLECTIONS,
    scoreIndexes: SCORE_INDEXES,
    tmp: mw15Tmp(),
    ...decision
  };
}

export function parseCountResult(result) {
  return parseNosqlCount(result);
}

export { leftoverVerifyDecision };
