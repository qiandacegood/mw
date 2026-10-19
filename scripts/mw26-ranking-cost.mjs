import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { projectRoot, writeJson } from "./mw04-lib.mjs";
import { mw26Tmp, percentileNearestRank, redactMw26 } from "./mw26-lib.mjs";

const root = projectRoot();
const shared = spawnSync(process.execPath, [join(root, "scripts", "ensure-shared-js.mjs")], { cwd: root, encoding: "utf8" });
if (shared.status !== 0) throw new Error("shared emit failed");

const { buildRankingBoards, RANKING_BUILD_SCAN_LIMIT, RANKING_TOP_LIMIT, RANKING_REFRESH_TARGET_MS } = await import(
  "../packages/shared/dist/ranking.js"
);

const n = Number(process.env.MW26_RANK_N || 10000) || 10000;
const members = Array.from({ length: n }, (_, index) => ({
  memberId: `m${index}`,
  nickname: `夹具${index}`,
  avatarKey: "avatar.builtin.01",
  levelId: "L1",
  eligible: true
}));
const metrics = members.map((row, index) => ({
  scope: "total",
  periodKey: "all",
  categoryId: "",
  memberId: row.memberId,
  value: 1 + (index % 99),
  reachedAt: "2026-10-19T02:00:00.000Z"
}));
const started = Date.now();
const boards = buildRankingBoards({ metrics, members, categoryIds: [] });
const elapsedMs = Date.now() - started;
const total = boards.find((board) => board.ref.scope === "total");
const leaked = /openid|OPENID|AppKey/i.test(JSON.stringify(total?.ranked?.slice(0, 5) || []));
const summary = redactMw26({
  n,
  elapsedMs,
  participantCount: total?.ranked.length || 0,
  displayCount: total?.displayCount || 0,
  lastRank: total?.ranked?.[n - 1]?.rank || null,
  topLimit: RANKING_TOP_LIMIT,
  scanLimit: RANKING_BUILD_SCAN_LIMIT,
  targetMs: RANKING_REFRESH_TARGET_MS,
  truncated: Boolean(total?.boundaryTruncated),
  openIdLeaked: leaked,
  withinTarget: elapsedMs < RANKING_REFRESH_TARGET_MS && (total?.ranked.length || 0) === n,
  note: "全量名次成本=为全体参与者生成 rank，不只测前 100 行查询。"
});
writeJson(join(mw26Tmp(), "mw26-ranking-cost.json"), summary);
console.log(JSON.stringify(summary, null, 2));
if (!summary.withinTarget || leaked) process.exit(1);
