import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  authorizedEnvId,
  assertMwTestReady,
  invokeFn,
  projectRoot,
  publicObjectUrls,
  recordStep,
  redact,
  runCommand,
  runTcb,
  writeJson
} from "./mw04-lib.mjs";

const root = projectRoot();
const tmp = join(root, "tmp", "mw04");
mkdirSync(tmp, { recursive: true });

const evidence = {
  startedAt: new Date().toISOString(),
  local: {
    node: process.version,
    npm: "",
    cli: "3.8.5"
  },
  steps: []
};

function record(stepName, value) {
  recordStep(evidence.steps, stepName, value);
  writeJson(join(tmp, "mw04-evidence.json"), redact(evidence));
}

const ready = await assertMwTestReady();
record("hard_check", ready);
const envId = authorizedEnvId();
writeJson(join(root, "cloudbaserc.json"), {
  version: "2.0",
  envId,
  region: "ap-shanghai",
  functionRoot: "./cloudfunctions",
  functions: [
    {
      name: "mw-validation-runtime22",
      timeout: 10,
      runtime: "Nodejs22.21",
      memorySize: 128,
      handler: "index.main",
      installDependency: false
    },
    {
      name: "mw-validation-probe",
      timeout: 60,
      runtime: "Nodejs20.19",
      memorySize: 512,
      handler: "index.main",
      installDependency: true
    },
    {
      name: "mw-validation-public",
      timeout: 10,
      runtime: "Nodejs20.19",
      memorySize: 256,
      handler: "index.main",
      installDependency: false
    },
    {
      name: "mw-validation-member",
      timeout: 10,
      runtime: "Nodejs20.19",
      memorySize: 256,
      handler: "index.main",
      installDependency: false
    },
    {
      name: "mw-validation-admin",
      timeout: 10,
      runtime: "Nodejs20.19",
      memorySize: 256,
      handler: "index.main",
      installDependency: false
    },
    {
      name: "mw-validation-upload",
      timeout: 30,
      runtime: "Nodejs20.19",
      memorySize: 512,
      handler: "index.main",
      installDependency: false
    },
    {
      name: "mw-validation-pay-hook",
      timeout: 10,
      runtime: "Nodejs20.19",
      memorySize: 256,
      handler: "index.main",
      installDependency: false
    },
    {
      name: "mw-validation-jobs",
      timeout: 10,
      runtime: "Nodejs20.19",
      memorySize: 256,
      handler: "index.main",
      installDependency: false
    }
  ]
});
writeJson(join(root, "configs", "local.json"), {
  cloudbaseEnvId: envId,
  region: "ap-shanghai",
  appEnv: "mw-test",
  wechatAppId: "wx_placeholder_appid"
});

const npmVersion = await runCommand("npm", ["-v"]);
evidence.local.npm = npmVersion.stdout.trim();

const envList = await runTcb(["env", "list", "--json"]);
if (envList.code !== 0) {
  writeJson(join(tmp, "mw04-evidence.json"), redact(evidence));
  throw new Error("tcb env list failed; refusing deploy, ACL, upload, and transactions");
}
const envRow = (envList.json?.data || []).find((row) => row.EnvId === envId);
if (!envRow) {
  record("env_list", { code: envList.code, selected: null, otherEnvCount: (envList.json?.data || []).length });
  throw new Error("authorized env not found in env list; refusing deploy, ACL, upload, and transactions");
}
record("env_list", {
  code: envList.code,
  selected: {
    packageId: envRow.PackageId,
    packageName: envRow.PackageName,
    regionHint: ready.region,
    enableOverrun: envRow.EnableOverrun,
    expireTime: envRow.ExpireTime,
    status: envRow.Status,
    payMode: envRow.PayMode,
    deduction: envRow.EnvDeductionMode,
    qpsQuota: envRow.EnvQps?.QpsQuota,
    autoRenew: envRow.IsAutoRenew
  },
  otherEnvCount: (envList.json?.data || []).filter((row) => row.EnvId !== envId).length
});

const envDetail = await runTcb(["env", "detail", "--yes"]);
record("env_detail", { code: envDetail.code, stdout: envDetail.stdout });

const usageBefore = await runTcb(["env", "usage", "--yes"]);
record("usage_before", { code: usageBefore.code, stdout: usageBefore.stdout });

