"use strict";

const FORGED_FIELDS = [
  "userId",
  "userid",
  "openid",
  "openId",
  "open_id",
  "unionid",
  "unionId",
  "uid",
  "role",
  "score",
  "vipExpiresAt"
];

const COLLECTIONS = {
  tx: "mw_validation_tx",
  index: "mw_validation_index",
  adminUsers: "mw_validation_admin_users",
  files: "mw_validation_files",
  docs: "mw_validation_docs"
};

const INDEX_SPEC = {
  name: "mw_validation_parent_sort",
  keys: { parentId: 1, deletedAt: 1, sort: 1, _id: 1 }
};

function safeError(error) {
  return {
    name: error && error.name ? String(error.name) : "Error",
    message: error && error.message ? String(error.message) : "unknown",
    code: error && error.code ? String(error.code) : undefined
  };
}

function present(value) {
  return Boolean(value && String(value).trim());
}

function redactIdentity(value) {
  if (!present(value)) {
    return { present: false };
  }
  return { present: true, length: String(value).length };
}

function forgedFieldsOf(body) {
  if (!body || typeof body !== "object") {
    return [];
  }
  return FORGED_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(body, field));
}

function unwrapSnapshot(snap) {
  if (!snap || typeof snap !== "object") {
    return undefined;
  }
  const data = snap.data;
  if (Array.isArray(data)) {
    const first = data[0];
    return first && typeof first === "object" ? first : undefined;
  }
  if (data && typeof data === "object") {
    if (Array.isArray(data.data)) {
      const first = data.data[0];
      return first && typeof first === "object" ? first : undefined;
    }
    return data;
  }
  return snap;
}

function loadSdks() {
  const loaded = { node: null, wx: null, versions: {}, errors: [] };
  try {
    const cloudbase = require("@cloudbase/node-sdk");
    loaded.node = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
    loaded.versions.node_sdk = require("@cloudbase/node-sdk/package.json").version;
    loaded.cloudbase = cloudbase;
  } catch (error) {
    loaded.errors.push({ sdk: "@cloudbase/node-sdk", ...safeError(error) });
  }
  try {
    const wx = require("wx-server-sdk");
    wx.init({ env: wx.DYNAMIC_CURRENT_ENV });
    loaded.wx = wx;
    loaded.versions.wx_server_sdk = require("wx-server-sdk/package.json").version;
  } catch (error) {
    loaded.errors.push({ sdk: "wx-server-sdk", ...safeError(error) });
  }
  return loaded;
}

function readWxContext(wx) {
  if (!wx) {
    return { available: false, reason: "wx-server-sdk-not-loaded" };
  }
  try {
    const ctx = wx.getWXContext() || {};
    return {
      available: true,
      appid: redactIdentity(ctx.APPID),
      openid: redactIdentity(ctx.OPENID),
      unionid: redactIdentity(ctx.UNIONID),
      tourist: ctx.APPID === "touristappid",
      trusted_mini: present(ctx.APPID) && ctx.APPID !== "touristappid" && present(ctx.OPENID)
    };
  } catch (error) {
    return { available: false, reason: safeError(error).message };
  }
}

async function ensureCollection(db, name) {
  try {
    await db.createCollection(name);
    return { name, created: true };
  } catch (error) {
    return { name, created: false, reason: safeError(error).message };
  }
}

async function actionPing(sdks, context) {
  const mem = process.memoryUsage();
  return {
    runtime: {
      node: process.version,
      platform: process.platform
    },
    sdk_versions: sdks.versions,
    sdk_errors: sdks.errors,
    function: {
      memory_limit_mb: context && context.memory_limit_in_mb,
      time_limit_ms: context && context.time_limit_in_ms,
      request_id_present: Boolean(context && context.request_id)
    },
    memory: {
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024)
    }
  };
}

