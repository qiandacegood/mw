import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { ADMIN_PUBLIC_HOST, ADMIN_PUBLIC_ORIGIN, adminHostingConfig } from "./mw05-lib.mjs";

const root = projectRoot();
const tmp = join(root, "tmp", "admin-hosting");
mkdirSync(tmp, { recursive: true });

const evidence = { startedAt: new Date().toISOString(), origin: ADMIN_PUBLIC_ORIGIN, steps: [] };

function record(name, value) {
  evidence.steps.push({ name, ...(value && typeof value === "object" ? value : { detail: value }) });
  writeJson(join(tmp, "admin-hosting-evidence.json"), evidence);
}

function mergeHostingIntoCloudbaserc() {
  const path = join(root, "cloudbaserc.json");
  const current = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  current.hosting = adminHostingConfig();
  writeJson(path, current);
  return current.hosting;
}

const ready = await assertMwTestReady();
if (ready.enableOverrun === true) throw new Error("EnableOverrun must stay false");
authorizedEnvId();
record("hard_check", { ok: ready.ok, enableOverrun: ready.enableOverrun });

mergeHostingIntoCloudbaserc();
record("cloudbaserc_hosting", { ok: true, host: ADMIN_PUBLIC_HOST });

const shared = spawnSync(process.execPath, [join(root, "scripts", "ensure-shared-js.mjs")], {
  cwd: root,
  encoding: "utf8"
});
if (shared.status !== 0) {
  throw new Error(`shared emit failed: ${shared.stderr || shared.stdout}`);
}
record("ensure_shared", { ok: true });

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const built = spawnSync(npmCmd, ["run", "build", "-w", "@mw/admin"], {
  cwd: root,
  encoding: "utf8"
});
if (built.status !== 0) {
  throw new Error(`admin build failed: ${built.stderr || built.stdout}`);
}
record("admin_build", { ok: true });

const distIndex = join(root, "apps", "admin", "dist", "index.html");
if (!existsSync(distIndex)) {
  throw new Error("admin dist/index.html missing after build");
}

const deployed = await runTcb(
  ["hosting", "deploy", "./apps/admin/dist", "/", "--json"],
  { timeoutMs: 300000 }
);
record("hosting_deploy", {
  code: deployed.code,
  ok: deployed.code === 0,
  stdout: String(deployed.stdout || "").slice(0, 4000),
  stderr: String(deployed.stderr || "").slice(0, 2000)
});
if (deployed.code !== 0) {
  throw new Error(`hosting deploy failed: ${deployed.stderr || deployed.stdout}`);
}

const listed = await runTcb(["hosting", "list", "--json"]);
const keys = (listed.json?.data || []).map((item) => item.key);
record("hosting_list", {
  code: listed.code,
  hasIndex: keys.includes("index.html"),
  preservedAuth: keys.some((key) => String(key).startsWith("__auth/"))
});
if (!keys.includes("index.html")) {
  throw new Error("hosting list missing index.html after deploy");
}

const page = await fetch(ADMIN_PUBLIC_ORIGIN + "/");
const html = await page.text();
record("public_get", {
  status: page.status,
  ok: page.ok,
  titlePresent: html.includes("思维工坊")
});
if (!page.ok || !html.includes("思维工坊")) {
  throw new Error(`public origin not serving admin: HTTP ${page.status}`);
}

evidence.finishedAt = new Date().toISOString();
writeJson(join(tmp, "admin-hosting-evidence.json"), evidence);
console.log(`admin hosting ready at ${ADMIN_PUBLIC_ORIGIN}`);
