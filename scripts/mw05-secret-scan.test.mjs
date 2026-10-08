import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, readEnvFile } from "./mw04-lib.mjs";

const root = projectRoot();
const tracked = execSync("git ls-files", { cwd: root, encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean);
const forbidden = [];
const env = readEnvFile(join(root, ".env"));
const secrets = [
  env.CLOUDBASE_ENV_ID,
  env.MW_ADMIN_UID,
  env.MW_ALLOWED_MINI_APPIDS,
  env.WECHAT_APP_ID,
  env.MW_RESOURCE_APPID,
  env.VIRTUAL_PAY_APP_KEY,
  env.WECHAT_APP_SECRET
].filter((value) => value && !/placeholder|example|xxxx|your-/i.test(value));

for (const file of tracked) {
  if (file.endsWith(".png") || file.endsWith(".jpg") || file.includes("package-lock.json")) continue;
  const text = readFileSync(join(root, file), "utf8");
  for (const secret of secrets) {
    if (secret && text.includes(secret)) {
      forbidden.push(`${file} contains a local secret value`);
    }
  }
  if (/password\s*[:=]\s*['"][^'"]{4,}['"]/i.test(text) && !file.includes(".example")) {
    forbidden.push(`${file} looks like a hardcoded password`);
  }
}

assert.equal(forbidden.length, 0, forbidden.join("\n"));
console.log(`secret scan passed on ${tracked.length} tracked files`);
