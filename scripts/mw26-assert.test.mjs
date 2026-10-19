import assert from "node:assert/strict";
import {
  emptyMw26Counts,
  mw26CleanupPeriodKeys,
  mw26LeftoverDecision,
  mw26ScaleBlockedReason,
  omitDocId,
  percentileNearestRank
} from "./mw26-lib.mjs";

assert.equal(mw26LeftoverDecision({ wroteDocs: false, resolved: true, fixtureRemain: 0, seedPresent: true }).reason, "WROTE_DOCS_FALSE");
assert.equal(mw26LeftoverDecision({ wroteDocs: true, resolved: false, fixtureRemain: 0, seedPresent: true }).reason, "KNOWN_IDS_NOT_RESOLVED");
assert.equal(mw26LeftoverDecision({ wroteDocs: true, resolved: true, fixtureRemain: 3, seedPresent: true }).reason, "INDEPENDENT_REMAIN");
assert.equal(
  mw26LeftoverDecision({ wroteDocs: true, resolved: true, fixtureRemain: 0, knownIdRemain: 1, seedPresent: true }).reason,
  "KNOWN_IDS_REMAIN"
);
assert.equal(mw26LeftoverDecision({ wroteDocs: true, resolved: true, fixtureRemain: 0, seedPresent: false }).reason, "SEED_CATEGORIES_MISSING");
assert.equal(mw26LeftoverDecision({ wroteDocs: true, resolved: true, fixtureRemain: 0, seedPresent: true }).ok, true);
assert.match(mw26ScaleBlockedReason({ members: 200, papers: 20, attempts: 2000 }), /SCALE_DEGRADED/);
assert.equal(mw26ScaleBlockedReason({ members: 10000, papers: 1000, attempts: 100000 }), null);
assert.equal(percentileNearestRank([10, 20, 30, 40, 50], 95), 50);
assert.equal(omitDocId({ _id: "x", fixtureRound: "MW26" })._id, undefined);
assert.equal(emptyMw26Counts().members, 0);
assert.equal(mw26CleanupPeriodKeys({}).reason, "PERIOD_KEYS_MISSING");
assert.equal(mw26CleanupPeriodKeys({ weekKeyShanghai: "2026-10-19", monthKeyShanghai: "2026-10" }).ok, true);
assert.equal(mw26CleanupPeriodKeys({ weekKeyShanghai: "2026-10-19" }).reason, "PERIOD_KEYS_MISSING");
console.log("mw26 assert ok");
