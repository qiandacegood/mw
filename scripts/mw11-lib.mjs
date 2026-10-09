import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, redact } from "./mw04-lib.mjs";
import { createCollectionCommand, createIndexCommand, listIndexCommand, redactMw06 } from "./mw06-lib.mjs";
import { INITIAL_ROOT_SEEDS } from "./mw09-lib.mjs";

export const MW11_COLLECTIONS = ["papers", "paper_versions", "paper_chunks", "paper_answers"];
export const MW11_KEEP_COLLECTIONS = [
  "categories",
  "category_names",
  "questions",
  "question_versions",
  "media_assets",
  "upload_tickets",
  "app_config",
  "idempotency",
  "audit_logs"
];
export const MW11_DEPLOY_ENTRIES = ["mw-admin", "mw-public"];
export const MW11_MARKER = "MW11";
export const PAPER_INDEXES = [
  {
    collection: "papers",
    name: "idx_papers_status_category_published_id",
    keys: [
      { name: "status", direction: 1 },
      { name: "categoryId", direction: 1 },
      { name: "publishedAt", direction: -1 },
      { name: "_id", direction: 1 }
    ]
  },
  {
    collection: "papers",
    name: "idx_papers_status_sort_id",
    keys: [
      { name: "status", direction: 1 },
      { name: "sort", direction: 1 },
      { name: "_id", direction: 1 }
    ]
  }
];
export const FORBIDDEN_FUTURE_COLLECTIONS = [
  "attempts",
  "paper_bests",
  "orders",
  "vip_accounts",
  "vip_plans",
  "import_batches",
  "import_rows"
];

export { INITIAL_ROOT_SEEDS };

export function mw11Tmp() {
  const dir = join(projectRoot(), "tmp", "mw11");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function redactMw11(value) {
  return redactMw06(redact(value));
}

export function emptyMw11KnownIds() {
  return {
    papers: [],
    versions: [],
    chunks: [],
    answers: [],
    questions: [],
    questionVersions: [],
    assets: [],
    idempotency: [],
    audits: []
  };
}

export function knownIdCountOf(knownIds) {
  const ids = knownIds && typeof knownIds === "object" ? knownIds : emptyMw11KnownIds();
  return Object.keys(emptyMw11KnownIds()).reduce(
    (sum, key) => sum + (Array.isArray(ids[key]) ? ids[key].length : 0),
    0
  );
}

export function mw11LeftoverDecision(state) {
  const collectionNames = Array.isArray(state.collectionNames) ? state.collectionNames : null;
  const missingCollections = collectionNames
    ? MW11_COLLECTIONS.filter((name) => !collectionNames.includes(name))
    : MW11_COLLECTIONS.slice();
  const leftoverDocs =
    typeof state.testDocCount === "number" && Number.isFinite(state.testDocCount) ? state.testDocCount : null;
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
    leftoverObjects: 0,
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
