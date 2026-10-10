import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import {
  FORBIDDEN_FUTURE_COLLECTIONS,
  ATTEMPT_INDEXES,
  listIndexCommand,
  mw14Tmp,
  redactMw14
} from "./mw14-lib.mjs";
import {
  SEED_CATEGORY_IDS,
  SEED_SUPPORT_COLLECTIONS,
  leftoverCollectionsOf,
  leftoverObjectIdsOf,
  leftoverVerifySummary,
  loadMw14VerifyState
} from "./mw14-leftover-verify-lib.mjs";

async function countExact(collection, ids) {
  if (!ids.length) return 0;
  let leftover = 0;
  for (const id of ids) {
    const result = await runTcb([
      "db",
      "nosql",
      "execute",
      "--command",
      JSON.stringify([
        {
          TableName: collection,
          CommandType: "COMMAND",
          Command: JSON.stringify({ count: collection, query: { _id: id } })
        }
      ]),
      "--json"
    ]);
    leftover += parseNosqlCount(result) || 0;
  }
  return leftover;
}

async function listCollectionsText() {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([{ TableName: "categories", CommandType: "COMMAND", Command: JSON.stringify({ listCollections: 1 }) }]),
    "--json"
  ]);
  return result.code === 0 ? JSON.stringify(result.json || {}) : "";
}

async function seedTenPresent(listedText) {
  if (!SEED_SUPPORT_COLLECTIONS.every((name) => listedText.includes(name))) return false;
  let count = 0;
  for (const seedId of SEED_CATEGORY_IDS) {
    const counted = await runTcb([
      "db",
      "nosql",
      "execute",
      "--command",
      JSON.stringify([
        {
          TableName: "categories",
          CommandType: "COMMAND",
          Command: JSON.stringify({ count: "categories", query: { _id: seedId } })
        }
      ]),
      "--json"
    ]);
    if (parseNosqlCount(counted) === 1) count += 1;
  }
  return count === SEED_CATEGORY_IDS.length;
}

function forbiddenPresent(listedText) {
  return FORBIDDEN_FUTURE_COLLECTIONS.some((name) => listedText.includes(`"${name}"`));
}

async function indexesPresent() {
  for (const index of ATTEMPT_INDEXES) {
    const result = await runTcb([
      "db",
      "nosql",
      "execute",
      "--command",
      JSON.stringify([listIndexCommand(index.collection)]),
      "--json"
    ]);
    if (result.code !== 0 || !JSON.stringify(result.json || {}).includes(index.name)) return false;
  }
  return true;
}

const ready = await assertMwTestReady();
authorizedEnvId();
const state = loadMw14VerifyState();
const collections = leftoverCollectionsOf(state.knownIds);
const leftoverCounts = {};
for (const [collection, ids] of Object.entries(collections)) {
  leftoverCounts[collection] = await countExact(collection, ids);
}
const leftoverObjects = leftoverObjectIdsOf(state.knownIds).length;
const leftoverObjectsConfirmed = state.leftoverObjectsConfirmed === true;
const listedText = await listCollectionsText();
const seedPresent = await seedTenPresent(listedText);
const forbidden = forbiddenPresent(listedText);
const indexes = await indexesPresent();
const summary = leftoverVerifySummary({
  state,
  leftoverCounts,
  leftoverObjects,
  leftoverObjectsConfirmed,
  seedPresent,
  forbiddenPresent: forbidden,
  indexesPresent: indexes,
  exactIdSweepOnly: true,
  cloudWriteClaimed: ready.cloudWriteClaimed !== false
});
writeJson(join(mw14Tmp(), "mw14-leftover-verify.json"), redactMw14(summary));
console.log(JSON.stringify(redactMw14(summary), null, 2));
if (!summary.ok) process.exit(1);
