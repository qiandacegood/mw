import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, invokeFn, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { listIndexCommand, parseNosqlCount } from "./mw06-lib.mjs";
import {
  CATEGORY_INDEX,
  INITIAL_ROOT_SEEDS,
  MW09_COLLECTIONS,
  MW09_MARKER,
  mw09Tmp,
  redactMw09
} from "./mw09-lib.mjs";

const tmp = mw09Tmp();
const evidence = {
  startedAt: new Date().toISOString(),
  marker: MW09_MARKER,
  localFixtureSeparated: true,
  steps: [],
  knownIds: { categories: [], names: [], idempotency: [], audits: [] }
};

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw09-verify-evidence.json"), redactMw09(evidence));
}

function errorCode(payload) {
  return payload?.error?.code || payload?.reason || "";
}

function errorReason(payload) {
  return payload?.error?.details?.reason || payload?.reason || "";
}

const ready = await assertMwTestReady();
record("hard_check", {
  ok: ready.ok,
  enableOverrun: ready.enableOverrun,
  otherEnvCount: ready.otherEnvCount,
  envTouched: "mw-test-only"
});
authorizedEnvId();

const { seedCategoryId } = await import("../packages/shared/dist/category.js");

const unauthCreate = await invokeFn("mw-admin", {
  apiVersion: "1",
  action: "category.create",
  requestId: "mw09/test/cli/unauth-create",
  idempotencyKey: "mw09/test/cli/unauth-create",
  data: { name: "不应写入", expectedTreeVersion: 0 }
});
record("cli_unauth_create", {
  ok: errorCode(unauthCreate.payload) === "AUTH_REQUIRED",
  code: errorCode(unauthCreate.payload),
  reason: errorReason(unauthCreate.payload)
});

const unauthUpdate = await invokeFn("mw-admin", {
  apiVersion: "1",
  action: "category.update",
  requestId: "mw09/test/cli/unauth-update",
  idempotencyKey: "mw09/test/cli/unauth-update",
  data: { categoryId: "x", expectedTreeVersion: 0, name: "x" }
});
record("cli_unauth_update", {
  ok: errorCode(unauthUpdate.payload) === "AUTH_REQUIRED",
  code: errorCode(unauthUpdate.payload)
});

const unauthDelete = await invokeFn("mw-admin", {
  apiVersion: "1",
  action: "category.delete",
  requestId: "mw09/test/cli/unauth-delete",
  idempotencyKey: "mw09/test/cli/unauth-delete",
  data: { categoryId: "x", expectedTreeVersion: 0 }
});
record("cli_unauth_delete", {
  ok: errorCode(unauthDelete.payload) === "AUTH_REQUIRED",
  code: errorCode(unauthDelete.payload)
});

const forged = await invokeFn("mw-admin", {
  apiVersion: "1",
  action: "category.create",
  requestId: "mw09/test/cli/forged",
  idempotencyKey: "mw09/test/cli/forged",
  data: { name: "伪造", expectedTreeVersion: 0, role: "super", uid: "forged" }
});
record("cli_forged_admin", {
  ok: errorCode(forged.payload) === "FORBIDDEN" && errorReason(forged.payload) === "CLIENT_IDENTITY_IGNORED",
  code: errorCode(forged.payload),
  reason: errorReason(forged.payload)
});

const publicTree = await invokeFn("mw-public", {
  apiVersion: "1",
  action: "category.tree",
  requestId: "mw09/test/cli/public-tree",
  data: {}
});
record("cli_public_tree", {
  ok: publicTree.payload?.ok === true,
  treeVersion: publicTree.payload?.data?.treeVersion,
  nodeCount: Array.isArray(publicTree.payload?.data?.nodes) ? publicTree.payload.data.nodes.length : 0
});

let seedCount = 0;
for (const seed of INITIAL_ROOT_SEEDS) {
  const id = seedCategoryId(seed.seedKey);
  const counted = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([
      {
        TableName: "categories",
        CommandType: "COMMAND",
        Command: JSON.stringify({ count: "categories", query: { _id: id } })
      }
    ]),
    "--json"
  ]);
  const n = parseNosqlCount(counted);
  if (n === 1) seedCount += 1;
}
record("seed_roots_present", { seedCount, expected: 10, ok: seedCount === 10 });

const listed = await runTcb([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([listIndexCommand(CATEGORY_INDEX.collection)]),
  "--json"
]);
record("index_list", { code: listed.code, listed: Boolean(listed.json) });

let clientDenied = false;
let clientAttempted = false;
try {
  const { default: cloudbase } = await import("@cloudbase/js-sdk");
  const app = cloudbase.init({ env: authorizedEnvId(), region: "ap-shanghai" });
  clientAttempted = true;
  try {
    await app.database().collection("categories").add({ name: "should-fail", marker: MW09_MARKER });
    clientDenied = false;
  } catch {
    clientDenied = true;
  }
  try {
    await app.database().collection("category_names").add({ name: "should-fail", marker: MW09_MARKER });
  } catch {
    clientDenied = clientDenied && true;
  }
} catch {
  clientAttempted = false;
}
record("client_direct_write", { attempted: clientAttempted, denied: clientDenied });

const listedCols = await runTcb([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([
    {
      TableName: "categories",
      CommandType: "COMMAND",
      Command: JSON.stringify({ listCollections: 1 })
    }
  ]),
  "--json"
]);
const rawCols = listedCols.json?.data?.results?.[0] || listedCols.json?.data || listedCols.json;
const batch = rawCols?.cursor?.firstBatch || rawCols?.firstBatch || rawCols?.collections || [];
const colNames = Array.isArray(batch)
  ? batch.map((item) => (typeof item === "string" ? item : item.name || item.Name || item._id)).filter(Boolean)
  : [];
const futureNames = ["questions", "papers", "attempts", "orders", "vip_accounts", "vip_plans", "vip_grants"];
const futurePresent = futureNames.filter((name) => colNames.includes(name));
record("future_collections_absent", { items: futureNames, present: futurePresent, allMissing: futurePresent.length === 0 });

evidence.finishedAt = new Date().toISOString();
writeJson(join(tmp, "mw09-verify-evidence.json"), redactMw09(evidence));
const summary = redactMw09({
  ok:
    evidence.steps.find((item) => item.name === "cli_unauth_create")?.ok === true &&
    evidence.steps.find((item) => item.name === "cli_forged_admin")?.ok === true &&
    clientDenied === true &&
    seedCount === 10 &&
    ready.enableOverrun === false,
  seedCount,
  clientDenied,
  enableOverrun: ready.enableOverrun,
  otherEnvCount: ready.otherEnvCount,
  collections: MW09_COLLECTIONS
});
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
