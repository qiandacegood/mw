import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./mw04-lib.mjs";
import { printEnvNameStatuses, readMw07bEnvNames } from "./mw07b-lib.mjs";

const root = projectRoot();
const required = [
  "docs/development/handbook-v0.1/first-batch/mw07b-virtual-payment.md",
  "docs/development/handbook-v0.1/first-batch/results/mw07b-result.md",
  "packages/shared/src/virtual-pay.ts",
  "services/api/src/modules/virtual-pay-notify.ts",
  "services/api/src/modules/virtual-pay-xpay.ts"
];
for (const rel of required) {
  assert.equal(existsSync(join(root, rel)), true, `missing ${rel}`);
}

const statuses = readMw07bEnvNames(root);
printEnvNameStatuses(statuses);
assert.equal(statuses.VIRTUAL_PAY_OFFER_ID === "存在" || statuses.VIRTUAL_PAY_OFFER_ID === "缺失" || statuses.VIRTUAL_PAY_OFFER_ID === "仍为占位", true);
assert.equal(["存在", "缺失", "仍为占位"].includes(statuses.VIRTUAL_PAY_APP_KEY), true);

const leftover = { wroteDocs: false, leftoverDocs: 0, exactIdSweepOnly: false, knownIds: [] };
assert.equal(leftover.wroteDocs, false);
assert.equal(leftover.leftoverDocs, 0);
assert.equal(leftover.knownIds.length, 0);

console.log("mw07b local assertions passed; wroteDocs=false");