async function actionIdentity(sdks, event) {
  const wx = readWxContext(sdks.wx);
  const forged_fields = forgedFieldsOf(event);
  let endUser = { available: false };
  if (sdks.node && sdks.node.auth) {
    try {
      const info = await sdks.node.auth().getEndUserInfo();
      const user = info && (info.userInfo || info.data || info);
      endUser = {
        available: true,
        uid: redactIdentity(user && (user.uid || user.userId)),
        login_type_present: Boolean(user && user.loginType)
      };
    } catch (error) {
      endUser = { available: false, reason: safeError(error).message };
    }
  }
  return {
    wx_context: wx,
    auth_user: endUser,
    forged_fields,
    client_identity_accepted: false,
    formal_wechat_identity: wx.trusted_mini ? "present" : "unverified",
    note: wx.trusted_mini
      ? "trusted miniprogram context present; client fields ignored"
      : "CLI/HTTP invoke has no trusted OPENID; client fields ignored"
  };
}

async function actionAdmin(sdks, event) {
  const forged_fields = forgedFieldsOf(event);
  let authUid = "";
  if (sdks.node && sdks.node.auth) {
    try {
      const info = await sdks.node.auth().getEndUserInfo();
      const user = info && (info.userInfo || info.data || info);
      authUid = (user && (user.uid || user.userId)) || "";
    } catch {
      authUid = "";
    }
  }
  const db = sdks.node && sdks.node.database();
  let whitelistHit = false;
  let enabled = false;
  let lookup = { skipped: true };
  if (db && present(authUid)) {
    await ensureCollection(db, COLLECTIONS.adminUsers);
    try {
      const snap = await db.collection(COLLECTIONS.adminUsers).doc(authUid).get();
      const row = unwrapSnapshot(snap);
      whitelistHit = Boolean(row);
      enabled = Boolean(row && row.enabled);
      lookup = { skipped: false, found: whitelistHit, enabled };
    } catch (error) {
      lookup = { skipped: false, ...safeError(error) };
    }
  }
  const allowed = Boolean(authUid) && whitelistHit && enabled;
  return {
    forged_fields,
    client_uid_ignored: Boolean(event && (event.uid || event.userId)),
    auth_uid_present: Boolean(authUid),
    whitelist: lookup,
    allowed,
    reason: !authUid ? "NO_AUTH_UID" : !whitelistHit ? "NOT_IN_ADMIN_WHITELIST" : !enabled ? "ADMIN_DISABLED" : "AUTH_UID_AND_WHITELIST"
  };
}

async function runOpCount(db, collection, docId, opCount) {
  const started = Date.now();
  try {
    await db.runTransaction(async (transaction) => {
      const ref = transaction.collection(collection).doc(docId);
      await ref.set({ kind: "op-count", opCount, updatedAt: Date.now() });
      let used = 1;
      while (used < opCount) {
        await ref.get();
        used += 1;
        if (used >= opCount) {
          break;
        }
        await ref.update({ used, updatedAt: Date.now() });
        used += 1;
      }
    });
    return { ok: true, opCount, elapsed_ms: Date.now() - started };
  } catch (error) {
    return { ok: false, opCount, elapsed_ms: Date.now() - started, ...safeError(error) };
  }
}

async function actionTxOps(sdks) {
  if (!sdks.node) {
    return { ok: false, reason: "node-sdk-missing" };
  }
  const db = sdks.node.database();
  await ensureCollection(db, COLLECTIONS.tx);
  const results = [];
  for (const count of [60, 100, 101]) {
    results.push(await runOpCount(db, COLLECTIONS.tx, `ops_${count}`, count));
  }
  return {
    official_doc: { max_ops: 100, timeout_seconds: 30 },
    design_budget: { max_ops: 60, target_seconds: 3 },
    results
  };
}

async function actionTxInit(sdks, runId) {
  if (!sdks.node) {
    return { ok: false, reason: "node-sdk-missing" };
  }
  const db = sdks.node.database();
  await ensureCollection(db, COLLECTIONS.tx);
  const id = `claim_${runId}`;
  await db.collection(COLLECTIONS.tx).doc(id).set({
    remaining: 1,
    reservedBy: "",
    schemaVersion: 1,
    createdAt: Date.now()
  });
  return { ok: true, docId: id };
}

