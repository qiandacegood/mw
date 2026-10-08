import {
  leftoverDecision,
  listedCollectionNames,
  requireQueryOk,
  storageObjectCount,
  validationFunctionNames,
  describeUnauthenticatedClient
} from "./mw04-assert.mjs";
import { authorizedEnvId, assertMwTestReady, MW_VALIDATION_COLLECTIONS, redact, runTcb } from "./mw04-lib.mjs";

const ready = await assertMwTestReady();
const fnList = await runTcb(["fn", "list", "--json"]);
requireQueryOk(fnList, "fn list");
const remaining = validationFunctionNames(fnList.json);

const storageAfter = await runTcb(["storage", "list", "mw-test/validation", "--json"]);
requireQueryOk(storageAfter, "storage list");

const acl = await runTcb(["storage", "rules", "get", "--json"]);
requireQueryOk(acl, "storage rules get");

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
const collectionNames = listedCollectionNames(listed.json);

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
const clientNote = describeUnauthenticatedClient(client);

const state = {
  remainingValidationFunctions: remaining.length,
  storageObjectCount: storageObjectCount(storageAfter.json),
  listedCollectionNames: collectionNames,
  acl: acl.json?.data?.acl,
  enableOverrun: ready.enableOverrun
};
const decision = leftoverDecision(state);

console.log(
  JSON.stringify(
    redact({
      ...state,
      collectionExistsCount: state.listedCollectionNames.filter((name) => name.startsWith("mw_validation_"))
        .length,
      client: clientNote,
      otherEnvCount: ready.otherEnvCount,
      ok: decision.ok
    }),
    null,
    2
  )
);
process.exit(decision.exitCode);
