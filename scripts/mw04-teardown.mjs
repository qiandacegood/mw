import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  assertTeardownEndState,
  assertUnauthorizedStatuses,
  describeUnauthenticatedClient,
  interpretCollectionDrop,
  listedCollectionNames,
  requireQueryOk,
  storageObjectCount,
  validationFunctionNames
} from "./mw04-assert.mjs";
import {
  MW_VALIDATION_COLLECTIONS,
  MW_VALIDATION_FUNCTIONS,
  MW_VALIDATION_STORAGE_PREFIX,
  assertMwTestReady,
  projectRoot,
  publicObjectUrls,
  recordStep,
  redact,
  runTcb,
  writeJson
} from "./mw04-lib.mjs";

const root = projectRoot();
const tmp = join(root, "tmp", "mw04");
const confirm = process.argv.includes("--confirm");
const dryRun = !confirm;
const steps = [];
const report = {
  startedAt: new Date().toISOString(),
  mode: dryRun ? "dry-run" : "confirm",
  deletesEntireEnv: false,
  steps
};

function record(stepName, value) {
  recordStep(steps, stepName, value);
  writeJson(join(tmp, "mw04-teardown.json"), redact(report));
}

function exactValidationFunction(name) {
  return MW_VALIDATION_FUNCTIONS.includes(name) && name.startsWith("mw-validation-");
}

function exactValidationCollection(name) {
  return MW_VALIDATION_COLLECTIONS.includes(name) && name.startsWith("mw_validation_");
}

function exactValidationObject(path) {
  return typeof path === "string" && path.startsWith(MW_VALIDATION_STORAGE_PREFIX);
}

function nosqlCommand(tableName, commandType, command) {
  return [
    {
      TableName: tableName,
      CommandType: commandType,
      Command: typeof command === "string" ? command : JSON.stringify(command)
    }
  ];
}

async function listValidationCollections() {
  const listed = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([
      {
        TableName: MW_VALIDATION_COLLECTIONS[0],
        CommandType: "COMMAND",
        Command: JSON.stringify({ listCollections: 1 })
      }
    ]),
    "--json"
  ]);
  requireQueryOk(listed, "listCollections");
  return { listed, names: listedCollectionNames(listed.json) };
}

const ready = await assertMwTestReady();
record("hard_check", ready);
if (dryRun) {
  console.log("MW04 teardown dry-run. Pass --confirm to apply. Entire environment will not be deleted.");
}

const usageBefore = await runTcb(["env", "usage", "--yes"]);
record("usage_before", { code: usageBefore.code, stdout: usageBefore.stdout });

const fnList = await runTcb(["fn", "list", "--json"]);
requireQueryOk(fnList, "fn list");
const listedFunctions = (fnList.json?.data?.Functions || []).map((item) => item.FunctionName);
const otherFunctionCount = listedFunctions.filter((name) => !exactValidationFunction(name)).length;
const targetFunctions = MW_VALIDATION_FUNCTIONS.filter((name) => listedFunctions.includes(name));
const missingFunctions = MW_VALIDATION_FUNCTIONS.filter((name) => !listedFunctions.includes(name));
record("fn_list", {
  code: fnList.code,
  targetCount: targetFunctions.length,
  missingCount: missingFunctions.length,
  otherFunctionCount
});

const storageList = await runTcb(["storage", "list", "mw-test/validation", "--json"]);
requireQueryOk(storageList, "storage list");
const listedObjects = [];
const rawFiles = storageList.json?.data?.files || storageList.json?.data?.Files || storageList.json?.data || [];
const fileRows = Array.isArray(rawFiles) ? rawFiles : rawFiles.fileList || rawFiles.list || [];
for (const item of Array.isArray(fileRows) ? fileRows : []) {
  const path = item.Key || item.key || item.cloudPath || item.CloudPath || item.path;
  if (path) {
    listedObjects.push(path);
  }
}
const invalidObjects = listedObjects.filter((path) => !exactValidationObject(path));
record("storage_list", {
  code: storageList.code,
  objectCount: listedObjects.length,
  invalidCount: invalidObjects.length
});
if (invalidObjects.length > 0) {
  throw new Error("refusing teardown: storage list returned a path outside mw-test/validation/");
}

const collectionsBefore = await listValidationCollections();
record("list_collections", {
  code: collectionsBefore.listed.code,
  validationCount: collectionsBefore.names.filter((name) => name.startsWith("mw_validation_")).length
});

if (dryRun) {
  record("planned", {
    functions: targetFunctions,
    missingFunctions,
    storagePrefix: MW_VALIDATION_STORAGE_PREFIX,
    storageCount: listedObjects.length,
    collections: MW_VALIDATION_COLLECTIONS,
    keepAcl: "ADMINONLY",
    dropCollections: "only if exact nosql drop is accepted",
    collectionAcl: "apply only if a confirmed per-collection CLI exists"
  });
  report.finishedAt = new Date().toISOString();
  writeJson(join(tmp, "mw04-teardown.json"), redact(report));
  console.log(
    JSON.stringify(
      redact({
        mode: "dry-run",
        hardCheck: { ok: ready.ok, region: ready.region, package: ready.package, enableOverrun: ready.enableOverrun },
        functionsToDelete: targetFunctions.length,
        functionsAlreadyAbsent: missingFunctions.length,
        storageObjects: listedObjects.length,
        collections: MW_VALIDATION_COLLECTIONS.length
      }),
      null,
      2
    )
  );
  process.exit(0);
}

