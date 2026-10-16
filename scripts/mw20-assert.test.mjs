import assert from "node:assert/strict";
import { emptyMw20KnownIds, mw20LeftoverDecision } from "./mw20-lib.mjs";

assert.equal(
  mw20LeftoverDecision({ wroteDocs: false, resolved: true, knownIds: emptyMw20KnownIds(), independentRemain: 0, seedPresent: true }).reason,
  "WROTE_DOCS_FALSE"
);
assert.equal(
  mw20LeftoverDecision({ wroteDocs: true, resolved: false, knownIds: emptyMw20KnownIds(), independentRemain: 0, seedPresent: true }).reason,
  "KNOWN_IDS_NOT_RESOLVED"
);
assert.equal(
  mw20LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: { papers: ["a"] },
    independentRemain: 0,
    seedPresent: true
  }).reason,
  "KNOWN_IDS_REMAIN"
);
assert.equal(
  mw20LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: emptyMw20KnownIds(),
    independentRemain: 2,
    seedPresent: true
  }).reason,
  "INDEPENDENT_REMAIN"
);
assert.equal(
  mw20LeftoverDecision({
    wroteDocs: true,
    resolved: true,
    knownIds: emptyMw20KnownIds(),
    independentRemain: 0,
    seedPresent: true
  }).ok,
  true
);
console.log("mw20 assert ok");
