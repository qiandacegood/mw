import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { MW05_HTTP_PATH, MW05_TEMP_HTTP_FUNCTION, mw05Tmp, redactMw05, writeMw05Cloudbaserc } from "./mw05-lib.mjs";

const root = projectRoot();
const tmp = mw05Tmp();
const evidence = { startedAt: new Date().toISOString(), steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "mw05-http-evidence.json"), redactMw05(evidence));
}

const ready = await assertMwTestReady();
record("hard_check", { ok: ready.ok, enableOverrun: ready.enableOverrun });
authorizedEnvId();

writeMw05Cloudbaserc([
  {
    name: MW05_TEMP_HTTP_FUNCTION,
    timeout: 30,
    runtime: "Nodejs20.19",
    memorySize: 256,
    handler: "index.main",
    installDependency: false
  }
]);

const deploy = await runTcb(["fn", "deploy", MW05_TEMP_HTTP_FUNCTION, "--force"], { timeoutMs: 180000 });
record("deploy_temp_http", { code: deploy.code });
if (deploy.code !== 0) {
  throw new Error("temp HTTP function deploy failed");
}

const created = await runTcb([
  "service",
  "create",
  "-p",
  MW05_HTTP_PATH,
  "-f",
  MW05_TEMP_HTTP_FUNCTION,
  "--json"
]);
record("http_service_create", { code: created.code });

const listed = await runTcb(["service", "list", "--json"]);
const services = listed.json?.data || listed.json || [];
const row = Array.isArray(services)
  ? services.find((item) => item.FunctionName === MW05_TEMP_HTTP_FUNCTION || item.Path === `/${MW05_HTTP_PATH}` || item.ServicePath === MW05_HTTP_PATH)
  : undefined;
const url = row?.Url || row?.url || row?.DefaultDomainUrl;
record("http_service_list", { found: Boolean(row), urlPresent: Boolean(url) });

async function postBytes(label, megabytes) {
  if (!url) {
    return { label, skipped: true, reason: "NO_HTTP_URL" };
  }
  const bytes = Math.round(megabytes * 1024 * 1024);
  const body = "x".repeat(bytes);
  const file = join(tmp, `${label}.bin`);
  writeFileSync(file, body);
  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body
  }).catch((error) => ({ ok: false, status: 0, error: String(error && error.message) }));
  const status = res.status || 0;
  let payload;
  try {
    payload = await res.json();
  } catch {
    payload = { textLength: typeof res.text === "function" ? undefined : 0 };
  }
  return {
    label,
    bytes,
    status,
    ms: Date.now() - started,
    gatewayAccepted: status >= 200 && status < 300,
    appReason: payload?.reason,
    appOk: payload?.ok
  };
}

const small = await postBytes("size_4_9", 4.9);
record("http_4_9mb", small);
const large = await postBytes("size_5_1", 5.1);
record("http_5_1mb", large);

const delService = await runTcb(["service", "delete", "-p", MW05_HTTP_PATH, "--json"]);
record("http_service_delete", { code: delService.code });
const delFn = await runTcb(["fn", "delete", MW05_TEMP_HTTP_FUNCTION, "--force", "--json"]);
record("temp_fn_delete", { code: delFn.code });
const remain = await runTcb(["fn", "list", "--json"]);
const remainRows = remain.json?.data?.Functions || remain.json?.Functions || remain.json?.data || [];
const names = (Array.isArray(remainRows) ? remainRows : []).map((item) => item.FunctionName || item.Name || item.name);
record("temp_fn_gone", { present: names.includes(MW05_TEMP_HTTP_FUNCTION) });

writeMw05Cloudbaserc();
evidence.finishedAt = new Date().toISOString();
writeJson(join(tmp, "mw05-http-evidence.json"), redactMw05(evidence));
console.log(JSON.stringify(redactMw05({ ok: true, http49: small, http51: large }), null, 2));
