import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, readEnvFile } from "./mw04-lib.mjs";

const PLACEHOLDER = /placeholder|example|xxxx|your-|not-real|sandbox-placeholder|offer_placeholder|wx_placeholder/i;

export const MW07B_ENV_NAMES = [
  "VIRTUAL_PAY_OFFER_ID",
  "VIRTUAL_PAY_ENV",
  "VIRTUAL_PAY_APP_KEY",
  "VIRTUAL_PAY_APP_KEY_LIVE",
  "VIRTUAL_PAY_NOTIFY_TOKEN",
  "VIRTUAL_PAY_ENCODING_AES_KEY",
  "WECHAT_APP_ID",
  "WECHAT_APP_SECRET"
];

function parseEnvFile(path) {
  return existsSync(path) ? readEnvFile(path) : {};
}

export function envNameStatus(name, value, exampleValue) {
  if (value === undefined || String(value).trim() === "") return "缺失";
  const text = String(value).trim();
  if (PLACEHOLDER.test(text)) return "仍为占位";
  if (exampleValue !== undefined && text === String(exampleValue).trim() && PLACEHOLDER.test(String(exampleValue))) {
    return "仍为占位";
  }
  if (name === "VIRTUAL_PAY_ENV") {
    return text === "0" || text === "1" ? "存在" : "仍为占位";
  }
  return "存在";
}

export function readMw07bEnvNames(root = projectRoot()) {
  const env = parseEnvFile(join(root, ".env"));
  const example = parseEnvFile(join(root, ".env.example"));
  const statuses = {};
  for (const name of MW07B_ENV_NAMES) {
    statuses[name] = envNameStatus(name, env[name], example[name]);
  }
  return statuses;
}

export function sandboxQueryReady(statuses) {
  return (
    statuses.VIRTUAL_PAY_OFFER_ID === "存在" &&
    statuses.VIRTUAL_PAY_ENV === "存在" &&
    statuses.VIRTUAL_PAY_APP_KEY === "存在" &&
    statuses.WECHAT_APP_ID === "存在" &&
    statuses.WECHAT_APP_SECRET === "存在"
  );
}

export function printEnvNameStatuses(statuses) {
  for (const name of MW07B_ENV_NAMES) {
    console.log(`${name}=${statuses[name]}`);
  }
}
