import assert from "node:assert/strict";
import { emptyMw25KnownIds, mw25LeftoverDecision } from "./mw25-lib.mjs";

assert.equal(
  mw25LeftoverDecision({ wroteDocs: false, resolved: true, knownIds: emptyMw25KnownIds(), independentRemain: 0, seedPresent: true }).reason,
  "WROTE_DOCS_FALSE"
);
assert.equal(
  mw25LeftoverDecision({ wroteDocs: true, resolved: false, knownIds: emptyMw25KnownIds(), independentRemain: 0, seedPresent: true }).reason,
  "KNOWN_IDS_NOT_RESOLVED"
);
assert.equal(
  mw25LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: { snapshots: ["a"] },
    independentRemain: 0,
    seedPresent: true
  }).reason,
  "KNOWN_IDS_REMAIN"
);
assert.equal(
  mw25LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: emptyMw25KnownIds(),
    independentRemain: 2,
    seedPresent: true
  }).reason,
  "INDEPENDENT_REMAIN"
);
assert.equal(
  mw25LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: emptyMw25KnownIds(),
    independentRemain: 0,
    seedPresent: false
  }).reason,
  "SEED_CATEGORIES_MISSING"
);
assert.equal(
  mw25LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: emptyMw25KnownIds(),
    independentRemain: 0,
    seedPresent: true
  }).ok,
  true
);
console.log("mw25 assert ok");
