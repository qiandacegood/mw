import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, redact } from "./mw04-lib.mjs";
import { createCollectionCommand, createIndexCommand, listIndexCommand, redactMw06 } from "./mw06-lib.mjs";
import { leftoverResolveDecision, isSha256Hex } from "./mw13-lib.mjs";
import { INITIAL_ROOT_SEEDS } from "./mw09-lib.mjs";

export const MW14_DEPLOY_ENTRIES = ["mw-member"];
export const MW14_COLLECTIONS = ["attempts", "active_attempts"];
export const MW14_KEEP_COLLECTIONS = [
  "papers",
  "paper_versions",
  "paper_chunks",
  "paper_answers",
  "categories",
  "members",
  "identities",
  "member_stats",
  "idempotency"
];
export const FORBIDDEN_FUTURE_COLLECTIONS = [
  "paper_bests",
  "score_events",
  "score_metrics",
  "orders",
  "vip_accounts",
  "vip_plans",
  "vip_grants",
  "vip_events"
];
export const ATTEMPT_INDEXES = [
  {
    collection: "attempts",
    name: "idx_attempts_member_state_submitted_id",
    keys: [
      { name: "memberId", direction: 1 },
      { name: "state", direction: 1 },
      { name: "submittedAt", direction: -1 },
      { name: "_id", direction: 1 }
    ]
  }
];

export { INITIAL_ROOT_SEEDS, leftoverResolveDecision, isSha256Hex, createCollectionCommand, createIndexCommand, listIndexCommand };

