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

export function authorizedEnvId(root = projectRoot()) {
  const fileEnv = readEnvFile(join(root, ".env"));
  const envId = process.env.CLOUDBASE_ENV_ID || fileEnv.CLOUDBASE_ENV_ID || "";
  const appEnv = process.env.APP_ENV || fileEnv.APP_ENV || "";
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

export async function invokeFn(name, data, options = {}) {
  const root = projectRoot();
  const tmp = join(root, "tmp", "mw04");
  mkdirSync(tmp, { recursive: true });
  const dataPath = join(tmp, `invoke-${name}-${Date.now()}.json`);
  writeJson(dataPath, data);
  const result = await runTcb(["fn", "invoke", name, "-d", `@${dataPath}`, "--json"], {
    timeoutMs: options.timeoutMs || 180000
  });
  const payload = result.json?.result || result.json?.data || parseInvokePayload(result.stdout);
  return { ...result, payload, dataPath };
}
