import { runTcb, authorizedEnvId, writeJson } from "./mw04-lib.mjs";
import { MW05_HTTP_PATH, MW05_TEMP_HTTP_FUNCTION, mw05Tmp, redactMw05 } from "./mw05-lib.mjs";
import { join } from "node:path";

const tmp = mw05Tmp();
const envId = authorizedEnvId();
const listed = await runTcb(["service", "list", "--json"]);
const services = Array.isArray(listed.json?.data) ? listed.json.data : [];
const row = services.find((item) =>
  String(item.path || item.name || "").includes(MW05_HTTP_PATH) ||
  item.name === MW05_TEMP_HTTP_FUNCTION
);
const candidates = [
  row?.url,
  row?.Url,
  row?.id && row?.path ? undefined : undefined,
  `https://${envId}.service.tcloudbase.com/${String(row?.path || MW05_HTTP_PATH).replace(/^\//, "")}`,
  `https://${envId}.ap-shanghai.tcb-api.tencentcloudapi.com/${String(row?.path || MW05_HTTP_PATH).replace(/^\//, "")}`
].filter(Boolean);

writeJson(join(tmp, "mw05-http-services.json"), redactMw05({
  count: services.length,
  row: row ? { path: Boolean(row.path), name: Boolean(row.name), idPresent: Boolean(row.id), type: row.type } : null,
  candidateCount: candidates.length
}));

async function tryPost(url, megabytes) {
  const bytes = Math.round(megabytes * 1024 * 1024);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "x".repeat(bytes)
    });
    let payload;
    try {
      payload = await res.json();
    } catch {
      payload = {};
    }
    return {
      status: res.status,
      ms: Date.now() - started,
      bytes,
      gatewayAccepted: res.status >= 200 && res.status < 300,
      appReason: payload.reason,
      appOk: payload.ok
    };
  } catch (error) {
    return {
      status: 0,
      ms: Date.now() - started,
      bytes,
      gatewayAccepted: false,
      errorName: error && error.name
    };
  }
}

let used = null;
let small;
let large;
for (const url of candidates) {
  small = await tryPost(url, 4.9);
  if (small.status > 0) {
    used = true;
    large = await tryPost(url, 5.1);
    break;
  }
}

const delByName = await runTcb(["service", "delete", "-n", MW05_TEMP_HTTP_FUNCTION, "--json"]);
const delByPath = await runTcb(["service", "delete", "-p", MW05_HTTP_PATH, "--json"]);
const delFn = await runTcb(["fn", "delete", MW05_TEMP_HTTP_FUNCTION, "--json"]);
const after = await runTcb(["fn", "list", "--json"]);
const afterNames = (after.json?.data?.Functions || []).map((item) => item.FunctionName);
const afterServices = await runTcb(["service", "list", "--json"]);
const leftoverServices = (Array.isArray(afterServices.json?.data) ? afterServices.json.data : []).filter((item) =>
  String(item.path || item.name || "").includes(MW05_HTTP_PATH)
);

writeJson(join(tmp, "mw05-http-evidence.json"), redactMw05({
  finishedAt: new Date().toISOString(),
  urlTried: Boolean(used),
  http_4_9mb: small,
  http_5_1mb: large,
  deleteServiceByName: delByName.code,
  deleteServiceByPath: delByPath.code,
  deleteFn: delFn.code,
  tempFnPresentAfter: afterNames.includes(MW05_TEMP_HTTP_FUNCTION),
  leftoverHttpServices: leftoverServices.length,
  officialCount: afterNames.filter((name) => name !== MW05_TEMP_HTTP_FUNCTION).length
}));
console.log(JSON.stringify(redactMw05({
  urlTried: Boolean(used),
  http49: small,
  http51: large,
  deleteFn: delFn.code,
  tempFnPresentAfter: afterNames.includes(MW05_TEMP_HTTP_FUNCTION),
  leftoverHttpServices: leftoverServices.length
}), null, 2));
