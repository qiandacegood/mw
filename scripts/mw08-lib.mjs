import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, redact } from "./mw04-lib.mjs";
import { redactMw06 } from "./mw06-lib.mjs";

export const MW08_COLLECTIONS = ["identities", "members", "member_stats"];
export const MW08_KEEP_COLLECTIONS = ["app_config", "idempotency", "audit_logs"];
export const MW08_DEPLOY_ENTRIES = ["mw-public", "mw-member"];
export const POLICIES_DOC_ID = "policies";
export const MW08_MARKER = "MW08";

export function mw08Tmp() {
  const dir = join(projectRoot(), "tmp", "mw08");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function defaultPoliciesDoc(now = new Date()) {
  return {
    _id: POLICIES_DOC_ID,
    kind: "policies",
    agreementVersion: "mw08-test-agreement-v1",
    privacyVersion: "mw08-test-privacy-v1",
    agreementTitle: "用户协议（测试稿）",
    privacyTitle: "隐私政策（测试稿）",
    placeholder: true,
    note: "正式文案由 MW24 接入",
    schemaVersion: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function redactMw08(value) {
  return redactMw06(redact(value));
}

export function emptyMw08KnownIds() {
  return { identities: [], members: [], stats: [], idempotency: [], audits: [] };
}

export function knownIdCountOf(knownIds) {
  const ids = knownIds && typeof knownIds === "object" ? knownIds : emptyMw08KnownIds();
  return ["identities", "members", "stats", "idempotency", "audits"].reduce(
    (sum, key) => sum + (Array.isArray(ids[key]) ? ids[key].length : 0),
    0
  );
}

export function mw08LeftoverDecision(state) {
  const collectionNames = Array.isArray(state.collectionNames) ? state.collectionNames : null;
  const missingCollections = collectionNames
    ? MW08_COLLECTIONS.filter((name) => !collectionNames.includes(name))
    : MW08_COLLECTIONS.slice();
  const leftoverDocs =
    typeof state.testDocCount === "number" && Number.isFinite(state.testDocCount) ? state.testDocCount : null;
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
  if (!collectionsConfirmed) reasons.push("COLLECTIONS_NOT_CONFIRMED");
  if (collectionsConfirmed && missingCollections.length) reasons.push("COLLECTIONS_MISSING");
  if (wroteDocs && knownIdCount === 0) reasons.push("KNOWN_IDS_MISSING_AFTER_WRITE");
  if (wroteDocs && !testDocsConfirmed) reasons.push("TEST_DOCS_NOT_CONFIRMED");
  if (wroteDocs && testDocsConfirmed && leftoverDocs !== 0) reasons.push("TEST_DOCS_LEFT");
  if (!wroteDocs && !testDocsConfirmed) reasons.push("TEST_DOCS_NOT_CONFIRMED");
  if (!enableOverrunConfirmed) reasons.push("OVERRUN_NOT_CONFIRMED");
  if (enableOverrunConfirmed && overrun) reasons.push("OVERRUN_ENABLED");
  if (state.otherEnvChanged === true) reasons.push("OTHER_ENV_CHANGED");
  return {
    ok: reasons.length === 0,
    exitCode: reasons.length === 0 ? 0 : 1,
    reasons,
    missingCollections,
    leftoverDocs: leftoverDocs === null ? -1 : leftoverDocs,
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