const aclBefore = await runTcb(["storage", "rules", "get", "--json"]);
record("storage_acl_before", { code: aclBefore.code, json: aclBefore.json, stdout: aclBefore.stdout });

const aclSet = await runTcb(["storage", "rules", "update", "--acl", "ADMINONLY", "--json"]);
record("storage_acl_set", { code: aclSet.code, json: aclSet.json, stdout: aclSet.stdout });

const aclAfter = await runTcb(["storage", "rules", "get", "--json"]);
record("storage_acl_after", { code: aclAfter.code, json: aclAfter.json, stdout: aclAfter.stdout });

const deployNames = [
  "mw-validation-runtime22",
  "mw-validation-probe",
  "mw-validation-public",
  "mw-validation-member",
  "mw-validation-admin",
  "mw-validation-upload",
  "mw-validation-pay-hook",
  "mw-validation-jobs"
];

for (const name of deployNames) {
  const extra =
    name === "mw-validation-runtime22"
      ? ["--runtime", "Nodejs22.21", "--install-dependency", "false"]
      : name === "mw-validation-probe"
        ? ["--runtime", "Nodejs20.19", "--install-dependency", "true"]
        : ["--runtime", "Nodejs20.19", "--install-dependency", "false"];
  const deployed = await runTcb(["fn", "deploy", name, "--force", "--json", ...extra], {
    timeoutMs: 300000
  });
  record(`deploy_${name}`, {
    code: deployed.code,
    json: deployed.json,
    stdout: deployed.stdout,
    stderr: deployed.stderr
  });
}

const fnList = await runTcb(["fn", "list", "--json"]);
record("fn_list", { code: fnList.code, json: fnList.json, stdout: fnList.stdout });

const runtime22 = await invokeFn("mw-validation-runtime22", { action: "runtime" });
record("invoke_runtime22", { code: runtime22.code, payload: runtime22.payload, stdout: runtime22.stdout });

const ping = await invokeFn("mw-validation-probe", { action: "ping" });
record("invoke_ping", { code: ping.code, payload: ping.payload });

const identity = await invokeFn("mw-validation-probe", {
  action: "identity",
  userId: "mem_fict_forged",
  openid: "openid_fict_forged",
  role: "super",
  score: 999
});
record("invoke_identity", { code: identity.code, payload: identity.payload });

const admin = await invokeFn("mw-validation-probe", {
  action: "admin",
  uid: "auth_fict_forged",
  role: "super"
});
record("invoke_admin", { code: admin.code, payload: admin.payload });

const txOps = await invokeFn("mw-validation-probe", { action: "tx_ops" }, { timeoutMs: 180000 });
record("invoke_tx_ops", { code: txOps.code, payload: txOps.payload });

const runId = `mw04_${Date.now()}`;
const txInit = await invokeFn("mw-validation-probe", { action: "tx_init", runId });
record("invoke_tx_init", { code: txInit.code, payload: txInit.payload });

const [claimA, claimB] = await Promise.all([
  invokeFn("mw-validation-probe", { action: "tx_claim", runId, slot: "slot_a" }),
  invokeFn("mw-validation-probe", { action: "tx_claim", runId, slot: "slot_b" })
]);
record("invoke_tx_claim_race", {
  a: claimA.payload,
  b: claimB.payload
});

const txRead = await invokeFn("mw-validation-probe", { action: "tx_read", runId });
record("invoke_tx_read", { code: txRead.code, payload: txRead.payload });

const indexResult = await invokeFn("mw-validation-probe", { action: "index" });
record("invoke_index", { code: indexResult.code, payload: indexResult.payload });

const indexCommand = {
  TableName: "mw_validation_index",
  CommandType: "COMMAND",
  Command: JSON.stringify({
    createIndexes: "mw_validation_index",
    indexes: [
      {
        name: "mw_validation_parent_sort",
        key: { parentId: 1, deletedAt: 1, sort: 1, _id: 1 }
      }
    ]
  })
};
const indexCli = await runTcb(
  ["db", "nosql", "execute", "--command", JSON.stringify([indexCommand]), "--json"],
  { timeoutMs: 60000 }
);
record("index_cli", { code: indexCli.code, json: indexCli.json, stdout: indexCli.stdout, stderr: indexCli.stderr });

const storageA = await invokeFn("mw-validation-probe", { action: "storage", asOwner: "a" });
record("invoke_storage_a", { code: storageA.code, payload: storageA.payload });
const storageB = await invokeFn("mw-validation-probe", { action: "storage", asOwner: "b" });
record("invoke_storage_b", { code: storageB.code, payload: storageB.payload });

