import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { authorizedEnvId, assertMwTestReady, projectRoot, runTcb, writeJson } from "./mw04-lib.mjs";
import {
  createCollectionCommand,
  emptyMw27Counts,
  MW27_FIXTURE_MARKER,
  MW27_FIXTURE_ROUND,
  MW27_ISOLATED_RESTORE_COLLECTIONS,
  mw27Tmp,
  nosqlUpsertCommand,
  omitDocId,
  redactMw27
} from "./mw27-lib.mjs";

const root = projectRoot();
const tmp = mw27Tmp();
const ready = await assertMwTestReady();
if (ready.enableOverrun === true) throw new Error("EnableOverrun must stay false");
authorizedEnvId();

const shared = spawnSync(process.execPath, [join(root, "scripts", "ensure-shared-js.mjs")], { cwd: root, encoding: "utf8" });
if (shared.status !== 0) throw new Error("shared emit failed");

const restore = await import("../packages/shared/dist/mw27-restore.js");
const now = new Date();
const nowIso = now.toISOString();
const leaseExpired = new Date(now.getTime() - 60_000).toISOString();
const futureRun = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

const memberId = restore.mw27MemberId(0);
const identityId = restore.mw27IdentityId(0);
const grantedOrderId = restore.mw27OrderId("order_granted", 0);
const pendingOrderId = restore.mw27OrderId("order_pending", 0);
const grantId = restore.mw27GrantId(0);
const receiptId = restore.mw27ReceiptId(0);
const callbackPaidId = restore.mw27CallbackId("callback_paid", 0);
const callbackPendingId = restore.mw27CallbackId("callback_pending", 0);
const refundId = restore.mw27RefundId(0);
const eventId = restore.mw27EventId(0);
const jobInterruptId = restore.mw27JobId("job_interrupted", 0);
const jobReviewId = restore.mw27JobId("job_review", 0);
const channelBizGranted = restore.mw27ChannelBizNo(0);
const channelBizPending = restore.mw27ChannelBizNo(10);

function mark(payload) {
  return restore.mw27FixturePayload({ ...payload, createdAt: nowIso, updatedAt: nowIso });
}

for (const name of MW27_ISOLATED_RESTORE_COLLECTIONS) {
  const created = await runTcb(["db", "nosql", "execute", "--command", JSON.stringify([createCollectionCommand(name)]), "--json"]);
  if (created.code !== 0 && !/already exists|ResourceInUse|exist/i.test(`${created.stderr || ""} ${JSON.stringify(created.json || {})}`)) {
    throw new Error(`create ${name} failed`);
  }
}