async function actionTxClaim(sdks, runId, slot) {
  if (!sdks.node) {
    return { ok: false, reason: "node-sdk-missing" };
  }
  const db = sdks.node.database();
  const id = `claim_${runId}`;
  try {
    const result = await db.runTransaction(async (transaction) => {
      const snap = await transaction.collection(COLLECTIONS.tx).doc(id).get();
      const row = unwrapSnapshot(snap) || {};
      if (Number(row.remaining) !== 1) {
        return { claimed: false, reason: "ALREADY_TAKEN" };
      }
      await transaction.collection(COLLECTIONS.tx).doc(id).update({
        remaining: 0,
        reservedBy: slot,
        updatedAt: Date.now()
      });
      return { claimed: true, slot };
    });
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, slot, ...safeError(error) };
  }
}

async function actionTxRead(sdks, runId) {
  if (!sdks.node) {
    return { ok: false, reason: "node-sdk-missing" };
  }
  const db = sdks.node.database();
  const id = `claim_${runId}`;
  const snap = await db.collection(COLLECTIONS.tx).doc(id).get();
  const row = unwrapSnapshot(snap) || {};
  return {
    ok: true,
    remaining: row.remaining,
    reservedBy: row.reservedBy
  };
}

async function actionIndex(sdks) {
  if (!sdks.node) {
    return { ok: false, reason: "node-sdk-missing" };
  }
  const db = sdks.node.database();
  const created = await ensureCollection(db, COLLECTIONS.index);
  const col = db.collection(COLLECTIONS.index);
  await col.doc("cat_root_a").set({ parentId: "root", deletedAt: "", sort: 2, name: "fict_a" });
  await col.doc("cat_root_b").set({ parentId: "root", deletedAt: "", sort: 1, name: "fict_b" });
  await col.doc("cat_other").set({ parentId: "other", deletedAt: "", sort: 1, name: "fict_c" });

  let createIndex = { attempted: [] };
  const attempts = [
    async () => col.createIndex(INDEX_SPEC),
    async () => col.createIndex(INDEX_SPEC.keys, { name: INDEX_SPEC.name }),
    async () => db.createIndex(COLLECTIONS.index, INDEX_SPEC)
  ];
  for (const [i, attempt] of attempts.entries()) {
    try {
      const result = await attempt();
      createIndex = { attempted: i + 1, ok: true, result: result && typeof result === "object" ? Object.keys(result) : true };
      break;
    } catch (error) {
      createIndex.attempted.push({ i, ...safeError(error) });
    }
  }

  const query = await col.where({ parentId: "root", deletedAt: "" }).orderBy("sort", "asc").orderBy("_id", "asc").get();
  const ids = ((query && query.data) || []).map((row) => row._id || row.id);
  return {
    collection: created,
    create_index: createIndex,
    query_order: ids,
    expected_order: ["cat_root_b", "cat_root_a"],
    order_ok: ids[0] === "cat_root_b" && ids[1] === "cat_root_a"
  };
}

