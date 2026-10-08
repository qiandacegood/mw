import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = () => join(dirname(fileURLToPath(import.meta.url)), "..");

const SENSITIVE_KEY = /secret|token|password|authorization|credential|cookie|private[_-]?key|api[_-]?key|session|openid|open_id|session_key/i;

export function readEnvFile(path) {
  if (!existsSync(path)) {
    return {};
  }
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 1) {
      continue;
    }
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

export function readLocalMwEnv(root = projectRoot()) {
  const fileEnv = readEnvFile(join(root, ".env"));
  return {
    envId: process.env.CLOUDBASE_ENV_ID || fileEnv.CLOUDBASE_ENV_ID || "",
    appEnv: process.env.APP_ENV || fileEnv.APP_ENV || ""
  };
}

export function authorizedEnvId(root = projectRoot()) {
  const { envId, appEnv } = readLocalMwEnv(root);
  if (!envId || envId === "env-placeholder-not-real") {
    throw new Error("CLOUDBASE_ENV_ID missing or placeholder; set it in local .env");
  }
  if (appEnv !== "mw-test") {
    throw new Error("APP_ENV must be mw-test for MW04");
  }
  if (!/^mw-[a-z0-9]+$/i.test(envId)) {
    throw new Error("refusing to operate on an environment that is not the authorized mw-test id");
  }
  return envId;
}

export const MW_VALIDATION_FUNCTIONS = [
  "mw-validation-runtime22",
  "mw-validation-probe",
  "mw-validation-public",
  "mw-validation-member",
  "mw-validation-admin",
  "mw-validation-upload",
  "mw-validation-pay-hook",
  "mw-validation-jobs"
];

export const MW_VALIDATION_COLLECTIONS = [
  "mw_validation_tx",
  "mw_validation_index",
  "mw_validation_admin_users",
  "mw_validation_files",
  "mw_validation_docs"
];

export const MW_VALIDATION_STORAGE_PREFIX = "mw-test/validation/";

export function recordStep(steps, stepName, value) {
  const payload =
    value && typeof value === "object" && !Array.isArray(value) ? { ...value } : { detail: value };
  if (payload.name !== undefined && payload.name !== stepName) {
    payload.detailName = payload.name;
    delete payload.name;
  }
  if (payload.error != null && typeof payload.error !== "object") {
    payload.error = { message: String(payload.error) };
  }
  steps.push({ ...payload, name: stepName });
  return steps;
}

function pickRegion(detailJson) {
  const data = detailJson?.data || detailJson || {};
  return (
    data.Region ||
    data.region ||
    data.EnvInfo?.Region ||
    data.EnvInfo?.region ||
    data.Databases?.[0]?.Region ||
    data.Storages?.[0]?.Region ||
    data.Functions?.[0]?.Region ||
    ""
  );
}