const publicUrls = publicObjectUrls(ready.storageHosts, "mw-test/validation/private-sample.txt");
const publicGets = [];
for (const url of publicUrls) {
  try {
    const response = await fetch(url, { redirect: "manual" });
    publicGets.push({ http: response.status, redirected: response.redirected });
  } catch (error) {
    publicGets.push({ http: 0, error: { message: error && error.message } });
  }
}
record("public_storage_get", { count: publicGets.length, results: publicGets });

const size49 = await invokeFn("mw-validation-probe", { action: "upload_size", megabytes: 4.9 }, { timeoutMs: 180000 });
record("invoke_size_4_9", { code: size49.code, payload: size49.payload });
const size51 = await invokeFn("mw-validation-probe", { action: "upload_size", megabytes: 5.1 }, { timeoutMs: 180000 });
record("invoke_size_5_1", { code: size51.code, payload: size51.payload });

const local49 = join(tmp, "mw_validation_4p9.bin");
const local51 = join(tmp, "mw_validation_5p1.bin");
writeFileSync(local49, Buffer.alloc(Math.round(4.9 * 1024 * 1024), 9));
writeFileSync(local51, Buffer.alloc(Math.round(5.1 * 1024 * 1024), 9));
const upload49 = await runTcb(["storage", "upload", local49, "mw-test/validation/cli-4p9.bin", "--json"], {
  timeoutMs: 180000
});
record("cli_upload_4_9", { code: upload49.code, json: upload49.json, stdout: upload49.stdout, stderr: upload49.stderr });
const upload51 = await runTcb(["storage", "upload", local51, "mw-test/validation/cli-5p1.bin", "--json"], {
  timeoutMs: 180000
});
record("cli_upload_5_1", { code: upload51.code, json: upload51.json, stdout: upload51.stdout, stderr: upload51.stderr });

const entries = [
  ["mw-validation-public", { action: "catalog.list", userId: "mem_fict_x", role: "super" }],
  ["mw-validation-public", { action: "member.register" }],
  ["mw-validation-member", { action: "attempt.submit", userId: "mem_fict_x", openid: "x", role: "admin" }],
  ["mw-validation-admin", { action: "refund.approve", uid: "auth_fict", role: "super" }],
  ["mw-validation-upload", { action: "upload", byteLength: 100, userId: "x" }],
  ["mw-validation-upload", { action: "upload", uploadTicket: "ticket_fict", byteLength: 5347737 }],
  ["mw-validation-upload", { action: "upload", uploadTicket: "ticket_fict", byteLength: 5138022 }],
  ["mw-validation-pay-hook", { action: "notify", userId: "mem_fict" }],
  ["mw-validation-pay-hook", { action: "notify" }],
  ["mw-validation-jobs", { action: "run", fromClient: true, userId: "x" }],
  ["mw-validation-jobs", { action: "run", Type: "Timer" }]
];

for (const [name, data] of entries) {
  const invoked = await invokeFn(name, data);
  record(`entry_${name}_${data.action || "x"}_${JSON.stringify(data).length}`, {
    name,
    data,
    payload: invoked.payload
  });
}

let clientAccess = { attempted: false };
try {
  const { default: cloudbase } = await import("@cloudbase/js-sdk");
  const app = cloudbase.init({ env: envId, region: "ap-shanghai" });
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
record("client_direct_db", clientAccess);

const usageAfter = await runTcb(["env", "usage", "--yes"]);
record("usage_after", { code: usageAfter.code, stdout: usageAfter.stdout });

evidence.finishedAt = new Date().toISOString();
writeJson(join(tmp, "mw04-evidence.json"), redact(evidence));
console.log("MW04 validation finished. Evidence written to tmp/mw04 (gitignored).");
console.log(
  JSON.stringify(
    redact({
      env_ok: Boolean(envRow),
      overrun: envRow?.EnableOverrun,
      runtime22: runtime22.payload,
      ping: ping.payload,
      identity: identity.payload,
      admin: admin.payload,
      tx: txRead.payload,
      index: indexResult.payload,
      storageA: storageA.payload,
      publicHttp: publicGets,
      size49: size49.payload,
      size51: size51.payload
    }),
    null,
    2
  )
);
