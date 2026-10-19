import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { mw26Tmp, redactMw26 } from "./mw26-lib.mjs";

const COLLECTIONS = ["paper_answers", "attempts", "score_metrics", "paper_bests"];
const TARGET_ACL = "ADMINONLY";

function aclTagOf(payload) {
  return payload?.AclTag || payload?.aclTag || payload?.Response?.AclTag || "";
}

async function describeAcl(envId, collection) {
  const result = await runTcb(
    [
      "api",
      "tcb",
      "DescribeDatabaseACL",
      "--api-version",
      "2018-06-08",
      "--json",
      "--body",
      JSON.stringify({ EnvId: envId, CollectionName: collection })
    ],
    { timeoutMs: 60000 }
  );
  const body = result.json?.Response || result.json?.data || result.json || {};
  return { code: result.code, aclTag: aclTagOf(body), ok: result.code === 0 };
}

async function modifyAcl(envId, collection, aclTag) {
  const result = await runTcb(
    [
      "api",
      "tcb",
      "ModifyDatabaseACL",
      "--api-version",
      "2018-06-08",
      "--json",
      "--body",
      JSON.stringify({ EnvId: envId, CollectionName: collection, AclTag: aclTag })
    ],
    { timeoutMs: 60000 }
  );
  return { code: result.code, ok: result.code === 0 };
}

const ready = await assertMwTestReady();
if (ready.enableOverrun === true) throw new Error("EnableOverrun must stay false");
const envId = authorizedEnvId();

const rows = [];
for (const collection of COLLECTIONS) {
  const before = await describeAcl(envId, collection);
  let modified = false;
  if (before.aclTag !== TARGET_ACL) {
    const change = await modifyAcl(envId, collection, TARGET_ACL);
    if (!change.ok) {
      rows.push({ collection, before: before.aclTag, after: before.aclTag, modified: false, error: "MODIFY_FAILED" });
      continue;
    }
    modified = true;
  }
  const after = await describeAcl(envId, collection);
  rows.push({
    collection,
    before: before.aclTag || "UNKNOWN",
    after: after.aclTag || "UNKNOWN",
    modified
  });
}

const ok = rows.every((row) => row.after === TARGET_ACL);
const summary = redactMw26({
  ok,
  leftoverClaimedZero: false,
  enableOverrun: ready.enableOverrun,
  targetAcl: TARGET_ACL,
  rows,
  note: "仅 mw-test。客户端对这些集合应为 ADMINONLY。不删夹具，不得 leftover=0。"
});
writeJson(join(mw26Tmp(), "mw26-db-acl.json"), summary);
console.log(JSON.stringify(summary, null, 2));
process.exit(ok ? 0 : 1);
