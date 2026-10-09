import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, redact } from "./mw04-lib.mjs";
import { createCollectionCommand, createIndexCommand, listIndexCommand, redactMw06 } from "./mw06-lib.mjs";
import { INITIAL_ROOT_SEEDS } from "./mw09-lib.mjs";

export const MW12_COLLECTIONS = ["import_batches", "import_rows", "source_keys"];
export const MW12_KEEP_COLLECTIONS = [
  "categories",
  "category_names",
  "questions",
  "question_versions",
  "media_assets",
  "upload_tickets",
  "papers",
  "paper_versions",
  "paper_chunks",
  "paper_answers",
  "app_config",
  "idempotency",
  "audit_logs"
];
export const MW12_DEPLOY_ENTRIES = ["mw-admin", "mw-upload"];
export const MW12_MARKER = "MW12";
export const IMPORT_INDEXES = [
  {
    collection: "import_rows",
    name: "idx_import_rows_batch_row",
    keys: [
      { name: "batchId", direction: 1 },
      { name: "rowNo", direction: 1 }
    ]
  },
  {
    collection: "import_batches",
    name: "idx_import_batches_kind_hash",
    keys: [
      { name: "kind", direction: 1 },
      { name: "fileHash", direction: 1 }
    ]
  },
  {
    collection: "source_keys",
    name: "idx_source_keys_kind_state",
    keys: [
      { name: "kind", direction: 1 },
      { name: "state", direction: 1 }
    ]
  }
];
export const FORBIDDEN_FUTURE_COLLECTIONS = [
  "attempts",
  "paper_bests",
  "orders",
  "vip_accounts",
  "vip_plans"
];

export { INITIAL_ROOT_SEEDS };

export function mw12Tmp() {
  const dir = join(projectRoot(), "tmp", "mw12");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function redactMw12(value) {
  return redactMw06(redact(value));
}

export function emptyMw12KnownIds() {
  return {
    batches: [],
    rows: [],
    sourceKeys: [],
    questions: [],
    questionVersions: [],
    papers: [],
    assets: [],
    tickets: [],
    idempotency: [],
    audits: []
  };
}

export function knownIdCountOf(knownIds) {
  const ids = knownIds && typeof knownIds === "object" ? knownIds : emptyMw12KnownIds();
  return Object.keys(emptyMw12KnownIds()).reduce(
    (sum, key) => sum + (Array.isArray(ids[key]) ? ids[key].length : 0),
    0
  );
}

export function mw12LeftoverDecision(state) {
  const collectionNames = Array.isArray(state.collectionNames) ? state.collectionNames : null;
  const missingCollections = collectionNames
    ? MW12_COLLECTIONS.filter((name) => !collectionNames.includes(name))
    : MW12_COLLECTIONS.slice();
  const leftoverDocs =
    typeof state.testDocCount === "number" && Number.isFinite(state.testDocCount) ? state.testDocCount : null;
  const leftoverObjects =
    typeof state.leftoverObjects === "number" && Number.isFinite(state.leftoverObjects) ? state.leftoverObjects : 0;
  const seedPresent = state.seedPresent === true;
  const seedCount = typeof state.seedCount === "number" ? state.seedCount : 0;
  const indexConfirmed = state.indexConfirmed === true;
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
  if (state.clientDenied !== true) reasons.push("CLIENT_WRITE_NOT_DENIED");
  if (!collectionsConfirmed) reasons.push("COLLECTIONS_MISSING");
  if (collectionsConfirmed && missingCollections.length) reasons.push("COLLECTIONS_MISSING");
  if (!indexConfirmed) reasons.push("INDEX_NOT_CONFIRMED");
  if (!seedPresent || seedCount !== 10) reasons.push("SEED_ROOTS_MISSING");
  if (wroteDocs && knownIdCount === 0) reasons.push("KNOWN_IDS_MISSING_AFTER_WRITE");
  if (wroteDocs && !testDocsConfirmed) reasons.push("TEST_DOCS_NOT_CONFIRMED");
  if (wroteDocs && testDocsConfirmed && leftoverDocs !== 0) reasons.push("TEST_DOCS_LEFT");
  if (wroteDocs && leftoverObjects !== 0) reasons.push("TEST_OBJECTS_LEFT");
  if (!wroteDocs && !testDocsConfirmed) reasons.push("TEST_DOCS_NOT_CONFIRMED");
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
    leftoverObjects,
    seedPresent,
    seedCount,
    indexConfirmed,
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

export { createCollectionCommand, createIndexCommand, listIndexCommand };
