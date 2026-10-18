import assert from "node:assert/strict";
import { emptyMw21KnownIds, mw21LeftoverDecision } from "./mw21-lib.mjs";

assert.equal(
  mw21LeftoverDecision({ wroteDocs: false, resolved: true, knownIds: emptyMw21KnownIds(), independentRemain: 0, seedPresent: true }).reason,
  "WROTE_DOCS_FALSE"
);
assert.equal(
  mw21LeftoverDecision({ wroteDocs: true, resolved: false, knownIds: emptyMw21KnownIds(), independentRemain: 0, seedPresent: true }).reason,
  "KNOWN_IDS_NOT_RESOLVED"
);
assert.equal(
  mw21LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: { orders: ["a"] },
    independentRemain: 0,
    seedPresent: true
  }).reason,
  "KNOWN_IDS_REMAIN"
);
assert.equal(
  mw21LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: emptyMw21KnownIds(),
    independentRemain: 2,
    seedPresent: true
  }).reason,
  "INDEPENDENT_REMAIN"
);
assert.equal(
  mw21LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: emptyMw21KnownIds(),
    independentRemain: 0,
    seedPresent: true,
    forbiddenPresent: true
  }).reason,
  "FORBIDDEN_COLLECTION_PRESENT"
);
assert.equal(
  mw21LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: emptyMw21KnownIds(),
    independentRemain: 0,
    seedPresent: true
  }).ok,
  true
);
console.log("mw21 assert ok");
