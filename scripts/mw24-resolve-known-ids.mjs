import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { emptyMw24KnownIds, knownIdCountOf, mw24Tmp, redactMw24 } from "./mw24-lib.mjs";

const PAGE_SIZE = 80;
const COLLECTION_OF = {
  members: "members",
  identities: "identities",
  stats: "member_stats",
  medalGrants: "medal_grants",
  feedbacks: "feedbacks"
};

function hashId(id) {
  return createHash("sha256").update(String(id), "utf8").digest("hex");
}

function docsFromFind(json) {
  const results = json?.data?.results;
  if (Array.isArray(results) && Array.isArray(results[0])) {
    return results[0].filter((item) => item && typeof item === "object" && (item._id || item.id));
  }
  const raw = json?.data?.results?.[0] || json?.data || json;
  const cursor = raw?.cursor || raw;
  const first = Array.isArray(cursor) ? cursor[0] : cursor;
  const batch = first?.cursor?.firstBatch || first?.firstBatch || first?.documents || first?.docs || [];
  if (Array.isArray(batch)) {
    return batch.filter((item) => item && typeof item === "object" && (item._id || item.id));
  }
  if (Array.isArray(raw)) return raw.filter((item) => item && typeof item === "object" && (item._id || item.id));
  return [];
}

function idOf(doc) {
  return typeof doc._id === "string" ? doc._id : typeof doc.id === "string" ? doc.id : "";
}

async function countQuery(collection, query = {}) {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([{ TableName: collection, CommandType: "COMMAND", Command: JSON.stringify({ count: collection, query }) }]),
    "--json"
  ]);
  return parseNosqlCount(result);
}

async function findPage(collection, filter, skip, limit, projection) {
  const command = { find: collection, filter, limit, skip };
  if (projection) command.projection = projection;
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([{ TableName: collection, CommandType: "COMMAND", Command: JSON.stringify(command) }]),
    "--json"
  ]);
  return docsFromFind(result.json);
}

async function findAll(collection, filter = {}, projection = { _id: 1 }) {
  const total = await countQuery(collection, filter);
  if (total === null) return [];
  const docs = [];
  const seen = new Set();
  for (let skip = 0; skip < total; skip += PAGE_SIZE) {
    const page = await findPage(collection, filter, skip, PAGE_SIZE, projection);
    for (const doc of page) {
      const id = idOf(doc);
      if (id && !seen.has(id)) {
        seen.add(id);
        docs.push(doc);
      }
    }
    if (page.length === 0) break;
  }
  return docs;
}

async function findByHash(collection, hashes) {
  const wanted = new Set(hashes);
  if (!wanted.size) return [];
  const out = [];
  for (const doc of await findAll(collection, {}, { _id: 1 })) {
    const id = idOf(doc);
    if (id && wanted.has(hashId(id))) out.push({ ...doc, entryId: id });
  }
  return out;
}

function mergeIds(list, ids) {
  const seen = new Set(list);
  for (const id of ids) {
    if (id && !seen.has(id)) {
      seen.add(id);
      list.push(id);
    }
  }
}

const path = join(projectRoot(), "configs", "mw24-verify-state.json");
if (!existsSync(path)) {
  console.error(JSON.stringify({ ok: false, reason: "STATE_MISSING" }, null, 2));
  process.exit(1);
}
const state = JSON.parse(readFileSync(path, "utf8"));
const hashes = { ...emptyMw24KnownIds(), ...(state.knownIds || {}), ...(state.hashes || {}) };

const ready = await assertMwTestReady();
authorizedEnvId();

const matched = emptyMw24KnownIds();
let imported = 0;
let matchedCount = 0;
for (const [key, collection] of Object.entries(COLLECTION_OF)) {
  const list = hashes[key] || [];
  imported += list.length;
  const rows = list.length ? await findByHash(collection, list) : [];
  matched[key] = rows.map((row) => row.entryId).filter(Boolean);
  matchedCount += matched[key].length;
}

if (imported === 0) {
  console.error(JSON.stringify({ ok: false, reason: "EMPTY_IMPORT" }, null, 2));
  process.exit(1);
}

for (const memberId of matched.members) {
  const identities = await findAll("identities", { memberId }, { _id: 1 });
  mergeIds(matched.identities, identities.map(idOf));
  mergeIds(matched.stats, [memberId]);
  const grants = await findAll("medal_grants", { memberId }, { _id: 1 });
  mergeIds(matched.medalGrants, grants.map(idOf));
  const feedbacks = await findAll("feedbacks", { memberId }, { _id: 1 });
  mergeIds(matched.feedbacks, feedbacks.map(idOf));
}

if (matchedCount < imported) {
  const summary = redactMw24({ ok: false, reason: "HASH_NOT_MATCHED", imported, matchedCount, matched });
  writeJson(join(mw24Tmp(), "mw24-resolve.json"), summary);
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

state.hashes = hashes;
state.knownIds = matched;
state.resolved = true;
state.wroteDocs = true;
writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
const summary = redactMw24({
  ok: true,
  imported,
  matchedCount,
  knownIdCount: knownIdCountOf(matched),
  enableOverrun: ready.enableOverrun,
  note: "按 SHA-256(_id) 反查；本轮新建会员允许物理删号；不删订单/退款/receipts/vip_grants/app_config"
});
writeJson(join(mw24Tmp(), "mw24-resolve.json"), summary);
console.log(JSON.stringify(summary, null, 2));
