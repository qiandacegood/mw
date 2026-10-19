import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, invokeFn, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import { parseFunctionEnv } from "./mw06-lib.mjs";
import { MW26_TARGET_CONCURRENCY, percentileNearestRank, mw26Tmp, redactMw26 } from "./mw26-lib.mjs";

const tmp = mw26Tmp();
const ready = await assertMwTestReady();
if (ready.enableOverrun === true) throw new Error("EnableOverrun must stay false");
authorizedEnvId();

function request(action, data = {}) {
  return { apiVersion: "1", action, requestId: `mw26/load/${action}/${Math.random().toString(16).slice(2)}`, data };
}

async function timeInvoke(name, payload) {
  const started = Date.now();
  const invoked = await invokeFn(name, payload, { timeoutMs: 30000 });
  return {
    ms: Date.now() - started,
    ok: invoked.payload?.ok === true,
    code: invoked.payload?.error?.code || invoked.payload?.reason || "",
    hasOpenId: /openid|OPENID|AppKey/i.test(JSON.stringify(invoked.payload || {}))
  };
}

async function runPool(n, factory) {
  const started = Date.now();
  const first = await factory(0);
  const rest = await Promise.all(Array.from({ length: n - 1 }, (_, index) => factory(index + 1)));
  return { samples: [first, ...rest], elapsedMs: Date.now() - started };
}

const concurrency = Number(process.env.MW26_CONCURRENCY || MW26_TARGET_CONCURRENCY) || 50;

const ping = await runPool(concurrency, () => timeInvoke("mw-public", request("public.ping")));
const home = await runPool(concurrency, () => timeInvoke("mw-public", request("home.get", {})));
const tree = await runPool(concurrency, () => timeInvoke("mw-public", request("category.tree", {})));
const ranking = await runPool(concurrency, () => timeInvoke("mw-public", request("ranking.list", { scope: "total" })));
const submitNeg = await runPool(Math.min(concurrency, 20), () =>
  timeInvoke("mw-member", request("attempt.submit", { attemptId: "x", expectedRevision: 1, answers: [], confirmUnanswered: true }))
);

const pingMs = ping.samples.map((row) => row.ms);
const homeMs = home.samples.map((row) => row.ms);
const treeMs = tree.samples.map((row) => row.ms);
const rankingMs = ranking.samples.map((row) => row.ms);
const submitMs = submitNeg.samples.map((row) => row.ms);

const publicFn = await runTcb(["fn", "detail", "mw-public", "--json"]);
const publicEnv = parseFunctionEnv(publicFn.json) || {};
const runtimeSha = createHash("sha256").update(readFileSync(join(projectRoot(), "cloudfunctions", "_official", "runtime.cjs"))).digest("hex");

const report = redactMw26({
  ok: true,
  leftoverClaimedZero: false,
  enableOverrun: ready.enableOverrun,
  region: ready.region,
  runtime: "Nodejs20.19",
  runtimeSha256Prefix: runtimeSha.slice(0, 12),
  concurrency,
  coldStartMs: {
    ping: ping.samples[0]?.ms,
    home: home.samples[0]?.ms,
    tree: tree.samples[0]?.ms,
    ranking: ranking.samples[0]?.ms
  },
  read: {
    ping: { n: pingMs.length, p50: percentileNearestRank(pingMs, 50), p95: percentileNearestRank(pingMs, 95), targetMs: 1000 },
    home: { n: homeMs.length, p50: percentileNearestRank(homeMs, 50), p95: percentileNearestRank(homeMs, 95), targetMs: 1000 },
    tree: { n: treeMs.length, p50: percentileNearestRank(treeMs, 50), p95: percentileNearestRank(treeMs, 95), targetMs: 1000 },
    rankingListTop: { n: rankingMs.length, p50: percentileNearestRank(rankingMs, 50), p95: percentileNearestRank(rankingMs, 95), targetMs: 1000, note: "只测公开前百查询，全量名次成本见本地 1 万 buildRankingBoards" }
  },
  submit: {
    cloudWeChat50: { result: "NOT_RUN", note: "执行者不得冒充微信身份" },
    unauthAttemptSubmit: {
      n: submitMs.length,
      p95: percentileNearestRank(submitMs, 95),
      targetMs: 2000,
      expected: "AUTH_REQUIRED",
      codes: [...new Set(submitNeg.samples.map((row) => row.code))]
    },
    paymentExternalWait: { result: "NOT_RUN", note: "不真实扣款，支付外部等待单独报告" }
  },
  rankingOpenIdLeaked: ranking.samples.some((row) => row.hasOpenId),
  publicEnvKeys: Object.keys(publicEnv).filter((key) => !/KEY|TOKEN|SECRET|AES/i.test(key)),
  note: "未开超额。达不到 P95 不加资源。E 未闭合不得 leftover=0。"
});
writeJson(join(tmp, "mw26-load.json"), report);
console.log(JSON.stringify(report, null, 2));
process.exit(report.rankingOpenIdLeaked ? 1 : 0);
