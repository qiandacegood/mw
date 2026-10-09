import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, redact } from "./mw04-lib.mjs";
import { createCollectionCommand, createIndexCommand, listIndexCommand, redactMw06 } from "./mw06-lib.mjs";
import { INITIAL_ROOT_SEEDS } from "./mw09-lib.mjs";

export const MW10_COLLECTIONS = ["questions", "question_versions", "media_assets", "upload_tickets"];
export const MW10_KEEP_COLLECTIONS = ["categories", "category_names", "app_config", "idempotency", "audit_logs"];
export const MW10_DEPLOY_ENTRIES = ["mw-admin", "mw-upload"];
export const MW10_MARKER = "MW10";
export const MW10_STORAGE_PREFIX = "mw-test/media/";
export const QUESTION_INDEX = {
  collection: "questions",
  name: "idx_questions_category_status_updated_id",
  keys: [
    { name: "categoryId", direction: 1 },
    { name: "status", direction: 1 },
    { name: "updatedAt", direction: -1 },
    { name: "_id", direction: 1 }
  ]
};
export const FORBIDDEN_FUTURE_COLLECTIONS = ["papers", "paper_versions", "attempts", "orders", "vip_accounts", "vip_plans"];

export { INITIAL_ROOT_SEEDS };

export function mw10Tmp() {
  const dir = join(projectRoot(), "tmp", "mw10");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function redactMw10(value) {
  return redactMw06(redact(value));
}

export function emptyMw10KnownIds() {
  return {
    questions: [],
    versions: [],
    assets: [],
    tickets: [],
    objects: [],
    idempotency: [],
    audits: []
  };
}

export function knownIdCountOf(knownIds) {
  const ids = knownIds && typeof knownIds === "object" ? knownIds : emptyMw10KnownIds();
  return ["questions", "versions", "assets", "tickets", "objects", "idempotency", "audits"].reduce(
    (sum, key) => sum + (Array.isArray(ids[key]) ? ids[key].length : 0),
    0
  );
}

export function mw10LeftoverDecision(state) {
  const collectionNames = Array.isArray(state.collectionNames) ? state.collectionNames : null;
  const missingCollections = collectionNames
    ? MW10_COLLECTIONS.filter((name) => !collectionNames.includes(name))
    : MW10_COLLECTIONS.slice();
  const leftoverDocs =
    typeof state.testDocCount === "number" && Number.isFinite(state.testDocCount) ? state.testDocCount : null;
  const leftoverObjects =
    typeof state.testObjectCount === "number" && Number.isFinite(state.testObjectCount) ? state.testObjectCount : null;
  const seedPresent = state.seedPresent === true;
  const seedCount = typeof state.seedCount === "number" ? state.seedCount : 0;
  const indexConfirmed = state.indexConfirmed === true;
  const aclObtained = state.aclObtained === true && typeof state.acl === "string" && state.acl.length > 0;
  const acl = aclObtained ? state.acl : "";
  const clientDenied = state.clientDenied === true;
  const storageDenied = state.storageDenied === true;
  const collectionsConfirmed = state.collectionsConfirmed === true && collectionNames !== null;
  const testDocsConfirmed = state.testDocsConfirmed === true && leftoverDocs !== null;
  const testObjectsConfirmed = state.testObjectsConfirmed === true && leftoverObjects !== null;
  const enableOverrunConfirmed = state.enableOverrunConfirmed === true && typeof state.enableOverrun === "boolean";
  const overrun = state.enableOverrun === true;
  const wroteDocs = state.wroteDocs === true;
  const knownIdCount =
    typeof state.knownIdCount === "number" && Number.isFinite(state.knownIdCount)
      ? state.knownIdCount
      : knownIdCountOf(state.knownIds);
  const futureCreated = state.futureCollectionsCreated === true;
  const reasons = [];
  if (!aclObtained) reasons.push("ACL_NOT_OBTAINED");
  if (aclObtained && acl !== "ADMINONLY") reasons.push("ACL_NOT_ADMINONLY");
  if (state.clientDenied !== true) reasons.push("CLIENT_WRITE_NOT_DENIED");
  if (state.storageDenied !== true) reasons.push("STORAGE_GET_NOT_DENIED");
  if (!collectionsConfirmed) reasons.push("COLLECTIONS_MISSING");
  if (collectionsConfirmed && missingCollections.length) reasons.push("COLLECTIONS_MISSING");
  if (!indexConfirmed) reasons.push("INDEX_NOT_CONFIRMED");
  if (!seedPresent || seedCount !== 10) reasons.push("SEED_ROOTS_MISSING");
  if (wroteDocs && knownIdCount === 0) reasons.push("KNOWN_IDS_MISSING_AFTER_WRITE");
  if (wroteDocs && !testDocsConfirmed) reasons.push("TEST_DOCS_NOT_CONFIRMED");
  if (wroteDocs && testDocsConfirmed && leftoverDocs !== 0) reasons.push("TEST_DOCS_LEFT");
  if (!wroteDocs && !testDocsConfirmed) reasons.push("TEST_DOCS_NOT_CONFIRMED");
  if (wroteDocs && !testObjectsConfirmed) reasons.push("TEST_OBJECTS_NOT_CONFIRMED");
  if (wroteDocs && testObjectsConfirmed && leftoverObjects !== 0) reasons.push("TEST_OBJECTS_LEFT");
  if (!enableOverrunConfirmed) reasons.push("OVERRUN_NOT_CONFIRMED");
  if (enableOverrunConfirmed && overrun) reasons.push("OVERRUN_ENABLED");
  if (state.otherEnvChanged === true) reasons.push("OTHER_ENV_CHANGED");
  if (futureCreated) reasons.push("FUTURE_COLLECTIONS_CREATED");
  return {
    ok: reasons.length === 0,
    exitCode: reasons.length === 0 ? 0 : 1,
    reasons,
    missingCollections,
    leftoverDocs: leftoverDocs === null ? -1 : leftoverDocs,
    leftoverObjects: leftoverObjects === null ? -1 : leftoverObjects,
    seedPresent,
    seedCount,
    indexConfirmed,
    enableOverrun: Boolean(state.enableOverrun),
    acl,
    aclObtained,
    clientDenied,
    storageDenied,
    collectionsConfirmed,
    testDocsConfirmed,
    testObjectsConfirmed,
    enableOverrunConfirmed,
    wroteDocs,
    cloudWriteClaimed: wroteDocs,
    exactIdSweepOnly: true,
    knownIdCount
  };
}

export { createCollectionCommand, createIndexCommand, listIndexCommand };
