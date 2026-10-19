import assert from "node:assert/strict";
import {
  emptyMw27Counts,
  MW27_NEVER_DELETE,
  MW27_ISOLATED_RESTORE_COLLECTIONS,
  mw27LeftoverDecision,
  omitDocId
} from "./mw27-lib.mjs";

assert.equal(mw27LeftoverDecision({ wroteDocs: false, resolved: true, fixtureRemain: 0, seedPresent: true }).reason, "WROTE_DOCS_FALSE");
assert.equal(mw27LeftoverDecision({ wroteDocs: true, resolved: false, fixtureRemain: 0, seedPresent: true }).reason, "KNOWN_IDS_NOT_RESOLVED");
assert.equal(mw27LeftoverDecision({ wroteDocs: true, resolved: true, fixtureRemain: 3, seedPresent: true }).reason, "INDEPENDENT_REMAIN");
assert.equal(mw27LeftoverDecision({ wroteDocs: true, resolved: true, isolatedRemain: 2, seedPresent: true }).reason, "ISOLATED_RESTORE_REMAIN");
assert.equal(
  mw27LeftoverDecision({ wroteDocs: true, resolved: true, fixtureRemain: 0, knownIdRemain: 1, seedPresent: true }).reason,
  "KNOWN_IDS_REMAIN"
);
assert.equal(mw27LeftoverDecision({ wroteDocs: true, resolved: true, fixtureRemain: 0, seedPresent: false }).reason, "SEED_CATEGORIES_MISSING");
assert.equal(mw27LeftoverDecision({ wroteDocs: true, resolved: true, fixtureRemain: 0, isolatedRemain: 0, seedPresent: true }).ok, true);
assert.equal(omitDocId({ _id: "x", fixtureRound: "MW27" })._id, undefined);
assert.equal(emptyMw27Counts().isolated, 0);
assert.ok(!MW27_NEVER_DELETE.includes("mw27_rst_orders"));
assert.ok(MW27_NEVER_DELETE.includes("ranking_rows"));
assert.ok(MW27_NEVER_DELETE.includes("ranking_heads"));
assert.ok(MW27_ISOLATED_RESTORE_COLLECTIONS.every((name) => name.startsWith("mw27_rst_")));
console.log("mw27 assert ok");
