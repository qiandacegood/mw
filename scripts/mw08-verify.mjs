import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, invokeFn, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { MW08_COLLECTIONS, MW08_MARKER, mw08Tmp, redactMw08 } from "./mw08-lib.mjs";

const tmp = mw08Tmp();
const evidence = {
  startedAt: new Date().toISOString(),
  marker: MW08_MARKER,
  localFixtureSeparated: true,
  steps: [],
  knownIds: { identities: [], members: [], stats: [], idempotency: [], audits: [] }
};

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw08-verify-evidence.json"), redactMw08(evidence));
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

const unauthRegister = await invokeFn("mw-member", {
  apiVersion: "1",
  action: "member.register",
  requestId: "mw08/test/cli/unauth-register",
  idempotencyKey: "mw08/test/cli/unauth-register",
  data: { agreementVersion: "mw08-test-agreement-v1", privacyVersion: "mw08-test-privacy-v1", accepted: true }
});
record("cli_unauth_register", {
  ok: errorCode(unauthRegister.payload) === "AUTH_REQUIRED",
  code: errorCode(unauthRegister.payload),
  reason: errorReason(unauthRegister.payload)
});

const unauthMe = await invokeFn("mw-member", {
  apiVersion: "1",
  action: "member.me",
  requestId: "mw08/test/cli/unauth-me",
  data: {}
});
record("cli_unauth_me", {
  ok: errorCode(unauthMe.payload) === "AUTH_REQUIRED",
  code: errorCode(unauthMe.payload),
  reason: errorReason(unauthMe.payload)
});

const missingFrom = await invokeFn("mw-member", {
  apiVersion: "1",
  action: "member.register",
  requestId: "mw08/test/cli/missing-from",
  idempotencyKey: "mw08/test/cli/missing-from",
  data: { agreementVersion: "mw08-test-agreement-v1", privacyVersion: "mw08-test-privacy-v1", accepted: true }
});
record("cli_missing_from", {
  ok: errorReason(missingFrom.payload) === "NO_FROM_APPID" || errorCode(missingFrom.payload) === "AUTH_REQUIRED",
  code: errorCode(missingFrom.payload),
  reason: errorReason(missingFrom.payload)
});

const forged = await invokeFn("mw-member", {
  apiVersion: "1",
  action: "member.register",
  requestId: "mw08/test/cli/forged",
  idempotencyKey: "mw08/test/cli/forged",
  data: {
    agreementVersion: "mw08-test-agreement-v1",
    privacyVersion: "mw08-test-privacy-v1",
    accepted: true,
    openid: "forged_openid",
    memberId: "forged_member",
    role: "super"
  }
});
record("cli_forged_identity", {
  ok: errorCode(forged.payload) === "FORBIDDEN" && errorReason(forged.payload) === "CLIENT_IDENTITY_IGNORED",
  code: errorCode(forged.payload),
  reason: errorReason(forged.payload)
});

const policies = await invokeFn("mw-public", {
  apiVersion: "1",
  action: "policies.current",
  requestId: "mw08/test/cli/policies",
  data: {}
});
record("cli_policies_current", {
  ok: policies.payload?.ok === true,
  hasVersions: Boolean(policies.payload?.data?.agreementVersion && policies.payload?.data?.privacyVersion)
});

let clientDenied = false;
let clientAttempted = false;
try {
  const { default: cloudbase } = await import("@cloudbase/js-sdk");
  const app = cloudbase.init({ env: authorizedEnvId(), region: "ap-shanghai" });
  clientAttempted = true;
  try {
    await app.database().collection("members").add({ nickname: "should-fail", marker: "MW08" });
    clientDenied = false;
  } catch {
    clientDenied = true;
  }
} catch {
  clientAttempted = false;
}

record("client_direct_write_members", { attempted: clientAttempted, denied: clientDenied });

const trusted = {
  register: "NOT_RUN",
  replay: "NOT_RUN",
  me: "NOT_RUN",
  updateProfile: "NOT_RUN",
  concurrentOneMember: "NOT_RUN",
  reason: "CLI_HAS_NO_FROM_CONTEXT"
};
record("trusted_shared_login", trusted);

const required = {
  cliUnauthRegister: evidence.steps.find((step) => step.name === "cli_unauth_register")?.ok === true,
  cliUnauthMe: evidence.steps.find((step) => step.name === "cli_unauth_me")?.ok === true,
  cliMissingFrom: evidence.steps.find((step) => step.name === "cli_missing_from")?.ok === true,
  cliForged: evidence.steps.find((step) => step.name === "cli_forged_identity")?.ok === true,
  cliPolicies: evidence.steps.find((step) => step.name === "cli_policies_current")?.ok === true,
  clientDenied,
  enableOverrunFalse: ready.enableOverrun === false
};

evidence.finishedAt = new Date().toISOString();
evidence.required = required;
evidence.ok = Object.values(required).every(Boolean);
writeJson(join(tmp, "mw08-verify-evidence.json"), redactMw08(evidence));
writeJson(join(projectRoot(), "configs", "mw08-verify-state.json"), redactMw08({
  marker: MW08_MARKER,
  knownIds: evidence.knownIds,
  collections: MW08_COLLECTIONS,
  finishedAt: evidence.finishedAt
}));

console.log(
  JSON.stringify(
    redactMw08({
      ok: evidence.ok,
      marker: MW08_MARKER,
      required,
      trusted,
      enableOverrun: ready.enableOverrun,
      otherEnvCount: ready.otherEnvCount
    }),
    null,
    2
  )
);

process.exit(evidence.ok ? 0 : 1);