async function actionStorage(sdks, event) {
  if (!sdks.node) {
    return { ok: false, reason: "node-sdk-missing" };
  }
  const db = sdks.node.database();
  await ensureCollection(db, COLLECTIONS.files);
  const owner = event && event.asOwner === "b" ? "test_member_b" : "test_member_a";
  const cloudPath = "mw-test/validation/private-sample.txt";
  const result = await sdks.node.uploadFile({
    cloudPath,
    fileContent: Buffer.from("mw_validation_fictitious_private_file")
  });
  const fileID = result.fileID || result.fileId;
  await db.collection(COLLECTIONS.files).doc("sample").set({
    fileID,
    owner: "test_member_a",
    cloudPath
  });
  const snap = await db.collection(COLLECTIONS.files).doc("sample").get();
  const row = unwrapSnapshot(snap) || {};
  const ownerMatch = owner === row.owner;
  let temp = { issued: false };
  if (ownerMatch && fileID) {
    try {
      const urls = await sdks.node.getTempFileURL({ fileList: [fileID], maxAge: 60 });
      const first = urls && urls.fileList && urls.fileList[0];
      temp = {
        issued: Boolean(first && first.tempFileURL),
        code: first && first.code,
        maxAge: 60
      };
    } catch (error) {
      temp = { issued: false, ...safeError(error) };
    }
  }
  return {
    file_uploaded: Boolean(fileID),
    owner_match: ownerMatch,
    issue_temp_url: temp.issued,
    temp,
    public_candidates: fileID
      ? [
          `https://6d77-mw-placeholder.tcb.qcloud.la/${cloudPath}`,
          `https://placeholder.cos.ap-shanghai.myqcloud.com/${cloudPath}`
        ]
      : []
  };
}

async function actionUploadSize(sdks, event) {
  if (!sdks.node) {
    return { ok: false, reason: "node-sdk-missing" };
  }
  const megabytes = Number(event && event.megabytes);
  if (megabytes !== 4.9 && megabytes !== 5.1) {
    return { ok: false, reason: "INVALID_SIZE_CASE" };
  }
  const bytes = Math.round(megabytes * 1024 * 1024);
  const cloudPath = `mw-test/validation/size-${String(megabytes).replace(".", "p")}.bin`;
  const started = Date.now();
  try {
    const result = await sdks.node.uploadFile({
      cloudPath,
      fileContent: Buffer.alloc(bytes, 7)
    });
    return {
      ok: true,
      megabytes,
      bytes,
      elapsed_ms: Date.now() - started,
      file_uploaded: Boolean(result.fileID || result.fileId)
    };
  } catch (error) {
    return {
      ok: false,
      megabytes,
      bytes,
      elapsed_ms: Date.now() - started,
      ...safeError(error)
    };
  }
}

async function actionCleanup(sdks) {
  if (!sdks.node) {
    return { ok: false, reason: "node-sdk-missing" };
  }
  const db = sdks.node.database();
  const removed = [];
  for (const name of Object.values(COLLECTIONS)) {
    try {
      const snap = await db.collection(name).limit(100).get();
      const docs = (snap && snap.data) || [];
      for (const row of docs) {
        if (row._id) {
          await db.collection(name).doc(row._id).remove();
        }
      }
      removed.push({ name, docs: docs.length });
    } catch (error) {
      removed.push({ name, ...safeError(error) });
    }
  }
  return { ok: true, removed, note: "collections retained; documents cleared" };
}

exports.main = async function main(event, context) {
  const sdks = loadSdks();
  const action = event && event.action ? String(event.action) : "ping";
  try {
    switch (action) {
      case "ping":
        return { ok: true, action, data: await actionPing(sdks, context) };
      case "identity":
        return { ok: true, action, data: await actionIdentity(sdks, event) };
      case "admin":
        return { ok: true, action, data: await actionAdmin(sdks, event) };
      case "tx_ops":
        return { ok: true, action, data: await actionTxOps(sdks) };
      case "tx_init":
        return { ok: true, action, data: await actionTxInit(sdks, event.runId) };
      case "tx_claim":
        return { ok: true, action, data: await actionTxClaim(sdks, event.runId, event.slot) };
      case "tx_read":
        return { ok: true, action, data: await actionTxRead(sdks, event.runId) };
      case "index":
        return { ok: true, action, data: await actionIndex(sdks) };
      case "storage":
        return { ok: true, action, data: await actionStorage(sdks, event) };
      case "upload_size":
        return { ok: true, action, data: await actionUploadSize(sdks, event) };
      case "cleanup":
        return { ok: true, action, data: await actionCleanup(sdks) };
      default:
        return { ok: false, action, reason: "UNKNOWN_ACTION" };
    }
  } catch (error) {
    return { ok: false, action, error: safeError(error) };
  }
};
