import assert from "node:assert/strict";
import { emptyMw23KnownIds, mw23LeftoverDecision } from "./mw23-lib.mjs";

assert.equal(
  mw23LeftoverDecision({ wroteDocs: false, resolved: true, knownIds: emptyMw23KnownIds(), independentRemain: 0, seedPresent: true }).reason,
  "WROTE_DOCS_FALSE"
);
assert.equal(
  mw23LeftoverDecision({ wroteDocs: true, resolved: false, knownIds: emptyMw23KnownIds(), independentRemain: 0, seedPresent: true }).reason,
  "KNOWN_IDS_NOT_RESOLVED"
);
assert.equal(
  mw23LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: { feedbacks: ["a"] },
    independentRemain: 0,
    seedPresent: true
  }).reason,
  "KNOWN_IDS_REMAIN"
);
assert.equal(
  mw23LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: emptyMw23KnownIds(),
    independentRemain: 2,
    seedPresent: true
  }).reason,
  "INDEPENDENT_REMAIN"
);
assert.equal(
  mw23LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: emptyMw23KnownIds(),
    independentRemain: 0,
    seedPresent: false
  }).reason,
  "SEED_CATEGORIES_MISSING"
);
assert.equal(
  mw23LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: { members: ["keep-account"] },
    independentRemain: 0,
    seedPresent: true
  }).ok,
  true
);
console.log("mw23 assert ok");
