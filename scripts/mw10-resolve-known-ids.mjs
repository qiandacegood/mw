import { createHash } from "node:crypto";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { emptyMw10KnownIds, knownIdCountOf, mw10Tmp, redactMw10 } from "./mw10-lib.mjs";

const SEED_CATEGORY = "285ed461ccf0ef4839af4a3cee9580cb8b206b510923b20b83aadd4c17f4b547";
const USER_HASHES = new Set([
  "11c793a6fc9a1a94682fedf5c4571b8729e844def20da73913136cfc19efb5c5",
  "6ef9be03a046e7bc3bdb17e50f3ac7e23d9dd45e9a2675404a36fdad89d4150f",
  "f61cb7975420b15765e5e5afe79faa91571766b249226da28b521f9b0b22e66b",
  "5cb4a17423819e56962483a3ed77c8b1d4388c25cbe25c95c4842d31bc664812",
  "af9d6dff7519a038c02d3ee66f4c1581204b702fa03344c0c28ef99dec0c0b35",
  "c3de85b7c179d94f9256c16ca56ae629a5599e8f6d76c7cb4f431466b3532839"
]);

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
  return { code: result.code, docs: docsFromFind(result.json), rawKeys: Object.keys(result.json || {}) };
}

function idOf(doc) {
  return typeof doc._id === "string" ? doc._id : typeof doc.id === "string" ? doc.id : "";
}

const ready = await assertMwTestReady();
authorizedEnvId();

const questions = await findDocs("questions", { categoryId: SEED_CATEGORY });
const allQuestions = questions.docs.length ? questions.docs : (await findDocs("questions")).docs;
const questionIds = [...new Set(allQuestions.map(idOf).filter(Boolean))];

const versionsByQuestion = [];
for (const questionId of questionIds) {
  versionsByQuestion.push(...(await findDocs("question_versions", { questionId })).docs);
}
const allVersions = versionsByQuestion.length ? versionsByQuestion : (await findDocs("question_versions")).docs;

const assets = await findDocs("media_assets");
const tickets = await findDocs("upload_tickets");
const idem = await findDocs("idempotency");
const audits = await findDocs("audit_logs");

const mw10Idem = idem.docs.filter((doc) => {
  const key = String(doc.idempotencyKey || doc._id || "");
  const requestId = String(doc.requestId || "");
  return key.includes("mw10/") || requestId.includes("req_admin_question") || requestId.includes("req_admin_upload");
});
const mw10Audits = audits.docs.filter((doc) => {
  const action = String(doc.action || "");
  const requestId = String(doc.requestId || "");
  const target = String(doc.target || doc.objectRef || "");
  return (
    action.startsWith("question.") ||
    action.startsWith("upload.") ||
    requestId.includes("req_admin_question") ||
    requestId.includes("req_admin_upload") ||
    questionIds.some((id) => target.includes(id))
  );
});

const objectKeys = [
  ...assets.docs.map((doc) => (typeof doc.objectKey === "string" ? doc.objectKey : "")),
  ...tickets.docs.map((doc) => (typeof doc.objectKey === "string" ? doc.objectKey : ""))
].filter((key) => key.startsWith("mw-test/media/"));

const listed = await runTcb(["storage", "list", "mw-test/media/", "--json"]);
const listedText = JSON.stringify(listed.json || {});
const listedKeys = [...listedText.matchAll(/mw-test\/media\/[A-Za-z0-9._/-]+/g)].map((item) => item[0]);

const knownIds = {
  ...emptyMw10KnownIds(),
  questions: questionIds,
  versions: [...new Set(allVersions.map(idOf).filter(Boolean))],
  assets: [...new Set(assets.docs.map(idOf).filter(Boolean))],
  tickets: [...new Set(tickets.docs.map(idOf).filter(Boolean))],
  objects: [...new Set([...objectKeys, ...listedKeys])],
  idempotency: [...new Set(mw10Idem.map(idOf).filter(Boolean))],
  audits: [...new Set(mw10Audits.map(idOf).filter(Boolean))]
};

const matchedHashes = {
  questions: knownIds.questions.filter((id) => USER_HASHES.has(hashId(id))).length,
  versions: knownIds.versions.filter((id) => USER_HASHES.has(hashId(id))).length,
  assets: knownIds.assets.filter((id) => USER_HASHES.has(hashId(id))).length
};

const state = {
  wroteDocs: true,
  knownIds,
  importedAt: new Date().toISOString(),
  source: "cloud-resolve-after-admin-hand-clicks"
};
writeJson(join(projectRoot(), "configs", "mw10-verify-state.json"), state);
writeJson(join(mw10Tmp(), "mw10-resolve.json"), redactMw10({
  ok: knownIds.questions.length > 0,
  knownIdCount: knownIdCountOf(knownIds),
  counts: {
    questions: knownIds.questions.length,
    versions: knownIds.versions.length,
    assets: knownIds.assets.length,
    tickets: knownIds.tickets.length,
    objects: knownIds.objects.length,
    idempotency: knownIds.idempotency.length,
    audits: knownIds.audits.length
  },
  matchedHashes,
  enableOverrun: ready.enableOverrun
}));

console.log(
  JSON.stringify(
    redactMw10({
      ok: knownIds.questions.length > 0,
      wroteDocs: true,
      knownIdCount: knownIdCountOf(knownIds),
      counts: {
        questions: knownIds.questions.length,
        versions: knownIds.versions.length,
        assets: knownIds.assets.length,
        tickets: knownIds.tickets.length,
        objects: knownIds.objects.length,
        idempotency: knownIds.idempotency.length,
        audits: knownIds.audits.length
      },
      matchedHashes,
      hashedQuestions: knownIds.questions.map(hashId),
      hashedVersions: knownIds.versions.map(hashId),
      hashedAssets: knownIds.assets.map(hashId)
    }),
    null,
    2
  )
);
if (!knownIds.questions.length) process.exit(1);
