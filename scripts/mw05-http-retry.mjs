import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runTcb, writeJson } from "./mw04-lib.mjs";
import { MW05_HTTP_PATH, MW05_TEMP_HTTP_FUNCTION, mw05Tmp, redactMw05 } from "./mw05-lib.mjs";

const tmp = mw05Tmp();
const listed = await runTcb(["service", "list", "--json"]);
const fns = await runTcb(["fn", "list", "--json"]);
const fnRows = fns.json?.data?.Functions || [];
const fnNames = fnRows.map((item) => item.FunctionName);
const raw = listed.json?.data;
writeJson(join(tmp, "mw05-http-list-shape.json"), redactMw05({
  serviceKeys: listed.json ? Object.keys(listed.json) : [],
  dataType: Array.isArray(raw) ? "array" : typeof raw,
  dataKeys: raw && typeof raw === "object" && !Array.isArray(raw) ? Object.keys(raw) : [],
  firstKeys: Array.isArray(raw) && raw[0] ? Object.keys(raw[0]) : raw?.ServiceSet?.[0] ? Object.keys(raw.ServiceSet[0]) : [],
  fnNames,
  tempPresent: fnNames.includes(MW05_TEMP_HTTP_FUNCTION)
}));

function collectServices(value, acc = []) {
  if (!value) return acc;
  if (Array.isArray(value)) {
    for (const item of value) collectServices(item, acc);
    return acc;
  }
  if (typeof value === "object") {
    if (value.FunctionName || value.Path || value.ServicePath || value.Url) acc.push(value);
    for (const next of Object.values(value)) {
      if (next && typeof next === "object") collectServices(next, acc);
    }
  }
  return acc;
}

const services = collectServices(listed.json);
const row = services.find((item) =>
  item.FunctionName === MW05_TEMP_HTTP_FUNCTION ||
  String(item.Path || item.ServicePath || "").includes(MW05_HTTP_PATH)
);
const url = row?.Url || row?.url || row?.DefaultDomainUrl || row?.ServiceUrl;
writeJson(join(tmp, "mw05-http-retry.json"), redactMw05({
  serviceCount: services.length,
  rowKeys: row ? Object.keys(row) : [],
  urlPresent: Boolean(url),
  functionNamePresent: Boolean(row?.FunctionName),
  pathPresent: Boolean(row?.Path || row?.ServicePath)
}));

async function postBytes(label, megabytes) {
  if (!url) return { label, skipped: true, reason: "NO_HTTP_URL" };
  const bytes = Math.round(megabytes * 1024 * 1024);
  writeFileSync(join(tmp, `${label}.bin`), "x".repeat(Math.min(bytes, 16)));
  const started = Date.now();
  let status = 0;
  let payload;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "x".repeat(bytes)
    });
    status = res.status;
    try {
      payload = await res.json();
    } catch {
      payload = { text: true };
    }
  } catch (error) {
    payload = { errorName: error && error.name };
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
const large = await postBytes("size_5_1", 5.1);
const delService = await runTcb(["service", "delete", "-p", MW05_HTTP_PATH, "--json"]);
const delFn = await runTcb(["fn", "delete", MW05_TEMP_HTTP_FUNCTION, "--force", "--json"]);
const after = await runTcb(["fn", "list", "--json"]);
const afterNames = (after.json?.data?.Functions || []).map((item) => item.FunctionName);
const leftover = afterNames.includes(MW05_TEMP_HTTP_FUNCTION);
writeJson(join(tmp, "mw05-http-evidence.json"), redactMw05({
  startedAt: new Date().toISOString(),
  http_4_9mb: small,
  http_5_1mb: large,
  deleteServiceCode: delService.code,
  deleteFnCode: delFn.code,
  tempFnPresentAfter: leftover,
  officialCount: afterNames.filter((name) => name !== MW05_TEMP_HTTP_FUNCTION).length
}));
console.log(JSON.stringify(redactMw05({
  urlPresent: Boolean(url),
  http49: small,
  http51: large,
  deleteServiceCode: delService.code,
  deleteFnCode: delFn.code,
  tempFnPresentAfter: leftover
}), null, 2));
