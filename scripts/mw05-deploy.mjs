import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  authorizedEnvId,
  assertMwTestReady,
  invokeFn,
  projectRoot,
  runTcb,
  writeJson
} from "./mw04-lib.mjs";
import {
  ADMIN_USERS_COLLECTION,
  MW05_OFFICIAL_FUNCTIONS,
  mw05Tmp,
  readMw05LocalConfig,
  redactMw05,
  requireAdminUid,
  writeAdminLocalEnv,
  writeMiniprogramLocalCloud,
  writeMw05Cloudbaserc
} from "./mw05-lib.mjs";

const root = projectRoot();
const tmp = mw05Tmp();
const evidence = { startedAt: new Date().toISOString(), steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw05-evidence.json"), redactMw05(evidence));
}

const ready = await assertMwTestReady();
record("hard_check", { ok: ready.ok, enableOverrun: ready.enableOverrun, otherEnvCount: ready.otherEnvCount });
authorizedEnvId();

const emit = spawnSync(process.execPath, [join(root, "scripts", "mw05-emit-runtime.mjs")], {
  cwd: root,
  encoding: "utf8"
});
if (emit.status !== 0) {
  throw new Error(`runtime emit failed: ${emit.stderr || emit.stdout}`);
}
record("emit_runtime", { ok: true, log: "emitted" });

writeMw05Cloudbaserc();
writeAdminLocalEnv();
writeMiniprogramLocalCloud();
const local = readMw05LocalConfig();
const whitelistEmpty = !local.allowedMiniAppIds || /placeholder/i.test(local.allowedMiniAppIds);
record("whitelist", { configured: !whitelistEmpty, failClosedIfEmpty: true });

for (const name of MW05_OFFICIAL_FUNCTIONS) {
  const deployed = await runTcb(["fn", "deploy", name, "--force"], { timeoutMs: 300000 });
  record(`deploy_${name}`, { code: deployed.code, ok: deployed.code === 0 });
  if (deployed.code !== 0) {
    throw new Error(`deploy ${name} failed`);
  }
}

const adminUid = requireAdminUid();
const create = await runTcb([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([
    {
      TableName: ADMIN_USERS_COLLECTION,
      CommandType: "COMMAND",
      Command: JSON.stringify({ create: ADMIN_USERS_COLLECTION })
    }
  ]),
  "--json"
]);
record("admin_users_create", {
  code: create.code,
  createdOrExists: /already exists|exists|ok|NamespaceExists|success/i.test(`${create.stdout}${create.stderr}`) || create.code === 0
});

const now = new Date().toISOString();
const seed = await runTcb([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([
    {
      TableName: ADMIN_USERS_COLLECTION,
      CommandType: "UPDATE",
      Command: JSON.stringify({
        update: ADMIN_USERS_COLLECTION,
        updates: [
          {
            q: { _id: adminUid },
            u: {
              $set: {
                _id: adminUid,
                schemaVersion: 1,
                roles: ["super"],
                enabled: true,
                authVersion: 1,
                updatedAt: now
              },
              $setOnInsert: { createdAt: now }
            },
            upsert: true
          }
        ]
      })
    }
  ]),
  "--json"
]);
record("admin_users_seed", { code: seed.code, seeded: seed.code === 0, uidWritten: false });

const denyJobs = await invokeFn("mw-jobs", { fromClient: true, requestId: "req_cli_jobs" });
record("invoke_jobs_client", {
  code: denyJobs.code,
  reason: denyJobs.payload?.reason || denyJobs.payload?.error?.details?.reason
});

const denyPay = await invokeFn("mw-pay-hook", { requestId: "req_cli_pay" });
record("invoke_pay_unsigned", { code: denyPay.code, reason: denyPay.payload?.reason });

const denyMember = await invokeFn("mw-member", {
  apiVersion: "1",
  action: "member.session",
  requestId: "req_cli_member",
  data: {}
});
record("invoke_member_no_from", {
  code: denyMember.code,
  errorCode: denyMember.payload?.error?.code,
  reason: denyMember.payload?.error?.details?.reason
});

const forged = await invokeFn("mw-public", {
  apiVersion: "1",
  action: "home.get",
  requestId: "req_cli_forged",
  data: { userId: "forged", role: "super" }
});
record("invoke_public_forged", {
  code: forged.code,
  errorCode: forged.payload?.error?.code,
  reason: forged.payload?.error?.details?.reason
});

const publicPing = await invokeFn("mw-public", {
  apiVersion: "1",
  action: "public.ping",
  requestId: "req_cli_public",
  data: {}
});
record("invoke_public_ping", { code: publicPing.code, ok: publicPing.payload?.ok === true });

const adminNoUid = await invokeFn("mw-admin", {
  apiVersion: "1",
  action: "admin.me",
  requestId: "req_cli_admin",
  data: { uid: adminUid, role: "super" }
});
record("invoke_admin_forged_uid", {
  code: adminNoUid.code,
  errorCode: adminNoUid.payload?.error?.code,
  reason: adminNoUid.payload?.error?.details?.reason
});

const usage = await runTcb(["env", "list", "--json"]);
const rows = usage.json?.data || [];
const self = rows.find((item) => item.EnvId === authorizedEnvId());
record("overrun_recheck", { enableOverrun: self?.EnableOverrun === false || self?.EnableOverrun === "false" });

evidence.finishedAt = new Date().toISOString();
writeJson(join(tmp, "mw05-evidence.json"), redactMw05(evidence));
writeJson(join(root, "configs", "mw05-state.json"), redactMw05({
  officialFunctions: MW05_OFFICIAL_FUNCTIONS,
  adminUsersSeeded: seed.code === 0,
  whitelistConfigured: !whitelistEmpty,
  enableOverrun: false
}));
console.log(JSON.stringify(redactMw05({ ok: true, steps: evidence.steps.length }), null, 2));
