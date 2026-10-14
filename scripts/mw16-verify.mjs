import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, invokeFn, runTcb, writeJson } from "./mw04-lib.mjs";
import { listIndexCommand, parseNosqlCount } from "./mw06-lib.mjs";
import {
  FORBIDDEN_FUTURE_COLLECTIONS,
  INITIAL_ROOT_SEEDS,
  MEDAL_GRANT_INDEXES,
  MW16_COLLECTIONS,
  mw16Tmp,
  redactMw16
} from "./mw16-lib.mjs";

const tmp = mw16Tmp();
const evidence = { startedAt: new Date().toISOString(), marker: "MW16", steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw16-verify-evidence.json"), redactMw16(evidence));
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

const unauthGrowth = await invokeFn("mw-member", {
  apiVersion: "1",
  action: "member.growth",
  requestId: "mw16/test/cli/unauth-growth",
  data: {}
});
record("cli_unauth_member_growth", {
  ok: errorCode(unauthGrowth.payload) === "AUTH_REQUIRED",
  code: errorCode(unauthGrowth.payload),
  reason: errorReason(unauthGrowth.payload)
});

const forgedGrowth = await invokeFn("mw-member", {
  apiVersion: "1",
  action: "member.growth",
  requestId: "mw16/test/cli/forged-growth",
  data: { memberId: "forged", role: "super" }
});
record("cli_forged_member_growth", {
  ok: errorCode(forgedGrowth.payload) === "FORBIDDEN" && errorReason(forgedGrowth.payload) === "CLIENT_IDENTITY_IGNORED",
  code: errorCode(forgedGrowth.payload),
  reason: errorReason(forgedGrowth.payload)
});

const publicGrowth = await invokeFn("mw-public", {
  apiVersion: "1",
  action: "member.growth",
  requestId: "mw16/test/cli/public-growth",
  data: {}
});
record("cli_public_rejects_member_growth", {
  ok: errorCode(publicGrowth.payload) === "FORBIDDEN",
  code: errorCode(publicGrowth.payload),
  reason: errorReason(publicGrowth.payload)
});

const publicGrowthPreview = await invokeFn("mw-public", {
  apiVersion: "1",
  action: "growth.preview",
  requestId: "mw16/test/cli/public-growth-preview",
  data: { levels: [] }
});
record("cli_public_rejects_growth_preview", {
  ok: errorCode(publicGrowthPreview.payload) === "FORBIDDEN",
  code: errorCode(publicGrowthPreview.payload)
});

const unauthAdminGrowth = await invokeFn("mw-admin", {
  apiVersion: "1",
  action: "growth.config",
  requestId: "mw16/test/cli/unauth-admin-growth",
  data: {}
});
record("cli_unauth_admin_growth_config", {
  ok: errorCode(unauthAdminGrowth.payload) === "AUTH_REQUIRED",
  code: errorCode(unauthAdminGrowth.payload),
  reason: errorReason(unauthAdminGrowth.payload)
});

let seedCount = 0;
for (const seed of INITIAL_ROOT_SEEDS) {
  const counted = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([
      {
        TableName: "categories",
        CommandType: "COMMAND",
        Command: JSON.stringify({ count: "categories", query: { _id: seedCategoryId(seed.seedKey) } })
      }
    ]),
    "--json"
  ]);
  if (parseNosqlCount(counted) === 1) seedCount += 1;
}

const listed = await runTcb([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([{ TableName: MW16_COLLECTIONS[0], CommandType: "COMMAND", Command: JSON.stringify({ listCollections: 1 }) }]),
  "--json"
]);
const listedText = JSON.stringify(listed.json || {});
const collectionsPresent = MW16_COLLECTIONS.every((name) => listedText.includes(name));
const futurePresent = FORBIDDEN_FUTURE_COLLECTIONS.some((name) => listedText.includes(`"${name}"`));

let indexesOk = true;
for (const index of MEDAL_GRANT_INDEXES) {
  const indexList = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([listIndexCommand(index.collection)]),
    "--json"
  ]);
  const ok = indexList.code === 0 && JSON.stringify(indexList.json || {}).includes(index.name);
  record(`index_${index.name}`, { ok });
  if (!ok) indexesOk = false;
}

let clientDenied = false;
try {
  const { default: cloudbase } = await import("@cloudbase/js-sdk");
  const app = cloudbase.init({ env: authorizedEnvId(), region: "ap-shanghai" });
  const results = [];
  for (const name of ["medal_grants", "member_stats", "attempts", "score_events"]) {
    try {
      await app.database().collection(name).add({ marker: "MW16" });
      results.push(false);
    } catch {
      results.push(true);
    }
  }
  clientDenied = results.every(Boolean);
} catch {
  clientDenied = false;
}
record("client_direct_write", { ok: clientDenied });

record("collections", { present: collectionsPresent, futurePresent, seedCount, indexesOk });

const cliOk = evidence.steps.filter((step) => step.name.startsWith("cli_") && step.ok === false).length === 0;
const ok = cliOk && collectionsPresent && !futurePresent && seedCount === 10 && indexesOk && clientDenied;

evidence.finishedAt = new Date().toISOString();
writeJson(join(tmp, "mw16-verify-evidence.json"), redactMw16(evidence));
console.log(
  JSON.stringify(
    redactMw16({
      ok,
      cliOk,
      collectionsPresent,
      futurePresent,
      seedCount,
      indexesOk,
      clientDenied,
      enableOverrun: ready.enableOverrun
    }),
    null,
    2
  )
);
process.exit(ok ? 0 : 1);
