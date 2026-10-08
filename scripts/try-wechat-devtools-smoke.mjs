import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const project = join(root, "apps", "miniprogram");
const candidates = [
  process.env.WECHAT_DEVTOOLS_CLI,
  "C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat",
  "C:\\Program Files\\Tencent\\微信web开发者工具\\cli.bat"
].filter(Boolean);

const cli = candidates.find((p) => existsSync(p));
if (!cli) {
  console.log("WECHAT_DEVTOOLS_SMOKE=NOT_RUN reason=cli-not-found");
  process.exit(0);
}

const help = spawnSync(cli, ["-h"], { encoding: "utf8" });
const compile = spawnSync(cli, ["build-npm", "--project", project], { encoding: "utf8" });
console.log("WECHAT_DEVTOOLS_SMOKE=ATTEMPTED");
console.log(help.stdout || help.stderr || "");
console.log(compile.stdout || compile.stderr || "");
if (compile.status !== 0) {
  console.log("WECHAT_DEVTOOLS_SMOKE=FAILED");
  process.exit(1);
}
console.log("WECHAT_DEVTOOLS_SMOKE=PASS");
