import { createHash } from "node:crypto";
import { authorizedEnvId, assertMwTestReady, runTcb } from "./mw04-lib.mjs";
import { parseNosqlCount } from "./mw06-lib.mjs";

/**
 * MW16 手点 9a 用的临时非 super 后台账号：
 * - 只在 mw-test 的 admin_users 里按 UID 精确写/读/删一条 `roles:["operations"]` 记录；
 * - UID 从环境变量 `MW16_TEST_ADMIN_UID` 读取，**不落盘、不打印明文**，输出只含 SHA-256 前缀；
 * - 收口时必须用 `delete` 精确删除并确认 remaining=0。
 *
 * 用法：`$env:MW16_TEST_ADMIN_UID='<uid>'; npm run mw16:temp-admin -- add|status|delete`
 */

const mode = (process.argv[2] || "").trim();
const uid = (process.env.MW16_TEST_ADMIN_UID || "").trim();
if (!["add", "status", "delete"].includes(mode)) {
  console.error(JSON.stringify({ ok: false, reason: "MODE_REQUIRED", usage: "add|status|delete" }, null, 2));
  process.exit(1);
}
if (!uid) {
  console.error(JSON.stringify({ ok: false, reason: "MW16_TEST_ADMIN_UID_MISSING" }, null, 2));
  process.exit(1);
}

const uidHash = createHash("sha256").update(uid, "utf8").digest("hex").slice(0, 12);

const ready = await assertMwTestReady();
authorizedEnvId();
if (ready.enableOverrun === true) throw new Error("EnableOverrun must stay false");

async function countByUid() {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([
      {
        TableName: "admin_users",
        CommandType: "COMMAND",
        Command: JSON.stringify({ count: "admin_users", query: { _id: uid } })
      }
    ]),
    "--json"
  ]);
  return parseNosqlCount(result);
}

async function readRoles() {
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([
      {
        TableName: "admin_users",
        CommandType: "COMMAND",
        Command: JSON.stringify({ find: "admin_users", filter: { _id: uid }, limit: 1 })
      }
    ]),
    "--json"
  ]);
  const raw = result.json?.data?.results?.[0];
  const rows = Array.isArray(raw) ? raw : raw?.cursor?.firstBatch || raw?.firstBatch || [];
  const doc = rows[0];
  return Array.isArray(doc?.roles) ? doc.roles.map((role) => String(role)) : [];
}

if (mode === "status") {
  const exists = (await countByUid()) === 1;
  const roles = exists ? await readRoles() : [];
  console.log(JSON.stringify({ ok: true, mode, exists, roles, uidHash, enableOverrun: ready.enableOverrun }, null, 2));
  process.exit(0);
}

if (mode === "add") {
  const now = new Date().toISOString();
  const result = await runTcb([
    "db",
    "nosql",
    "execute",
    "--command",
    JSON.stringify([
      {
        TableName: "admin_users",
        CommandType: "UPDATE",
        Command: JSON.stringify({
          update: "admin_users",
          updates: [
            {
              q: { _id: uid },
              u: {
                $set: {
                  _id: uid,
                  schemaVersion: 1,
                  roles: ["operations"],
                  enabled: true,
                  authVersion: 1,
                  updatedAt: now
                },
                $setOnInsert: { createdAt: now }
              },
              upsert: true
            }
          ]
        })
      }
    ]),
    "--json"
  ]);
  const exists = (await countByUid()) === 1;
  const roles = exists ? await readRoles() : [];
  const ok = result.code === 0 && exists && roles.join(",") === "operations";
  console.log(
    JSON.stringify(
      { ok, mode, code: result.code, exists, roles, uidHash, note: "临时非 super 账号；收口前必须 delete" },
      null,
      2
    )
  );
  process.exit(ok ? 0 : 1);
}

const deleted = await runTcb([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([
    {
      TableName: "admin_users",
      CommandType: "DELETE",
      Command: JSON.stringify({ delete: "admin_users", deletes: [{ q: { _id: uid }, limit: 1 }] })
    }
  ]),
  "--json"
]);
// DELETE 对不存在的 id 也返回成功，所以必须用精确 count 确认。
const remaining = await countByUid();
const ok = deleted.code === 0 && remaining === 0;
console.log(
  JSON.stringify({ ok, mode, code: deleted.code, remaining, uidHash, verifiedByCount: true }, null, 2)
);
process.exit(ok ? 0 : 1);
