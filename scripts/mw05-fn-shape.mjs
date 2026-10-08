import { runTcb } from "./mw04-lib.mjs";

const listed = await runTcb(["fn", "list", "--json"]);
const json = listed.json || {};
const keys = Object.keys(json);
const dataType = Array.isArray(json.data) ? "array" : typeof json.data;
const dataKeys = json.data && typeof json.data === "object" && !Array.isArray(json.data) ? Object.keys(json.data) : [];
const first = Array.isArray(json.data) ? json.data[0] : json.data?.Functions?.[0] || json.Functions?.[0];
console.log(
  JSON.stringify(
    {
      code: listed.code,
      keys,
      dataType,
      dataKeys,
      firstKeys: first && typeof first === "object" ? Object.keys(first) : [],
      total: json.TotalCount || json.data?.TotalCount || json.data?.total
    },
    null,
    2
  )
);