export function mw14Tmp() {
  const dir = join(projectRoot(), "tmp", "mw14");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function redactMw14(value) {
  return redactMw06(redact(value));
}

export function emptyMw14KnownIds() {
  return {
    attempts: [],
    activeAttempts: [],
    papers: [],
    versions: [],
    chunks: [],
    answers: [],
    objects: []
  };
}

export function knownIdCountOf(knownIds) {
  const ids = knownIds && typeof knownIds === "object" ? knownIds : emptyMw14KnownIds();
  return Object.keys(emptyMw14KnownIds()).reduce(
    (sum, key) => sum + (Array.isArray(ids[key]) ? ids[key].length : 0),
    0
  );
}

export function parseLeftoverHashes(incoming) {
  const source = incoming && typeof incoming === "object" && !Array.isArray(incoming) ? incoming : {};
  const papers = Array.isArray(source.papers) ? source.papers : [];
  const attempts = Array.isArray(source.attempts) ? source.attempts : [];
  if (!papers.length && !attempts.length) {
    return { ok: false, reason: "EMPTY_HASHES", papers: [], attempts: [] };
  }
  const outPapers = [];
  const outAttempts = [];
  for (const item of papers) {
    if (!isSha256Hex(item)) return { ok: false, reason: "HASH_NOT_SHA256", papers: [], attempts: [] };
    outPapers.push(String(item).toLowerCase());
  }
  for (const item of attempts) {
    if (!isSha256Hex(item)) return { ok: false, reason: "HASH_NOT_SHA256", papers: [], attempts: [] };
    outAttempts.push(String(item).toLowerCase());
  }
  return {
    ok: true,
    reason: "",
    papers: [...new Set(outPapers)],
    attempts: [...new Set(outAttempts)]
  };
}

export function mw14LeftoverDecision(state) {
  const collectionNames = Array.isArray(state.collectionNames) ? state.collectionNames : null;
  const leftoverDocs =
    typeof state.testDocCount === "number" && Number.isFinite(state.testDocCount) ? state.testDocCount : null;
  const leftoverObjectsConfirmed = state.leftoverObjectsConfirmed === true;
  const leftoverObjects =
    leftoverObjectsConfirmed && typeof state.leftoverObjects === "number" && Number.isFinite(state.leftoverObjects)
      ? state.leftoverObjects
      : null;
  const seedPresent = state.seedPresent === true;
  const seedCount = typeof state.seedCount === "number" ? state.seedCount : 0;
  const clientDenied = state.clientDenied === true;
  const collectionsConfirmed = state.collectionsConfirmed === true && collectionNames !== null;
  const testDocsConfirmed = state.testDocsConfirmed === true && leftoverDocs !== null;
  const enableOverrunConfirmed = state.enableOverrunConfirmed === true && typeof state.enableOverrun === "boolean";
  const overrun = state.enableOverrun === true;
  const wroteDocs = state.wroteDocs === true;
  const knownIdCount =
    typeof state.knownIdCount === "number" && Number.isFinite(state.knownIdCount)
      ? state.knownIdCount
      : knownIdCountOf(state.knownIds);
  const futureCreated = state.futureCollectionsCreated === true;
  const indexConfirmed = state.indexConfirmed === true;
  const reasons = [];
  if (!wroteDocs) reasons.push("WROTE_DOCS_FALSE");
  if (wroteDocs && knownIdCount === 0) reasons.push("KNOWN_IDS_MISSING_AFTER_WRITE");
  if (wroteDocs && !testDocsConfirmed) reasons.push("TEST_DOCS_NOT_CONFIRMED");
  if (wroteDocs && testDocsConfirmed && leftoverDocs !== 0) reasons.push("TEST_DOCS_LEFT");
  if (!leftoverObjectsConfirmed || leftoverObjects === null) reasons.push("TEST_OBJECTS_NOT_CONFIRMED");
  if (leftoverObjectsConfirmed && leftoverObjects !== 0) reasons.push("TEST_OBJECTS_LEFT");
  if (state.clientDenied !== true) reasons.push("CLIENT_WRITE_NOT_DENIED");
  if (!collectionsConfirmed) reasons.push("COLLECTIONS_MISSING");
  if (collectionsConfirmed && collectionNames && MW14_COLLECTIONS.some((name) => !collectionNames.includes(name))) {
    reasons.push("COLLECTIONS_MISSING");
  }
  if (!indexConfirmed) reasons.push("INDEX_NOT_CONFIRMED");
  if (!seedPresent || seedCount !== 10) reasons.push("SEED_ROOTS_MISSING");
  if (!enableOverrunConfirmed) reasons.push("OVERRUN_NOT_CONFIRMED");
  if (enableOverrunConfirmed && overrun) reasons.push("OVERRUN_ENABLED");
  if (state.otherEnvChanged === true) reasons.push("OTHER_ENV_CHANGED");
  if (futureCreated) reasons.push("FUTURE_COLLECTIONS_CREATED");
  return {
    ok: reasons.length === 0,
    exitCode: reasons.length === 0 ? 0 : 1,
    reasons,
    leftoverDocs: leftoverDocs === null ? -1 : leftoverDocs,
    leftoverObjects: leftoverObjects === null ? -1 : leftoverObjects,
    leftoverObjectsConfirmed,
    seedPresent,
    seedCount,
    enableOverrun: Boolean(state.enableOverrun),
    clientDenied,
    collectionsConfirmed,
    testDocsConfirmed,
    enableOverrunConfirmed,
    wroteDocs,
    cloudWriteClaimed: wroteDocs,
    exactIdSweepOnly: true,
    knownIdCount,
    indexConfirmed
  };
}

export function leftoverVerifyDecision({
  wroteDocs,
  cloudWriteClaimed,
  exactIdSweepOnly,
  leftoverDocs,
  leftoverObjectsConfirmed,
  seedPresent,
  forbiddenPresent,
  dirtyReason
} = {}) {
  const reasons = [];
  if (dirtyReason) reasons.push(String(dirtyReason));
  if (wroteDocs !== true) reasons.push("WROTE_DOCS_FALSE");
  if (cloudWriteClaimed !== true) reasons.push("CLOUD_WRITE_NOT_CLAIMED");
  if (exactIdSweepOnly !== true) reasons.push("EXACT_ID_SWEEP_REQUIRED");
  if (typeof leftoverDocs !== "number" || !Number.isFinite(leftoverDocs)) {
    reasons.push("TEST_DOCS_NOT_CONFIRMED");
  } else if (leftoverDocs !== 0) {
    reasons.push("TEST_DOCS_LEFT");
  }
  if (leftoverObjectsConfirmed !== true) reasons.push("TEST_OBJECTS_NOT_CONFIRMED");
  if (seedPresent !== true) reasons.push("SEED_ROOTS_MISSING");
  if (forbiddenPresent === true) reasons.push("FORBIDDEN_COLLECTIONS_PRESENT");
  const unique = [...new Set(reasons)];
  return {
    ok: unique.length === 0,
    exitCode: unique.length === 0 ? 0 : 1,
    reasons: unique
  };
}
