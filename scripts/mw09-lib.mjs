import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, redact } from "./mw04-lib.mjs";
import { createCollectionCommand, createIndexCommand, listIndexCommand, redactMw06 } from "./mw06-lib.mjs";

export const MW09_COLLECTIONS = ["categories", "category_names"];
export const MW09_KEEP_COLLECTIONS = ["app_config", "idempotency", "audit_logs"];
export const MW09_DEPLOY_ENTRIES = ["mw-admin", "mw-public"];
export const MW09_MARKER = "MW09";
export const CATALOG_DOC_ID = "catalog";
export const CATEGORY_INDEX = {
  collection: "categories",
  name: "idx_categories_parent_deleted_sort_id",
  keys: [
    { name: "parentId", direction: 1 },
    { name: "deletedAt", direction: 1 },
    { name: "sort", direction: 1 },
    { name: "_id", direction: 1 }
  ]
};
export const INITIAL_ROOT_SEEDS = [
  { seedKey: "logical", name: "逻辑思维" },
  { seedKey: "reverse", name: "逆向思维" },
  { seedKey: "divergent", name: "发散思维" },
  { seedKey: "convergent", name: "聚合思维" },
  { seedKey: "imagery", name: "形象思维" },
  { seedKey: "abstract", name: "抽象思维" },
  { seedKey: "creative", name: "创造性思维" },
  { seedKey: "critical", name: "批判性思维" },
  { seedKey: "game", name: "博弈思维" },
  { seedKey: "open", name: "开放性思维" }
];

export function mw09Tmp() {
  const dir = join(projectRoot(), "tmp", "mw09");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function redactMw09(value) {
  return redactMw06(redact(value));
}

export function emptyMw09KnownIds() {
  return { categories: [], names: [], idempotency: [], audits: [] };
}

export function knownIdCountOf(knownIds) {
  const ids = knownIds && typeof knownIds === "object" ? knownIds : emptyMw09KnownIds();
  return ["categories", "names", "idempotency", "audits"].reduce(
    (sum, key) => sum + (Array.isArray(ids[key]) ? ids[key].length : 0),
    0
  );
}

export function mw09LeftoverDecision(state) {
  const collectionNames = Array.isArray(state.collectionNames) ? state.collectionNames : null;
  const missingCollections = collectionNames
    ? MW09_COLLECTIONS.filter((name) => !collectionNames.includes(name))
    : MW09_COLLECTIONS.slice();
  const leftoverDocs =
    typeof state.testDocCount === "number" && Number.isFinite(state.testDocCount) ? state.testDocCount : null;
  const seedPresent = state.seedPresent === true;
  const seedCount = typeof state.seedCount === "number" ? state.seedCount : 0;
  const indexConfirmed = state.indexConfirmed === true;
  const aclObtained = state.aclObtained === true && typeof state.acl === "string" && state.acl.length > 0;
  const acl = aclObtained ? state.acl : "";
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
  const reasons = [];
  if (!aclObtained) reasons.push("ACL_NOT_OBTAINED");
  if (aclObtained && acl !== "ADMINONLY") reasons.push("ACL_NOT_ADMINONLY");
  if (state.clientDenied !== true) reasons.push("CLIENT_WRITE_NOT_DENIED");
  if (!collectionsConfirmed) reasons.push("COLLECTIONS_MISSING");
  if (collectionsConfirmed && missingCollections.length) reasons.push("COLLECTIONS_MISSING");
  if (!indexConfirmed) reasons.push("INDEX_NOT_CONFIRMED");
  if (!seedPresent || seedCount !== 10) reasons.push("SEED_ROOTS_MISSING");
  if (wroteDocs && knownIdCount === 0) reasons.push("KNOWN_IDS_MISSING_AFTER_WRITE");
  if (wroteDocs && !testDocsConfirmed) reasons.push("TEST_DOCS_NOT_CONFIRMED");
  if (wroteDocs && testDocsConfirmed && leftoverDocs !== 0) reasons.push("TEST_DOCS_LEFT");
  if (!wroteDocs && !testDocsConfirmed) reasons.push("TEST_DOCS_NOT_CONFIRMED");
  if (!enableOverrunConfirmed) reasons.push("OVERRUN_NOT_CONFIRMED");
  if (enableOverrunConfirmed && overrun) reasons.push("OVERRUN_ENABLED");
  if (state.otherEnvChanged === true) reasons.push("OTHER_ENV_CHANGED");
  if (state.futureCollectionsCreated === true) reasons.push("FUTURE_COLLECTIONS_CREATED");
  return {
    ok: reasons.length === 0,
    exitCode: reasons.length === 0 ? 0 : 1,
    reasons,
    missingCollections,
    leftoverDocs: leftoverDocs === null ? -1 : leftoverDocs,
    seedPresent,
    seedCount,
    indexConfirmed,
    enableOverrun: Boolean(state.enableOverrun),
    acl,
    aclObtained,
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

export { createCollectionCommand, createIndexCommand, listIndexCommand };
