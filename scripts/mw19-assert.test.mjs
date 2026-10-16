import assert from "node:assert/strict";
import { emptyMw19KnownIds, mw19LeftoverDecision } from "./mw19-lib.mjs";

assert.equal(
  mw19LeftoverDecision({ wroteDocs: false, resolved: true, knownIds: emptyMw19KnownIds(), independentRemain: 0, seedPresent: true }).reason,
  "WROTE_DOCS_FALSE"
);
assert.equal(
  mw19LeftoverDecision({ wroteDocs: true, resolved: false, knownIds: emptyMw19KnownIds(), independentRemain: 0, seedPresent: true }).reason,
  "KNOWN_IDS_NOT_RESOLVED"
);
assert.equal(
  mw19LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: { papers: ["a"] },
    independentRemain: 0,
    seedPresent: true
  }).reason,
  "KNOWN_IDS_REMAIN"
);
assert.equal(
  mw19LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: emptyMw19KnownIds(),
    independentRemain: 2,
    seedPresent: true
  }).reason,
  "INDEPENDENT_REMAIN"
);
assert.equal(
  mw19LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: emptyMw19KnownIds(),
    independentRemain: 0,
    seedPresent: true
  }).ok,
  true
);
console.log("mw19 assert ok");
