import assert from "node:assert/strict";
import { emptyMw22KnownIds, mw22LeftoverDecision } from "./mw22-lib.mjs";

assert.equal(
  mw22LeftoverDecision({ wroteDocs: false, resolved: true, knownIds: emptyMw22KnownIds(), independentRemain: 0, seedPresent: true }).reason,
  "WROTE_DOCS_FALSE"
);
assert.equal(
  mw22LeftoverDecision({ wroteDocs: true, resolved: false, knownIds: emptyMw22KnownIds(), independentRemain: 0, seedPresent: true }).reason,
  "KNOWN_IDS_NOT_RESOLVED"
);
assert.equal(
  mw22LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: { refunds: ["a"] },
    independentRemain: 0,
    seedPresent: true
  }).reason,
  "KNOWN_IDS_REMAIN"
);
assert.equal(
  mw22LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: emptyMw22KnownIds(),
    independentRemain: 2,
    seedPresent: true
  }).reason,
  "INDEPENDENT_REMAIN"
);
assert.equal(
  mw22LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: emptyMw22KnownIds(),
    independentRemain: 0,
    seedPresent: false
  }).reason,
  "SEED_CATEGORIES_MISSING"
);
assert.equal(
  mw22LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: emptyMw22KnownIds(),
    independentRemain: 0,
    seedPresent: true
  }).ok,
  true
);
console.log("mw22 assert ok");
