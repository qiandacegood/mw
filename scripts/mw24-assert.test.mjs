import assert from "node:assert/strict";
import { emptyMw24KnownIds, mw24LeftoverDecision } from "./mw24-lib.mjs";

assert.equal(
  mw24LeftoverDecision({ wroteDocs: false, resolved: true, knownIds: emptyMw24KnownIds(), independentRemain: 0, seedPresent: true }).reason,
  "WROTE_DOCS_FALSE"
);
assert.equal(
  mw24LeftoverDecision({ wroteDocs: true, resolved: false, knownIds: emptyMw24KnownIds(), independentRemain: 0, seedPresent: true }).reason,
  "KNOWN_IDS_NOT_RESOLVED"
);
assert.equal(
  mw24LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: { feedbacks: ["a"] },
    independentRemain: 0,
    seedPresent: true
  }).reason,
  "KNOWN_IDS_REMAIN"
);
assert.equal(
  mw24LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: emptyMw24KnownIds(),
    independentRemain: 2,
    seedPresent: true
  }).reason,
  "INDEPENDENT_REMAIN"
);
assert.equal(
  mw24LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: emptyMw24KnownIds(),
    independentRemain: 0,
    seedPresent: false
  }).reason,
  "SEED_CATEGORIES_MISSING"
);
assert.equal(
  mw24LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: emptyMw24KnownIds(),
    independentRemain: 0,
    seedPresent: true
  }).ok,
  true
);
console.log("mw24 assert ok");
