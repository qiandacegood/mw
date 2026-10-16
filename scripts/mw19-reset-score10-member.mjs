import { createHash } from "node:crypto";
import { authorizedEnvId, assertMwTestReady, runTcb, writeJson } from "./mw04-lib.mjs";
import { bsonNumber, parseNosqlCount } from "./mw06-lib.mjs";
import { mw19Tmp, redactMw19 } from "./mw19-lib.mjs";

const APPLY = process.argv.includes("--apply");
const PAGE = 80;
const RELATED = [
  ["attempts", "memberId"],
  ["active_attempts", "memberId"],
  ["paper_bests", "memberId"],
  ["score_events", "memberId"],
  ["score_metrics", "memberId"],
  ["medal_grants", "memberId"],
  ["ranking_rows", "memberId"]
];

function hashId(id) {
  return createHash("sha256").update(String(id), "utf8").digest("hex").slice(0, 12);
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
  for (let skip = 0; skip < total; skip += PAGE) {
    const page = await findPage(collection, filter, skip, PAGE, projection);
    for (const doc of page) {
      const id = idOf(doc);
      if (id && !seen.has(id)) {
        seen.add(id);
        docs.push(doc);
      }
    }
    if (!page.length) break;
  }
  return docs;
}

async function deleteExact(collection, id) {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([
      {
        TableName: collection,
        CommandType: "DELETE",
        Command: JSON.stringify({ delete: collection, deletes: [{ q: { _id: id }, limit: 1 }] })
      }
    ]),
    "--json"
  ]);
  return { collection, idHash: hashId(id), ok: result.code === 0, code: result.code };
}

const ready = await assertMwTestReady();
authorizedEnvId();
if (ready.enableOverrun === true) throw new Error("EnableOverrun must stay false");

const stats = await findAll("member_stats", {}, { _id: 1, memberId: 1, totalScore: 1, scoreSeq: 1, levelId: 1 });
const members = await findAll("members", {}, { _id: 1, memberId: 1, identityId: 1, status: 1, nickname: 1 });
function scoreOf(row) {
  const n = bsonNumber(row.totalScore);
  return n == null ? -1 : n;
}

const byScore = new Map();
for (const row of stats) {
  const score = scoreOf(row);
  const list = byScore.get(score) || [];
  list.push(row);
  byScore.set(score, list);
}

const keep = (byScore.get(9) || []).concat(stats.filter((row) => row.totalScore === 9));
const uniqueKeep = [...new Map(keep.map((row) => [idOf(row), row])).values()];
const reset = byScore.get(10) || [];

if (uniqueKeep.length !== 1) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        reason: "KEEP_MEMBER_NOT_UNIQUE",
        keepCount: uniqueKeep.length,
        stats: stats.length,
        scores: stats.map((row) => ({
          score: scoreOf(row),
          scoreSeq: bsonNumber(row.scoreSeq),
          levelId: row.levelId || ""
        }))
      },
      null,
      2
    )
  );
  process.exit(1);
}
if (reset.length !== 1) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        reason: "RESET_MEMBER_NOT_UNIQUE",
        resetCount: reset.length,
        stats: stats.length,
        scores: stats.map((row) => ({
          score: scoreOf(row),
          scoreSeq: bsonNumber(row.scoreSeq),
          levelId: row.levelId || ""
        }))
      },
      null,
      2
    )
  );
  process.exit(1);
}

const resetMemberId = String(reset[0].memberId || idOf(reset[0]));
const keepMemberId = String(uniqueKeep[0].memberId || idOf(uniqueKeep[0]));
if (!resetMemberId || resetMemberId === keepMemberId) {
  console.error(JSON.stringify({ ok: false, reason: "MEMBER_ID_COLLISION" }, null, 2));
  process.exit(1);
}

const resetMember = members.find((row) => idOf(row) === resetMemberId || row.memberId === resetMemberId);
const keepMember = members.find((row) => idOf(row) === keepMemberId || row.memberId === keepMemberId);
const allIdentities = await findAll("identities", {}, { _id: 1, memberId: 1 });
const identities = allIdentities.filter((row) => {
  const mid = typeof row.memberId === "string" ? row.memberId : "";
  const fromMember = resetMember && typeof resetMember.identityId === "string" ? resetMember.identityId : "";
  return mid === resetMemberId || (fromMember && idOf(row) === fromMember);
});
const identityId = identities[0] ? idOf(identities[0]) : "";
if (identities.length !== 1) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        reason: "IDENTITY_NOT_UNIQUE",
        identityCount: identities.length,
        allIdentities: allIdentities.length,
        memberHasIdentityField: Boolean(resetMember && resetMember.identityId)
      },
      null,
      2
    )
  );
  process.exit(1);
}

const related = {};
const pairs = [];
for (const [collection, field] of RELATED) {
  let docs = await findAll(collection, { [field]: resetMemberId }, { _id: 1, memberId: 1, paperId: 1 });
  if (!docs.length && (collection === "medal_grants" || collection === "ranking_rows")) {
    docs = (await findAll(collection, {}, { _id: 1, memberId: 1 })).filter((row) => row.memberId === resetMemberId);
  }
  related[collection] = docs.length;
  for (const doc of docs) {
    const id = idOf(doc);
    if (id) pairs.push([collection, id]);
  }
}
if (resetMemberId) pairs.push(["member_stats", resetMemberId], ["members", resetMemberId]);
for (const doc of identities) {
  const id = idOf(doc);
  if (id) pairs.push(["identities", id]);
}

const plan = redactMw19({
  ok: true,
  apply: APPLY,
  keep: {
    score: scoreOf(uniqueKeep[0]),
    scoreSeq: bsonNumber(uniqueKeep[0].scoreSeq),
    levelId: uniqueKeep[0].levelId,
    memberHash: hashId(keepMemberId),
    status: keepMember?.status || ""
  },
  reset: {
    score: scoreOf(reset[0]),
    scoreSeq: bsonNumber(reset[0].scoreSeq),
    levelId: reset[0].levelId,
    memberHash: hashId(resetMemberId),
    identityHash: identityId ? hashId(identityId) : "",
    status: resetMember?.status || "",
    related,
    targetCount: pairs.length
  },
  neverTouched: ["jobs", "audit_logs", "idempotency", "ranking_heads", "app_config", "categories", "orders", "vip_*"],
  note: "只拆 10 分会员的身份映射与成长文档，便于同一微信重新 register。不删 9 分历史号，不删试卷。"
});
writeJson(`${mw19Tmp()}/mw19-reset-score10-plan.json`, plan);

if (!APPLY) {
  console.log(JSON.stringify({ ...plan, hint: "核对后加 --apply 才会删除" }, null, 2));
  process.exit(0);
}

const deleted = [];
for (const [collection, id] of pairs) {
  if (id === keepMemberId) throw new Error("refusing to delete keep member");
  deleted.push(await deleteExact(collection, id));
}
const failed = deleted.filter((row) => !row.ok).length;
const summary = redactMw19({
  ok: failed === 0,
  apply: true,
  keepMemberHash: hashId(keepMemberId),
  resetMemberHash: hashId(resetMemberId),
  targetCount: pairs.length,
  deleted: deleted.filter((row) => row.ok).length,
  failed,
  related
});
writeJson(`${mw19Tmp()}/mw19-reset-score10-apply.json`, summary);
console.log(JSON.stringify(summary, null, 2));
if (failed) process.exit(1);
