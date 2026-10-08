import { runTcb } from "./mw04-lib.mjs";

const detail = await runTcb(["env", "detail", "--json"]);
const data = detail.json?.data || detail.json || {};
const hits = [];

function walk(value, path) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`));
    return;
  }
  for (const [key, next] of Object.entries(value)) {
    const here = path ? `${path}.${key}` : key;
    if (/appid|appId|APPID|wxapp/i.test(key) && typeof next === "string") {
      hits.push({
        path: here,
        prefix: next.slice(0, 2),
        len: next.length,
        placeholder: /placeholder|tourist|xxxx/i.test(next)
      });
    }
    walk(next, here);
  }
}

walk(data, "");
console.log(JSON.stringify({ keys: Object.keys(data), appidFields: hits }, null, 2));
