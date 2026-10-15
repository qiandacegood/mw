import assert from "node:assert/strict";
import { emptyMw18KnownIds, mw18LeftoverDecision } from "./mw18-lib.mjs";

assert.equal(mw18LeftoverDecision({ wroteDocs: false, resolved: true, knownIds: emptyMw18KnownIds(), seedPresent: true }).reason, "WROTE_DOCS_FALSE");
assert.equal(mw18LeftoverDecision({ wroteDocs: true, resolved: false, knownIds: emptyMw18KnownIds(), seedPresent: true }).reason, "KNOWN_IDS_NOT_RESOLVED");
assert.equal(
  mw18LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: { categories: ["a"] },
    seedPresent: true
  }).reason,
  "KNOWN_IDS_REMAIN"
);
assert.equal(
  mw18LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: emptyMw18KnownIds(),
    seedPresent: false
  }).reason,
  "SEED_CATEGORIES_MISSING"
);
assert.equal(
  mw18LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: emptyMw18KnownIds(),
    seedPresent: true
  }).ok,
  true
);
console.log("mw18 assert ok");
