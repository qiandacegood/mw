import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { emptyMw23KnownIds, knownIdCountOf, mw23Tmp, redactMw23 } from "./mw23-lib.mjs";

const PAGE_SIZE = 80;
const COLLECTION_OF = {
  members: "members",
  papers: "papers",
  questions: "questions",
  questionVersions: "question_versions",
  attempts: "attempts",
  versions: "paper_versions",
  chunks: "paper_chunks",
  answers: "paper_answers",
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

const path = join(projectRoot(), "configs", "mw23-verify-state.json");
if (!existsSync(path)) {
  console.error(JSON.stringify({ ok: false, reason: "STATE_MISSING" }, null, 2));
  process.exit(1);
}
const state = JSON.parse(readFileSync(path, "utf8"));
const hashes = { ...emptyMw23KnownIds(), ...(state.knownIds || {}), ...(state.hashes || {}) };

const ready = await assertMwTestReady();
authorizedEnvId();

const matched = emptyMw23KnownIds();
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
if (matchedCount < imported) {
  const summary = redactMw23({ ok: false, reason: "HASH_NOT_MATCHED", imported, matchedCount, matched });
  writeJson(join(mw23Tmp(), "mw23-resolve.json"), summary);
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

for (const paperId of matched.papers) {
  const attempts = await findAll("attempts", { paperId }, { _id: 1 });
  mergeIds(matched.attempts, attempts.map(idOf));
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

for (const questionId of matched.questions) {
  const versions = await findAll("question_versions", { questionId }, { _id: 1 });
  mergeIds(matched.questionVersions, versions.map(idOf));
}

state.hashes = hashes;
state.knownIds = matched;
state.resolved = true;
state.wroteDocs = true;
writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
const summary = redactMw23({
  ok: true,
  imported,
  matchedCount,
  knownIdCount: knownIdCountOf(matched),
  enableOverrun: ready.enableOverrun,
  note: "按 SHA-256(_id) 反查；会员账号只锚定、不删除；停用/禁榜误伤走恢复"
});
writeJson(join(mw23Tmp(), "mw23-resolve.json"), summary);
console.log(JSON.stringify(summary, null, 2));
