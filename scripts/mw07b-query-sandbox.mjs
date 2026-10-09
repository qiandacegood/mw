import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, readEnvFile } from "./mw04-lib.mjs";
import { printEnvNameStatuses, readMw07bEnvNames, sandboxQueryReady } from "./mw07b-lib.mjs";

const root = projectRoot();
const statuses = readMw07bEnvNames(root);
printEnvNameStatuses(statuses);

const outDir = join(root, "tmp", "mw07b");
mkdirSync(outDir, { recursive: true });

if (!sandboxQueryReady(statuses)) {
  const blocked = {
    called: false,
    wroteDocs: false,
    reason: "ACCESS_TOKEN_PREREQ_MISSING",
    missing: Object.entries(statuses)
      .filter(([, status]) => status !== "存在")
      .filter(([name]) =>
        ["VIRTUAL_PAY_OFFER_ID", "VIRTUAL_PAY_ENV", "VIRTUAL_PAY_APP_KEY", "WECHAT_APP_ID", "WECHAT_APP_SECRET"].includes(name)
      )
      .map(([name]) => name)
  };
  writeFileSync(join(outDir, "query-sandbox.json"), JSON.stringify(blocked, null, 2));
  console.log("sandbox query blocked; wroteDocs=false");
  process.exit(0);
}

const env = readEnvFile(join(root, ".env"));
if (String(env.VIRTUAL_PAY_ENV || "").trim() !== "1") {
  const blocked = { called: false, wroteDocs: false, reason: "SANDBOX_ENV_REQUIRED" };
  writeFileSync(join(outDir, "query-sandbox.json"), JSON.stringify(blocked, null, 2));
  console.log("sandbox query blocked; wroteDocs=false");
  process.exit(0);
}

const { calcPaySig } = await import("../packages/shared/dist/virtual-pay.js");
const openid = "mw07b_unknown_openid";
const orderId = "mw07b_unknown_order";
const postBody = JSON.stringify({ openid, env: 1, order_id: orderId });
const tokenUrl = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(env.WECHAT_APP_ID)}&secret=${encodeURIComponent(env.WECHAT_APP_SECRET)}`;
const tokenRes = await fetch(tokenUrl);
const tokenJson = await tokenRes.json();
const accessToken = typeof tokenJson.access_token === "string" ? tokenJson.access_token : "";
if (!accessToken) {
  const blocked = {
    called: false,
    wroteDocs: false,
    reason: "ACCESS_TOKEN_FAILED",
    tokenErrcode: typeof tokenJson.errcode === "number" ? tokenJson.errcode : undefined
  };
  writeFileSync(join(outDir, "query-sandbox.json"), JSON.stringify(blocked, null, 2));
  console.log("sandbox query blocked; wroteDocs=false");
  process.exit(0);
}

const paySig = calcPaySig("/xpay/query_order", postBody, env.VIRTUAL_PAY_APP_KEY);
const url = `https://api.weixin.qq.com/xpay/query_order?access_token=${encodeURIComponent(accessToken)}&pay_sig=${encodeURIComponent(paySig)}`;
const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: postBody
});
const json = await res.json();
const errcode = typeof json.errcode === "number" ? json.errcode : undefined;
const record = {
  called: true,
  wroteDocs: false,
  env: 1,
  httpStatus: res.status,
  errcode,
  signatureAccepted: errcode === 268490003 ? false : errcode !== undefined,
  authPathReached: errcode !== 40001 && errcode !== 40125 && errcode !== 41001 && errcode !== 40013
};
writeFileSync(join(outDir, "query-sandbox.json"), JSON.stringify(record, null, 2));
console.log("sandbox query finished; wroteDocs=false");
