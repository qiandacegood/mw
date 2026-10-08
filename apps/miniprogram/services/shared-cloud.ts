import { evaluateSharedCloudConfig, type SharedCloudConfig } from "./shared-cloud-config";

type SharedCallResult = {
  ok: boolean;
  entry: string;
  trustedFromContext: boolean;
  reason: string;
};

function loadLocal(): { loaded: boolean; config?: SharedCloudConfig } {
  try {
    return { loaded: true, config: require("./cloud.runtime") as SharedCloudConfig };
  } catch {
    try {
      return { loaded: true, config: require("../cloud.local") as SharedCloudConfig };
    } catch {
      return { loaded: false };
    }
  }
}

export function sharedCloudReady() {
  const local = loadLocal();
  return evaluateSharedCloudConfig(local.loaded, local.config);
}

export async function callSharedOfficial(entry: "mw-public" | "mw-member"): Promise<SharedCallResult> {
  const local = loadLocal();
  const ready = evaluateSharedCloudConfig(local.loaded, local.config);
  if (!ready.ready) {
    return { ok: false, entry, trustedFromContext: false, reason: ready.reason };
  }
  const resourceEnv = String(local.config?.resourceEnv || "").trim();
  const resourceAppId = String(local.config?.resourceAppId || "").trim();
  const cloud = new wx.cloud.Cloud({
    resourceAppid: resourceAppId,
    resourceEnv
  });
  await cloud.init();
  const action = entry === "mw-public" ? "public.ping" : "member.session";
  const res = await cloud.callFunction({
    name: entry,
    data: {
      apiVersion: "1",
      action,
      requestId: `req_mp_${entry}_${Date.now()}`,
      data: {}
    }
  });
  const body = (res && res.result && typeof res.result === "object" ? res.result : {}) as {
    ok?: unknown;
    error?: { code?: unknown; details?: { reason?: unknown } };
  };
  const reason =
    body.error?.details?.reason ||
    (body.ok ? "TRUSTED_OR_PUBLIC_OK" : body.error?.code) ||
    "UNKNOWN";
  return {
    ok: Boolean(body.ok),
    entry,
    trustedFromContext: Boolean(body.ok && entry === "mw-member"),
    reason: String(reason)
  };
}