for (const name of targetFunctions) {
  if (!exactValidationFunction(name)) {
    throw new Error("refusing to delete a function that is not an exact mw-validation- whitelist name");
  }
  const preview = await runTcb(["fn", "delete", name, "--dry-run", "--json"]);
  record(`fn_delete_preview_${name}`, { code: preview.code, json: preview.json });
  const deleted = await runTcb(["fn", "delete", name, "--json"]);
  record(`fn_delete_${name}`, { code: deleted.code, json: deleted.json, stdout: deleted.stdout, stderr: deleted.stderr });
  if (deleted.code !== 0) {
    throw new Error(`exact function delete failed for a whitelisted mw-validation- name (code ${deleted.code})`);
  }
}

for (const collection of MW_VALIDATION_COLLECTIONS) {
  if (!exactValidationCollection(collection)) {
    throw new Error("refusing collection work outside mw_validation_ whitelist");
  }
  const cleared = await runTcb(
    [
      "db",
      "nosql",
      "execute",
      "--command",
      JSON.stringify(nosqlCommand(collection, "DELETE", { delete: collection, deletes: [{ q: {}, limit: 1 }] })),
      "--json"
    ],
    { timeoutMs: 60000 }
  );
  record(`docs_clear_${collection}`, { code: cleared.code, json: cleared.json, stdout: cleared.stdout, stderr: cleared.stderr });

  const dropped = await runTcb(
    [
      "db",
      "nosql",
      "execute",
      "--command",
      JSON.stringify(nosqlCommand(collection, "COMMAND", { drop: collection })),
      "--json"
    ],
    { timeoutMs: 60000 }
  );
  const dropOutcome = interpretCollectionDrop(dropped);
  record(`collection_drop_${collection}`, {
    code: dropped.code,
    json: dropped.json,
    stdout: dropped.stdout,
    stderr: dropped.stderr,
    dropStatus: dropOutcome.status
  });
}

if (listedObjects.length > 0) {
  const removed = await runTcb(
    ["storage", "rm", "mw-test/validation", "--dir", "--recursive", "--force", "--json"],
    { timeoutMs: 120000 }
  );
  record("storage_rm_prefix", { code: removed.code, json: removed.json, stdout: removed.stdout, stderr: removed.stderr });
  if (removed.code !== 0) {
    throw new Error("storage prefix delete failed; ACL was not changed");
  }
}

const acl = await runTcb(["storage", "rules", "get", "--json"]);
requireQueryOk(acl, "storage rules get");
record("storage_acl", { code: acl.code, json: acl.json, stdout: acl.stdout });

const fnAfter = await runTcb(["fn", "list", "--json"]);
requireQueryOk(fnAfter, "fn list after");
const remainingValidation = validationFunctionNames(fnAfter.json);
record("fn_after", { code: fnAfter.code, remainingValidationCount: remainingValidation.length });

const storageAfter = await runTcb(["storage", "list", "mw-test/validation", "--json"]);
requireQueryOk(storageAfter, "storage list after");
record("storage_after", { code: storageAfter.code, json: storageAfter.json });

const collectionsAfter = await listValidationCollections();
record("list_collections_after", {
  code: collectionsAfter.listed.code,
  validationCount: collectionsAfter.names.filter((name) => name.startsWith("mw_validation_")).length
});

const afterReady = await assertMwTestReady();
record("hard_check_after", afterReady);

assertTeardownEndState({
  remainingValidationFunctions: remainingValidation.length,
  storageObjectCount: storageObjectCount(storageAfter.json),
  listedCollectionNames: collectionsAfter.names,
  acl: acl.json?.data?.acl,
  enableOverrun: afterReady.enableOverrun
});

const leftoverUrls = publicObjectUrls(ready.storageHosts, `${MW_VALIDATION_STORAGE_PREFIX}private-sample.txt`);
const publicChecks = [];
for (const url of leftoverUrls) {
  try {
    const response = await fetch(url, { redirect: "manual" });
    publicChecks.push({ http: response.status, redirected: response.redirected });
  } catch (error) {
    publicChecks.push({ error: { message: error && error.message } });
  }
}
record("unauthorized_storage_get", { count: publicChecks.length, results: publicChecks });
assertUnauthorizedStatuses(publicChecks);

let clientAccess = { attempted: false };
try {
  const { default: cloudbase } = await import("@cloudbase/js-sdk");
  const { authorizedEnvId } = await import("./mw04-lib.mjs");
  const app = cloudbase.init({ env: authorizedEnvId(), region: "ap-shanghai" });
  const db = app.database();
  try {
    const snap = await db.collection("mw_validation_docs").limit(1).get();
    clientAccess = { attempted: true, ok: true, count: (snap.data || []).length };
  } catch (error) {
    clientAccess = {
      attempted: true,
      ok: false,
      error: {
        detailName: error && error.name,
        message: error && error.message,
        code: error && error.code
      }
    };
  }
} catch (error) {
  clientAccess = { attempted: false, error: { message: error && error.message } };
}
const clientNote = describeUnauthenticatedClient(clientAccess);
record("client_direct_db", { ...clientAccess, ...clientNote });

const usageAfter = await runTcb(["env", "usage", "--yes"]);
record("usage_after", { code: usageAfter.code, stdout: usageAfter.stdout });

const rawEvidence = join(tmp, "mw04-evidence.raw.json");
if (existsSync(rawEvidence)) {
  unlinkSync(rawEvidence);
  record("raw_evidence_deleted", { deleted: true });
}

report.finishedAt = new Date().toISOString();
writeJson(join(tmp, "mw04-teardown.json"), redact(report));
console.log(
  JSON.stringify(
    redact({
      mode: "confirm",
      remainingValidationFunctions: remainingValidation.length,
      unauthorized: publicChecks,
      client: clientNote,
      enableOverrun: afterReady.enableOverrun,
      otherEnvCount: afterReady.otherEnvCount
    }),
    null,
    2
  )
);
process.exit(0);
