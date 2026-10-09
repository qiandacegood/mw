import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, redact } from "./mw04-lib.mjs";
import { redactMw06 } from "./mw06-lib.mjs";
import { INITIAL_ROOT_SEEDS } from "./mw09-lib.mjs";

export const MW13_DEPLOY_ENTRIES = ["mw-public", "mw-member"];
export const MW13_COLLECTIONS = ["papers", "paper_versions", "paper_chunks", "paper_answers", "categories"];
export const FORBIDDEN_FUTURE_COLLECTIONS = [
  "attempts",
  "paper_bests",
  "orders",
  "vip_accounts",
  "vip_plans",
  "vip_grants",
  "vip_events"
];

export { INITIAL_ROOT_SEEDS };

export function mw13Tmp() {
  const dir = join(projectRoot(), "tmp", "mw13");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function redactMw13(value) {
  return redactMw06(redact(value));
}

export function emptyMw13KnownIds() {
  return {
    papers: [],
    versions: [],
    chunks: [],
    answers: [],
    objects: []
  };
}

export function isSha256Hex(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

export function parseLeftoverPaperHashes(incoming) {
  const raw = Array.isArray(incoming) ? incoming : incoming && typeof incoming === "object" ? incoming.papers : null;
  if (!Array.isArray(raw)) {
    return { ok: false, reason: "HASH_NOT_SHA256", hashes: [] };
  }
  if (raw.length === 0) {
    return { ok: false, reason: "EMPTY_HASHES", hashes: [] };
  }
  const hashes = [];
  for (const item of raw) {
    if (!isSha256Hex(item)) {
      return { ok: false, reason: "HASH_NOT_SHA256", hashes: [] };
    }
    hashes.push(String(item).toLowerCase());
  }
  return { ok: true, reason: "", hashes: [...new Set(hashes)] };
}

export function leftoverResolveDecision({ importedHashCount, matchedIdCount, scanComplete }) {
  if (scanComplete !== true) {
    return { ok: false, reason: "SCAN_INCOMPLETE" };
  }
  if (
    typeof importedHashCount !== "number" ||
    typeof matchedIdCount !== "number" ||
    !Number.isFinite(importedHashCount) ||
    !Number.isFinite(matchedIdCount)
  ) {
    return { ok: false, reason: "HASH_UNMATCHED" };
  }
  if (importedHashCount > matchedIdCount || matchedIdCount === 0) {
    return { ok: false, reason: "HASH_UNMATCHED" };
  }
  return { ok: true, reason: "" };
}

export function knownIdCountOf(knownIds) {
  const ids = knownIds && typeof knownIds === "object" ? knownIds : emptyMw13KnownIds();
  return Object.keys(emptyMw13KnownIds()).reduce(
    (sum, key) => sum + (Array.isArray(ids[key]) ? ids[key].length : 0),
    0
  );
}

export function mw13LeftoverDecision(state) {
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
  const reasons = [];
  if (!wroteDocs) reasons.push("WROTE_DOCS_FALSE");
  if (wroteDocs && knownIdCount === 0) reasons.push("KNOWN_IDS_MISSING_AFTER_WRITE");
  if (wroteDocs && !testDocsConfirmed) reasons.push("TEST_DOCS_NOT_CONFIRMED");
  if (wroteDocs && testDocsConfirmed && leftoverDocs !== 0) reasons.push("TEST_DOCS_LEFT");
  if (!leftoverObjectsConfirmed || leftoverObjects === null) reasons.push("TEST_OBJECTS_NOT_CONFIRMED");
  if (leftoverObjectsConfirmed && leftoverObjects !== 0) reasons.push("TEST_OBJECTS_LEFT");
  if (state.clientDenied !== true) reasons.push("CLIENT_WRITE_NOT_DENIED");
  if (!collectionsConfirmed) reasons.push("COLLECTIONS_MISSING");
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
    knownIdCount
  };
}