function collectStorageHosts(detailJson) {
  const data = detailJson?.data || detailJson || {};
  const storages = data.Storages || data.Storage || data.storages || [];
  const list = Array.isArray(storages) ? storages : [storages];
  const hosts = [];
  for (const item of list) {
    if (!item || typeof item !== "object") {
      continue;
    }
    for (const key of ["CdnDomain", "cdnDomain", "Domain", "domain", "Bucket"]) {
      const value = item[key];
      if (typeof value === "string" && value.includes(".")) {
        hosts.push(value.replace(/^https?:\/\//, "").replace(/\/$/, ""));
      }
    }
  }
  return [...new Set(hosts)];
}

export async function assertMwTestReady() {
  const { envId, appEnv } = readLocalMwEnv();
  if (appEnv !== "mw-test") {
    throw new Error("hard check failed: APP_ENV is not mw-test");
  }
  if (!envId || envId === "env-placeholder-not-real" || !/^mw-[a-z0-9]+$/i.test(envId)) {
    throw new Error("hard check failed: CLOUDBASE_ENV_ID is missing or not an mw-* test id");
  }
  const envList = await runTcb(["env", "list", "--json"]);
  if (envList.code !== 0) {
    throw new Error("hard check failed: env list command failed");
  }
  const rows = envList.json?.data || [];
  const row = rows.find((item) => item.EnvId === envId);
  if (!row) {
    throw new Error("hard check failed: authorized env is not in env list; refusing cloud operations");
  }
  if (row.EnableOverrun === true || row.EnableOverrun === "true") {
    throw new Error("hard check failed: EnableOverrun is not false");
  }
  const personal = row.PackageId === "baas_personal" || row.PackageName === "个人版";
  if (!personal) {
    throw new Error("hard check failed: package is not personal");
  }
  const detail = await runTcb(["env", "detail", "--json", "--yes"]);
  if (detail.code !== 0) {
    throw new Error("hard check failed: env detail command failed");
  }
  const region = pickRegion(detail.json);
  if (region && region !== "ap-shanghai") {
    throw new Error("hard check failed: region is not ap-shanghai");
  }
  if (!region && !/ap-shanghai/.test(detail.stdout || "")) {
    throw new Error("hard check failed: region could not be confirmed as ap-shanghai");
  }
  return {
    ok: true,
    appEnv: "mw-test",
    region: "ap-shanghai",
    package: "personal",
    enableOverrun: false,
    otherEnvCount: rows.filter((item) => item.EnvId !== envId).length,
    storageHosts: collectStorageHosts(detail.json)
  };
}

export function publicObjectUrls(hosts, cloudPath) {
  const path = String(cloudPath || "").replace(/^\//, "");
  return (hosts || []).map((host) => `https://${host}/${path}`);
}

function envIdPattern() {
  try {
    return authorizedEnvId();
  } catch {
    return "";
  }
}

export function redact(value, key = "") {
  if (value == null) {
    return value;
  }
  if (typeof value === "string") {
    const hiddenEnv = envIdPattern();
    if (SENSITIVE_KEY.test(key) || (hiddenEnv && value.includes(hiddenEnv))) {
      return /env/i.test(key) ? "[env-id-redacted]" : "[redacted]";
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, key));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [nextKey, nextValue] of Object.entries(value)) {
      out[nextKey] = redact(nextValue, nextKey);
    }
    return out;
  }
  return value;
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function writeText(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

function tcbEntry() {
  const root = projectRoot();
  const candidates = [
    join(root, "node_modules", "@cloudbase", "cli", "dist", "standalone", "cli.js"),
    join(process.env.APPDATA || "", "npm", "node_modules", "@cloudbase", "cli", "dist", "standalone", "cli.js"),
    "F:\\Software\\nodejs\\node_modules\\@cloudbase\\cli\\dist\\standalone\\cli.js"
  ];
  for (const file of candidates) {
    if (file && existsSync(file)) {
      return { command: process.execPath, prefix: [file] };
    }
  }
  return { command: process.platform === "win32" ? "tcb.cmd" : "tcb", prefix: [] };
}

export async function runCommand(command, args, options = {}) {
  const { cwd = projectRoot(), timeoutMs = 180000, input } = options;
  const resolved = command === "tcb" ? tcbEntry() : { command, prefix: [] };
  return await new Promise((resolve) => {
    const child = spawn(resolved.command, [...resolved.prefix, ...args], {
      cwd,
      shell: false,
      windowsHide: true,
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: 124, stdout, stderr: `${stderr}\ntimeout ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    if (input) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

export async function runTcb(args, options = {}) {
  const envId = authorizedEnvId();
  const full = args.includes("-e") || args.includes("--env-id") ? args : [...args, "-e", envId];
  const result = await runCommand("tcb", full, options);
  let json;
  if (full.includes("--json") && result.stdout.trim()) {
    try {
      json = JSON.parse(result.stdout);
    } catch {
      const start = result.stdout.indexOf("{");
      const end = result.stdout.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          json = JSON.parse(result.stdout.slice(start, end + 1));
        } catch {
          json = undefined;
        }
      }
    }
  }
  return { ...result, json };
}

export function parseInvokePayload(stdout) {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return undefined;
  }
  try {
    return JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

export function extractFnResult(invoke) {
  const data = invoke?.json?.data;
  if (data && typeof data.RetMsg === "string" && data.RetMsg.trim()) {
    try {
      return JSON.parse(data.RetMsg);
    } catch {
      const parsed = parseInvokePayload(data.RetMsg);
      if (parsed) return parsed;
    }
  }
  if (invoke?.json?.result && typeof invoke.json.result === "object" && invoke.json.result !== null) {
    return invoke.json.result;
  }
  if (data && typeof data.ok === "boolean") {
    return data;
  }
  return parseInvokePayload(data?.RetMsg || invoke?.stdout || "");
}

export async function invokeFn(name, data, options = {}) {
  const root = projectRoot();
  const tmp = join(root, "tmp", "mw04");
  mkdirSync(tmp, { recursive: true });
  const dataPath = join(tmp, `invoke-${name}-${Date.now()}.json`);
  writeJson(dataPath, data);
  const result = await runTcb(["fn", "invoke", name, "-d", `@${dataPath}`, "--json"], {
    timeoutMs: options.timeoutMs || 180000
  });
  const payload = extractFnResult(result) || result.json?.result || result.json?.data || parseInvokePayload(result.stdout);
  return { ...result, payload, dataPath };
}
