import { createHash } from "node:crypto";
import { runTcb } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";
import { MW16_SWEEP_SCOPE, isRoundMedalGrant } from "./mw16-lib.mjs";

/**
 * MW16 独立核查：只按 memberId / paperId 关系做精确查询与精确删除。
 * 完全不做 id 推导（MW15 已证明"按 attemptId/等级版本推导事件 id"与云端真实 _id 不一致），
 * 所有删除目标都用云端文档自身的真实 _id。
 * 也不按 memberId 全量删除：会员名下只收「本轮卷 / 本轮 attempt」关联的文档，避免误删历史残留。
 */

const PAGE_SIZE = 100;

export function hashId(id) {
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

export function docIdOf(doc) {
  if (typeof doc._id === "string") return doc._id;
  if (typeof doc.id === "string") return doc.id;
  return "";
}

function textOf(doc, key) {
  return typeof doc[key] === "string" ? doc[key] : "";
}

export async function countQuery(collection, query = {}) {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([
      { TableName: collection, CommandType: "COMMAND", Command: JSON.stringify({ count: collection, query }) }
    ]),
    "--json"
  ]);
  return parseNosqlCount(result);
}

export async function findPage(collection, filter, skip, limit, projection) {
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

export async function findAll(collection, filter = {}, projection) {
  const total = await countQuery(collection, filter);
  if (total === null) return [];
  const docs = [];
  const seen = new Set();
  for (let skip = 0; skip < total; skip += PAGE_SIZE) {
    const page = await findPage(collection, filter, skip, PAGE_SIZE, projection);
    for (const doc of page) {
      const id = docIdOf(doc);
      if (id && !seen.has(id)) {
        seen.add(id);
        docs.push(doc);
      }
    }
    if (page.length === 0) break;
  }
  return docs;
}

export async function deleteExact(collection, id) {
  if (!id || typeof id !== "string") return { collection, id, ok: false, reason: "MISSING_ID" };
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
  return { collection, ok: result.code === 0, code: result.code, idHash: hashId(id).slice(0, 12) };
}

/** 按 SHA-256 在集合里反查真实文档：返回带 entryId（云端真实 _id）的行。 */
export async function findByHash(collection, hashes, projection) {
  const wanted = new Set(hashes);
  const fields = { ...(projection || { _id: 1 }), _id: 1, memberId: 1, paperId: 1 };
  const out = [];
  for (const doc of await findAll(collection, {}, fields)) {
    const id = docIdOf(doc);
    if (!id || !wanted.has(hashId(id))) continue;
    out.push({ ...doc, entryId: id });
  }
  return out;
}

/**
 * 由用户提交的 SHA-256（卷 / 答题记录 / 会员）反查真实 _id 与关系范围。
 * - markedPaperIds：用户明确标记的本轮测试卷（只有这些会删 papers/versions/chunks/answers）
 * - scopedPaperIds：本轮卷范围（含由已标记 attempt 反查到的卷），只用于过滤会员名下文档
 * 这里的 id 全部来自云端文档本身，不做任何推导。
 */
export async function resolveScopes(hashes) {
  const wanted = {
    papers: new Set(hashes?.papers || []),
    attempts: new Set(hashes?.attempts || []),
    members: new Set(hashes?.members || []),
    questions: new Set(hashes?.questions || []),
    questionVersions: new Set(hashes?.questionVersions || []),
    assets: new Set(hashes?.assets || [])
  };
  const markedPaperIds = new Set();
  const scopedPaperIds = new Set();
  const memberIds = new Set();
  const markedQuestionIds = new Set();
  const markedQuestionVersionIds = new Set();
  const markedAssetIds = new Set();
  const attempts = [];

  if (wanted.papers.size) {
    for (const doc of await findAll("papers", {}, { _id: 1, categoryId: 1 })) {
      const id = docIdOf(doc);
      if (!id || !wanted.papers.has(hashId(id))) continue;
      markedPaperIds.add(id);
      scopedPaperIds.add(id);
    }
  }
  if (wanted.questions.size) {
    for (const doc of await findAll("questions", {}, { _id: 1 })) {
      const id = docIdOf(doc);
      if (id && wanted.questions.has(hashId(id))) markedQuestionIds.add(id);
    }
  }
  if (wanted.questionVersions.size) {
    for (const doc of await findAll("question_versions", {}, { _id: 1 })) {
      const id = docIdOf(doc);
      if (id && wanted.questionVersions.has(hashId(id))) markedQuestionVersionIds.add(id);
    }
  }
  if (wanted.assets.size) {
    for (const doc of await findAll("assets", {}, { _id: 1 })) {
      const id = docIdOf(doc);
      if (id && wanted.assets.has(hashId(id))) markedAssetIds.add(id);
    }
  }
  if (wanted.members.size) {
    for (const doc of await findAll("members", {}, { _id: 1 })) {
      const id = docIdOf(doc);
      if (id && wanted.members.has(hashId(id))) memberIds.add(id);
    }
  }
  if (wanted.attempts.size) {
    for (const doc of await findAll("attempts", {}, { _id: 1, memberId: 1, paperId: 1 })) {
      const id = docIdOf(doc);
      if (!id || !wanted.attempts.has(hashId(id))) continue;
      const memberId = textOf(doc, "memberId");
      const paperId = textOf(doc, "paperId");
      attempts.push({ attemptId: id, memberId, paperId });
      if (memberId) memberIds.add(memberId);
      if (paperId) scopedPaperIds.add(paperId);
    }
  }
  const pairs = [];
  const seen = new Set();
  for (const attempt of attempts) {
    if (!attempt.memberId || !attempt.paperId) continue;
    const key = `${attempt.memberId}|${attempt.paperId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ memberId: attempt.memberId, paperId: attempt.paperId });
  }
  return {
    memberIds: [...memberIds],
    markedPaperIds: [...markedPaperIds],
    scopedPaperIds: [...scopedPaperIds],
    markedQuestionIds: [...markedQuestionIds],
    markedQuestionVersionIds: [...markedQuestionVersionIds],
    markedAssetIds: [...markedAssetIds],
    attemptIds: attempts.map((row) => row.attemptId),
    pairs
  };
}

/**
 * 精确关系查询：返回每个集合命中的真实文档（含 _id），并给出计数。
 * 会员名下只保留与本轮卷 / 本轮 attempt 关联的文档。
 */
export async function sweepDocs(scopes) {
  const docs = {};
  const counts = {};
  const add = (collection, rows) => {
    const list = docs[collection] ? docs[collection] : [];
    const seen = new Set(list.map(docIdOf));
    for (const row of rows) {
      const id = docIdOf(row);
      if (id && !seen.has(id)) {
        seen.add(id);
        list.push(row);
      }
    }
    docs[collection] = list;
    counts[collection] = list.length;
  };

  const scopedPaperIds = new Set(scopes.scopedPaperIds || []);
  const attemptIds = new Set(scopes.attemptIds || []);

  for (const memberId of scopes.memberIds) {
    for (const collection of MW16_SWEEP_SCOPE.byMember) {
      if (collection === "attempts") {
        add(collection, (await findAll(collection, { memberId })).filter((doc) => scopedPaperIds.has(textOf(doc, "paperId"))));
      } else if (collection === "active_attempts") {
        add(collection, (await findAll(collection, { memberId })).filter((doc) => attemptIds.has(textOf(doc, "attemptId"))));
      } else if (collection === "score_events" || collection === "paper_bests") {
        add(collection, (await findAll(collection, { memberId })).filter((doc) => scopedPaperIds.has(textOf(doc, "paperId"))));
      } else if (collection === "score_metrics") {
        add(collection, await findAll(collection, { memberId }));
      } else if (collection === "medal_grants") {
        add(collection, (await findAll(collection, { memberId })).filter((doc) => isRoundMedalGrant(doc, attemptIds)));
      }
    }
  }
  for (const paperId of scopes.markedPaperIds || []) {
    add("papers", await findAll("papers", { _id: paperId }, { _id: 1 }));
    for (const collection of ["paper_versions", "paper_chunks", "paper_answers"]) {
      add(collection, await findAll(collection, { paperId }));
    }
  }
  for (const questionId of scopes.markedQuestionIds || []) {
    add("questions", await findAll("questions", { _id: questionId }, { _id: 1, currentVersionId: 1 }));
    add("question_versions", await findAll("question_versions", { questionId }));
  }
  for (const versionId of scopes.markedQuestionVersionIds || []) {
    add("question_versions", await findAll("question_versions", { _id: versionId }));
  }
  for (const assetId of scopes.markedAssetIds || []) {
    add("assets", await findAll("assets", { _id: assetId }));
  }
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return { docs, counts, total };
}

/** 按 sweepDocs 读到的真实 _id 精确删除；不推导、不扫整表猜测。 */
export async function sweepDelete(scopes) {
  const { docs, counts, total } = await sweepDocs(scopes);
  const deleted = [];
  const skipped = [];
  for (const [collection, rows] of Object.entries(docs)) {
    for (const row of rows) {
      const id = docIdOf(row);
      if (collection === "members" || collection === "member_stats" || collection === "identities") {
        skipped.push({ collection, reason: "MEMBER_KEEP" });
        continue;
      }
      if (collection === "categories") {
        skipped.push({ collection, reason: "SEED_CATEGORY_PROTECTED" });
        continue;
      }
      deleted.push(await deleteExact(collection, id));
    }
  }
  return {
    before: counts,
    beforeTotal: total,
    deleted: deleted.length,
    failed: deleted.filter((item) => !item.ok).length,
    skipped: skipped.length
  };
}