const livePairs = [
  [
    "identities",
    identityId,
    mark({
      memberId,
      provider: "wechat_mini",
      status: "active"
    })
  ],
  [
    "members",
    memberId,
    mark({
      nickname: "MW27-restore-fixture",
      status: "active",
      rankingOptIn: false,
      revision: 1
    })
  ],
  [
    "orders",
    grantedOrderId,
    mark({
      channelBizNo: channelBizGranted,
      memberId,
      payState: "paid",
      grantState: "granted",
      refundState: "requested",
      amountFen: 1,
      channel: "android",
      environment: 1,
      paidAt: nowIso,
      grantedAt: nowIso,
      fixtureLedger: true
    })
  ],
  [
    "orders",
    pendingOrderId,
    mark({
      channelBizNo: channelBizPending,
      memberId,
      payState: "pending",
      grantState: "pending",
      refundState: "none",
      amountFen: 1,
      channel: "android",
      environment: 1,
      fixtureLedger: true
    })
  ],
  [
    "payment_receipts",
    receiptId,
    mark({
      orderId: grantedOrderId,
      provider: "wechat_virtual_pay",
      environment: 1,
      transactionId: restore.mw27FixtureId("txn", 0),
      amountFen: 1
    })
  ],
  [
    "callback_events",
    callbackPaidId,
    mark({
      provider: "wechat_virtual_pay",
      type: "pay",
      orderId: grantedOrderId,
      status: "matched",
      stableEventKey: restore.mw27StableEventKey("pay", 0)
    })
  ],
  [
    "callback_events",
    callbackPendingId,
    mark({
      provider: "wechat_virtual_pay",
      type: "pay",
      orderId: pendingOrderId,
      status: "received",
      stableEventKey: restore.mw27StableEventKey("pending", 0)
    })
  ],
  [
    "refunds",
    refundId,
    mark({
      orderId: grantedOrderId,
      memberId,
      requestedFen: 1,
      confirmedFen: null,
      state: "requested",
      kind: "whole",
      channel: "android",
      fixture: true,
      unknownResult: true
    })
  ],
  [
    "vip_grants",
    grantId,
    mark({
      memberId,
      sourceType: "order",
      sourceId: grantedOrderId,
      grantedSeconds: 86400,
      remainingSeconds: 86400,
      consumedSeconds: 0,
      revokedSeconds: 0,
      sequence: 1,
      grantedAt: nowIso,
      reason: "mw27-restore-fixture"
    })
  ],
  [
    "vip_accounts",
    memberId,
    mark({
      expiresAt: new Date(now.getTime() + 86400 * 1000).toISOString(),
      remainingSeconds: 86400,
      grantIds: [grantId],
      revision: 1,
      reconcileState: "idle"
    })
  ],
  [
    "vip_events",
    eventId,
    mark({
      memberId,
      sourceId: grantedOrderId,
      type: "grant",
      seconds: 86400,
      accountRevision: 1,
      effectiveAt: nowIso
    })
  ],
  [
    "jobs",
    jobInterruptId,
    mark({
      type: "mw27.restore.demo",
      businessKey: "mw27/interrupt",
      state: "running",
      cursor: { done: 1, total: 3, stage: "restore" },
      leaseUntil: leaseExpired,
      fencingToken: 1,
      attempts: 1,
      maxAttempts: 3,
      nextRunAt: futureRun
    })
  ],
  [
    "jobs",
    jobReviewId,
    mark({
      type: "mw27.restore.demo",
      businessKey: "mw27/review",
      state: "needsReview",
      cursor: { done: 2, total: 3, stage: "restore" },
      leaseUntil: null,
      fencingToken: 2,
      attempts: 3,
      maxAttempts: 3,
      nextRunAt: futureRun,
      lastError: { code: "MW27_INTERRUPT", message: "fixture" }
    })
  ]
];

const isolatedPairs = livePairs
  .map(([collection, id, payload]) => {
    const isolated = restore.mw27IsolatedCollectionFor(collection);
    return isolated ? [isolated, id, payload] : null;
  })
  .filter(Boolean);

async function upsertMany(pairs) {
  for (let i = 0; i < pairs.length; i += 5) {
    const chunk = pairs.slice(i, i + 5).map(([collection, id, payload]) => nosqlUpsertCommand(collection, id, omitDocId(payload)));
    const result = await runTcb(["db", "nosql", "execute", "--command", JSON.stringify(chunk), "--json"], { timeoutMs: 120000 });
    if (result.code !== 0) throw new Error(result.stderr || "mw27 upsert failed");
  }
}

await upsertMany(livePairs);
await upsertMany(isolatedPairs);

const counts = {
  ...emptyMw27Counts(),
  members: 1,
  identities: 1,
  orders: 2,
  payment_receipts: 1,
  callback_events: 2,
  refunds: 1,
  vip_accounts: 1,
  vip_grants: 1,
  vip_events: 1,
  jobs: 2,
  isolated: isolatedPairs.length
};

const state = {
  wroteDocs: true,
  resolved: false,
  fixtureRound: MW27_FIXTURE_ROUND,
  fixtureMarker: MW27_FIXTURE_MARKER,
  seededAt: nowIso,
  counts,
  leftoverClaimedZero: false,
  note: "本轮夹具与隔离回档集合。禁止把历史账本当夹具删掉。"
};
writeFileSync(join(root, "configs", "mw27-verify-state.json"), `${JSON.stringify(state, null, 2)}\n`);
writeJson(join(tmp, "mw27-seed-evidence.json"), redactMw27({
  ok: true,
  wroteDocs: true,
  counts,
  isolatedCollections: MW27_ISOLATED_RESTORE_COLLECTIONS,
  leftoverClaimedZero: false
}));

console.log(
  JSON.stringify(
    redactMw27({
      ok: true,
      wroteDocs: true,
      counts,
      leftoverClaimedZero: false,
      note: "夹具已写入 live + mw27_rst_*。未覆盖历史集合。E 前不得 leftover=0。"
    }),
    null,
    2
  )
);
