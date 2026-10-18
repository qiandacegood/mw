import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { emptyMw21KnownIds, knownIdCountOf, mw21Tmp, redactMw21 } from "./mw21-lib.mjs";

const PAGE_SIZE = 80;
const COLLECTION_OF = {
  members: "members",
  papers: "papers",
  questions: "questions",
  questionVersions: "question_versions",
  attempts: "attempts",
  grants: "vip_grants",
  vipEvents: "vip_events",
  plans: "vip_plans",
  orders: "orders",
  receipts: "payment_receipts",
  callbacks: "callback_events"
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

async function findByHash(collection, hashes, projection) {
  const wanted = new Set(hashes);
  if (!wanted.size) return [];
  const out = [];
  for (const doc of await findAll(collection, {}, { ...(projection || { _id: 1 }), _id: 1 })) {
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

const path = join(projectRoot(), "configs", "mw21-verify-state.json");
if (!existsSync(path)) {
  console.error(JSON.stringify({ ok: false, reason: "STATE_MISSING" }, null, 2));
  process.exit(1);
}
const state = JSON.parse(readFileSync(path, "utf8"));
const hashes = { ...emptyMw21KnownIds(), ...(state.knownIds || {}), ...(state.hashes || {}) };

const ready = await assertMwTestReady();
authorizedEnvId();

const matched = emptyMw21KnownIds();
let imported = 0;
let matchedCount = 0;
for (const [key, collection] of Object.entries(COLLECTION_OF)) {
  const list = hashes[key] || [];
  imported += list.length;
  const rows = list.length
    ? await findByHash(collection, list, { _id: 1, paperId: 1, memberId: 1, sourceId: 1, sourceType: 1, orderId: 1, channelBizNo: 1 })
    : [];
  matched[key] = rows.map((row) => row.entryId).filter(Boolean);
  matchedCount += matched[key].length;
}

if (hashes.sourceIds?.length) {
  imported += hashes.sourceIds.length;
  const grants = await findAll("vip_grants", { sourceType: "order" }, { _id: 1, sourceId: 1, memberId: 1 });
  const wanted = new Set(hashes.sourceIds);
  for (const doc of grants) {
    const sourceId = typeof doc.sourceId === "string" ? doc.sourceId : "";
    if (sourceId && wanted.has(hashId(sourceId))) {
      mergeIds(matched.grants, [idOf(doc)]);
      matchedCount += 1;
    }
  }
}

if (imported === 0) {
  console.error(JSON.stringify({ ok: false, reason: "EMPTY_IMPORT" }, null, 2));
  process.exit(1);
}
if (matchedCount < imported) {
  const summary = redactMw21({ ok: false, reason: "HASH_NOT_MATCHED", imported, matchedCount, matched });
  writeJson(join(mw21Tmp(), "mw21-resolve.json"), summary);
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

const orderDocs = await findAll("orders", {}, { _id: 1, channelBizNo: 1, memberId: 1 });
const enrolledOrders = new Set(matched.orders);
for (const doc of orderDocs) {
  const id = idOf(doc);
  if (!enrolledOrders.has(id)) continue;
  const channelBizNo = typeof doc.channelBizNo === "string" ? doc.channelBizNo : "";
  const receipts = await findAll("payment_receipts", { orderId: id }, { _id: 1 });
  mergeIds(matched.receipts, receipts.map(idOf));
  const callbacks = await findAll("callback_events", { orderId: id }, { _id: 1 });
  mergeIds(matched.callbacks, callbacks.map(idOf));
  if (channelBizNo) {
    const grants = await findAll("vip_grants", { sourceType: "order", sourceId: channelBizNo }, { _id: 1, sourceId: 1 });
    mergeIds(matched.grants, grants.map(idOf));
    mergeIds(matched.sourceIds, [channelBizNo]);
    const events = await findAll("vip_events", { sourceId: channelBizNo }, { _id: 1 });
    mergeIds(matched.vipEvents, events.map(idOf));
  }
}

for (const paperId of matched.papers) {
  const attempts = await findAll("attempts", { paperId }, { _id: 1 });
  mergeIds(matched.attempts, attempts.map(idOf));
  const events = await findAll("score_events", { paperId }, { _id: 1 });
  mergeIds(matched.events, events.map(idOf));
  const bests = await findAll("paper_bests", { paperId }, { _id: 1 });
  mergeIds(matched.bests, bests.map(idOf));
  const versions = await findAll("paper_versions", { paperId }, { _id: 1 });
  const versionIds = versions.map(idOf).filter(Boolean);
  mergeIds(matched.versions, versionIds);
  for (const versionId of versionIds) {
    const chunks = await findAll("paper_chunks", { versionId }, { _id: 1 });
    mergeIds(matched.chunks, chunks.map(idOf));
    const answers = await findAll("paper_answers", { versionId }, { _id: 1 });
    mergeIds(matched.answers, answers.map(idOf));
  }
}

for (const memberId of matched.members) {
  const grants = await findAll("vip_grants", { memberId, sourceType: "order" }, { _id: 1, sourceId: 1 });
  mergeIds(matched.grants, grants.map(idOf));
  for (const grant of grants) {
    const sourceId = typeof grant.sourceId === "string" ? grant.sourceId : "";
    if (!sourceId) continue;
    mergeIds(matched.sourceIds, [sourceId]);
    const events = await findAll("vip_events", { memberId, sourceId }, { _id: 1 });
    mergeIds(matched.vipEvents, events.map(idOf));
  }
}

state.hashes = hashes;
state.knownIds = matched;
state.resolved = true;
state.wroteDocs = true;
writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
const summary = redactMw21({
  ok: true,
  imported,
  matchedCount,
  knownIdCount: knownIdCountOf(matched),
  enableOverrun: ready.enableOverrun,
  note: "按 SHA-256(_id) 反查；会员只用于锚定 order 账本，账号本身与 gift 不删"
});
writeJson(join(mw21Tmp(), "mw21-resolve.json"), summary);
console.log(JSON.stringify(summary, null, 2));
