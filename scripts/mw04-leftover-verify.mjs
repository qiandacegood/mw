import { authorizedEnvId, assertMwTestReady, MW_VALIDATION_COLLECTIONS, redact, runTcb } from "./mw04-lib.mjs";

const ready = await assertMwTestReady();
const fnList = await runTcb(["fn", "list", "--json"]);
const remaining = (fnList.json?.data?.Functions || [])
  .map((item) => item.FunctionName)
  .filter((name) => name.startsWith("mw-validation-"));
const storageAfter = await runTcb(["storage", "list", "mw-test/validation", "--json"]);
const acl = await runTcb(["storage", "rules", "get", "--json"]);

let client = { attempted: false };
try {
  const { default: cloudbase } = await import("@cloudbase/js-sdk");
  const app = cloudbase.init({ env: authorizedEnvId(), region: "ap-shanghai" });
  try {
    const snap = await app.database().collection("mw_validation_docs").limit(1).get();
    client = { attempted: true, ok: true, count: (snap.data || []).length };
  } catch (error) {
    client = {
      attempted: true,
      ok: false,
      error: { code: error && error.code, message: error && error.message }
    };
  }
} catch (error) {
  client = { attempted: false, error: { message: error && error.message } };
}

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
const listedNames = [];
function walkNames(value) {
  if (!value) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(walkNames);
    return;
  }
  if (typeof value === "object") {
    if (typeof value.name === "string") {
      listedNames.push(value.name);
    }
    Object.values(value).forEach(walkNames);
  }
}
walkNames(listed.json?.data?.results);
const collectionStates = MW_VALIDATION_COLLECTIONS.filter((name) => name.startsWith("mw_validation_")).map(
  (name) => ({
    prefixOk: true,
    exists: listedNames.includes(name)
  })
);

console.log(
  JSON.stringify(
    redact({
      remainingValidationFunctions: remaining.length,
      storageTotal: storageAfter.json?.meta?.total ?? storageAfter.json?.data?.length,
      acl: acl.json?.data?.acl,
      clientDenied: client.ok === false,
      client,
      collectionExistsCount: collectionStates.filter((item) => item.exists).length,
      enableOverrun: ready.enableOverrun,
      otherEnvCount: ready.otherEnvCount
    }),
    null,
    2
  )
);
process.exit(0);
