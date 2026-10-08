import { runTcb } from "./mw04-lib.mjs";
import { ADMIN_USERS_COLLECTION, MW05_OFFICIAL_FUNCTIONS, redactMw05 } from "./mw05-lib.mjs";

const count = await runTcb([
  "db",
  "nosql",
  "execute",
  "--command",
  JSON.stringify([
    {
      TableName: ADMIN_USERS_COLLECTION,
      CommandType: "COMMAND",
      Command: JSON.stringify({ count: ADMIN_USERS_COLLECTION, query: {} })
    }
  ]),
  "--json"
]);
const listed = await runTcb(["fn", "list", "--json"]);
const rows = listed.json?.data || listed.json?.Functions || [];
const names = (Array.isArray(rows) ? rows : []).map((item) => item.FunctionName || item.Name || item.name);
const env = await runTcb(["env", "list", "--json"]);
const envs = env.json?.data || [];
const overrun = envs.map((item) => ({
  personal: item.PackageId === "baas_personal" || item.PackageName === "个人版",
  enableOverrun: item.EnableOverrun
}));
const acl = await runTcb(["storage", "rules", "get", "--json"]);
console.log(
  JSON.stringify(
    redactMw05({
      adminUsersQueryCode: count.code,
      officialPresent: MW05_OFFICIAL_FUNCTIONS.every((name) => names.includes(name)),
      extraFunctions: names.filter((name) => !MW05_OFFICIAL_FUNCTIONS.includes(name)),
      functionCount: names.length,
      overrun,
      acl: acl.json?.data?.acl || acl.json?.acl
    }),
    null,
    2
  )
);
