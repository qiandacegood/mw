import { createHash } from "node:crypto";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { emptyMw11KnownIds, knownIdCountOf, mw11Tmp, redactMw11 } from "./mw11-lib.mjs";

const SEED_CATEGORY = "285ed461ccf0ef4839af4a3cee9580cb8b206b510923b20b83aadd4c17f4b547";
const USER_HASHES = new Set((process.env.MW11_USER_HASHES || "").split(",").map((item) => item.trim()).filter(Boolean));

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

async function findDocs(collection, filter = {}, limit = 100) {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([
      {
        TableName: collection,
        CommandType: "COMMAND",
        Command: JSON.stringify({ find: collection, filter, limit })
      }
    ]),
    "--json"
  ]);
  return { code: result.code, docs: docsFromFind(result.json) };
}

function idOf(doc) {
  return typeof doc._id === "string" ? doc._id : typeof doc.id === "string" ? doc.id : "";
}

function matchHash(id) {
  return !USER_HASHES.size || USER_HASHES.has(hashId(id));
}

const ready = await assertMwTestReady();
authorizedEnvId();

const papersBySeed = await findDocs("papers", { categoryId: SEED_CATEGORY });
const papersBroad = papersBySeed.docs.length ? papersBySeed : await findDocs("papers", {}, 50);
const paperDocs = papersBroad.docs.filter((doc) => {
  const title = String(doc.title || "");
  const id = idOf(doc);
  return title.includes("MW11") || (USER_HASHES.size ? USER_HASHES.has(hashId(id)) : Boolean(id));
});
const paperIds = [...new Set(paperDocs.map(idOf).filter(Boolean))];

const versions = [];
for (const paperId of paperIds) {
  versions.push(...(await findDocs("paper_versions", { paperId })).docs);
}
const versionIds = [...new Set(versions.map(idOf).filter((id) => id && (!USER_HASHES.size || USER_HASHES.has(hashId(id)) || true)))];
const chunkIds = [...new Set(versions.flatMap((doc) => Array.isArray(doc.chunkIds) ? doc.chunkIds : []))];
const answerIds = [...new Set(versions.flatMap((doc) => Array.isArray(doc.answerChunkIds) ? doc.answerChunkIds : []))];
const questionIds = [...new Set(versions.flatMap((doc) => Array.isArray(doc.questionIds) ? doc.questionIds : []))];
const questionVersionDocs = [];
for (const questionId of questionIds) {
  questionVersionDocs.push(...(await findDocs("question_versions", { questionId })).docs);
}
const questionVersionIds = [...new Set(questionVersionDocs.map(idOf).filter(Boolean))];

const idem = await findDocs("idempotency");
const audits = await findDocs("audit_logs");
const mw11Idem = idem.docs.filter((doc) => {
  const key = String(doc.idempotencyKey || doc._id || "");
  const requestId = String(doc.requestId || "");
  const action = String(doc.action || "");
  const target = String(doc.target || doc.resultRef?.paperId || doc.resultRef?.questionId || "");
  return (
    key.includes("mw11/") ||
    requestId.includes("req_admin_paper") ||
    action.startsWith("paper.") ||
    paperIds.some((id) => target.includes(id) || key.includes(id)) ||
    questionIds.some((id) => target.includes(id) || key.includes(id))
  );
});
const mw11Audits = audits.docs.filter((doc) => {
  const action = String(doc.action || "");
  const requestId = String(doc.requestId || "");
  const target = String(doc.target || "");
  return (
    action.startsWith("paper.") ||
    requestId.includes("req_admin_paper") ||
    paperIds.some((id) => target.includes(id)) ||
    (action.startsWith("question.") && questionIds.some((id) => target.includes(id)))
  );
});

const knownIds = {
  ...emptyMw11KnownIds(),
  papers: paperIds,
  versions: versionIds,
  chunks: chunkIds,
  answers: answerIds,
  questions: questionIds,
  questionVersions: questionVersionIds,
  idempotency: [...new Set(mw11Idem.map(idOf).filter(Boolean))],
  audits: [...new Set(mw11Audits.map(idOf).filter(Boolean))]
};

const matchedHashes = {
  papers: knownIds.papers.filter((id) => USER_HASHES.has(hashId(id))).length,
  versions: knownIds.versions.filter((id) => USER_HASHES.has(hashId(id))).length,
  chunks: knownIds.chunks.filter((id) => USER_HASHES.has(hashId(id))).length,
  answers: knownIds.answers.filter((id) => USER_HASHES.has(hashId(id))).length,
  questions: knownIds.questions.filter((id) => USER_HASHES.has(hashId(id))).length,
  questionVersions: knownIds.questionVersions.filter((id) => USER_HASHES.has(hashId(id))).length
};

const state = {
  wroteDocs: true,
  knownIds,
  importedAt: new Date().toISOString(),
  source: "cloud-resolve-after-admin-hand-clicks"
};
writeJson(join(projectRoot(), "configs", "mw11-verify-state.json"), state);
writeJson(join(mw11Tmp(), "mw11-resolve.json"), redactMw11({
  ok: knownIds.papers.length > 0,
  knownIdCount: knownIdCountOf(knownIds),
  counts: {
    papers: knownIds.papers.length,
    versions: knownIds.versions.length,
    chunks: knownIds.chunks.length,
    answers: knownIds.answers.length,
    questions: knownIds.questions.length,
    questionVersions: knownIds.questionVersions.length,
    idempotency: knownIds.idempotency.length,
    audits: knownIds.audits.length
  },
  matchedHashes,
  enableOverrun: ready.enableOverrun
}));

console.log(
  JSON.stringify(
    redactMw11({
      ok: knownIds.papers.length > 0,
      wroteDocs: true,
      knownIdCount: knownIdCountOf(knownIds),
      counts: {
        papers: knownIds.papers.length,
        versions: knownIds.versions.length,
        chunks: knownIds.chunks.length,
        answers: knownIds.answers.length,
        questions: knownIds.questions.length,
        questionVersions: knownIds.questionVersions.length,
        idempotency: knownIds.idempotency.length,
        audits: knownIds.audits.length
      },
      matchedHashes,
      hashedPapers: knownIds.papers.map(hashId),
      hashedVersions: knownIds.versions.map(hashId)
    }),
    null,
    2
  )
);
if (!knownIds.papers.length) process.exit(1);
