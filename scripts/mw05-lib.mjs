import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  authorizedEnvId,
  projectRoot,
  readLocalMwEnv,
  readEnvFile,
  redact,
  writeJson
} from "./mw04-lib.mjs";

export const MW05_OFFICIAL_FUNCTIONS = [
  "cloudbase_auth",
  "mw-public",
  "mw-member",
  "mw-admin",
  "mw-upload",
  "mw-pay-hook",
  "mw-jobs"
];

export const MW05_TEMP_HTTP_FUNCTION = "mw-http-size-probe";
export const MW05_HTTP_PATH = "mw-http-size-probe";
export const ADMIN_USERS_COLLECTION = "admin_users";

export function mw05Tmp() {
  const dir = join(projectRoot(), "tmp", "mw05");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function readMw05LocalConfig(root = projectRoot()) {
  const fileEnv = readEnvFile(join(root, ".env"));
  const localPath = join(root, "configs", "local.json");
  const local = existsSync(localPath) ? JSON.parse(readFileSync(localPath, "utf8")) : {};
  const allowedRaw =
    process.env.MW_ALLOWED_MINI_APPIDS ||
    fileEnv.MW_ALLOWED_MINI_APPIDS ||
    process.env.WECHAT_APP_ID ||
    fileEnv.WECHAT_APP_ID ||
    local.wechatAppId ||
    "";
  const adminUid = process.env.MW_ADMIN_UID || fileEnv.MW_ADMIN_UID || "";
  const resourceAppId = process.env.MW_RESOURCE_APPID || fileEnv.MW_RESOURCE_APPID || "";
  return {
    ...readLocalMwEnv(root),
    allowedMiniAppIds: allowedRaw,
    adminUid,
    resourceAppId
  };
}

export function requireAdminUid() {
  const { adminUid } = readMw05LocalConfig();
  if (!adminUid || /placeholder/i.test(adminUid)) {
    throw new Error("MW_ADMIN_UID missing from local .env; set it locally and do not commit");
  }
  if (!/^\d{10,}$/.test(adminUid)) {
    throw new Error("MW_ADMIN_UID format rejected");
  }
  return adminUid;
}

export function functionConfigs(allowedMiniAppIds) {
  const envVariables = { MW_ALLOWED_MINI_APPIDS: allowedMiniAppIds || "" };
  return [
    { name: "cloudbase_auth", timeout: 10, memorySize: 256, envVariables },
    { name: "mw-public", timeout: 10, memorySize: 256, envVariables },
    { name: "mw-member", timeout: 15, memorySize: 256, envVariables },
    { name: "mw-admin", timeout: 15, memorySize: 256, envVariables },
    { name: "mw-upload", timeout: 30, memorySize: 512, envVariables },
    { name: "mw-pay-hook", timeout: 10, memorySize: 256, envVariables },
    { name: "mw-jobs", timeout: 60, memorySize: 512, envVariables }
  ].map((fn) => ({
    ...fn,
    runtime: "Nodejs20.19",
    handler: "index.main",
    installDependency: fn.name === "mw-http-size-probe" ? false : true
  }));
}

export function writeMw05Cloudbaserc(extraFunctions = []) {
  const envId = authorizedEnvId();
  const { allowedMiniAppIds } = readMw05LocalConfig();
  const config = {
    version: "2.0",
    envId,
    region: "ap-shanghai",
    functionRoot: "./cloudfunctions",
    functions: [...functionConfigs(allowedMiniAppIds), ...extraFunctions]
  };
  writeJson(join(projectRoot(), "cloudbaserc.json"), config);
  return config;
}

export function writeAdminLocalEnv() {
  const { envId } = readLocalMwEnv();
  const dest = join(projectRoot(), "apps", "admin", ".env.local");
  writeFileSync(
    dest,
    `VITE_CLOUDBASE_REGION=ap-shanghai\nVITE_CLOUDBASE_ENV_ID=${envId}\n`,
    "utf8"
  );
  return dest;
}

export function writeMiniprogramLocalCloud() {
  const { envId } = readLocalMwEnv();
  const { resourceAppId, allowedMiniAppIds } = readMw05LocalConfig();
  const dest = join(projectRoot(), "apps", "miniprogram", "cloud.local.js");
  writeFileSync(
    dest,
    `module.exports = {\n  resourceEnvPresent: ${Boolean(envId)},\n  resourceAppIdPresent: ${Boolean(resourceAppId && !/placeholder/i.test(resourceAppId))},\n  allowedMiniAppIdPresent: ${Boolean(allowedMiniAppIds && !/placeholder/i.test(allowedMiniAppIds))},\n  resourceEnv: ${JSON.stringify(envId)},\n  resourceAppId: ${JSON.stringify(resourceAppId)},\n  callerAppId: ${JSON.stringify(allowedMiniAppIds.split(/[,\s]+/)[0] || "")}\n};\n`,
    "utf8"
  );
  return dest;
}

export function redactMw05(value) {
  const hidden = [];
  try {
    hidden.push(authorizedEnvId());
  } catch {
    /* ignore */
  }
  const local = readMw05LocalConfig();
  if (local.adminUid) hidden.push(local.adminUid);
  if (local.allowedMiniAppIds) hidden.push(...local.allowedMiniAppIds.split(/[,\s]+/).filter(Boolean));
  if (local.resourceAppId) hidden.push(local.resourceAppId);
  const first = redact(value);
  return hideStrings(first, hidden);
}

function hideStrings(value, hidden) {
  if (value == null) return value;
  if (typeof value === "string") {
    let out = value;
    for (const item of hidden) {
      if (item && out.includes(item)) out = out.split(item).join("[redacted]");
    }
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => hideStrings(item, hidden));
  if (typeof value === "object") {
    const out = {};
    for (const [key, next] of Object.entries(value)) out[key] = hideStrings(next, hidden);
    return out;
  }
  return value;
}
