type LocalCloud = {
  resourceEnv?: string;
  resourceAppId?: string;
  resourceEnvPresent?: boolean;
  resourceAppIdPresent?: boolean;
};

type SharedCallResult = {
  ok: boolean;
  entry: string;
  trustedFromContext: boolean;
  reason: string;
};

function loadLocal(): LocalCloud {
  try {
    return require("./cloud.runtime") as LocalCloud;
  } catch {
    try {
      return require("../cloud.local") as LocalCloud;
    } catch {
      return {};
    }
  }
}

function missingReason(local: LocalCloud): string {
  if (!local.resourceEnv && !local.resourceAppId) return "LOCAL_SHARED_REQUIRE_FAILED";
  return "LOCAL_SHARED_CONFIG_MISSING";
}

export function sharedCloudReady(): { ready: boolean; reason: string } {
  const local = loadLocal();
  if (!local.resourceEnv || !local.resourceAppId) {
    return { ready: false, reason: missingReason(local) };
  }
  return { ready: true, reason: "LOCAL_SHARED_CONFIG_PRESENT" };
}

export async function callSharedOfficial(entry: "mw-public" | "mw-member"): Promise<SharedCallResult> {
  const local = loadLocal();
  if (!local.resourceEnv || !local.resourceAppId) {
    return { ok: false, entry, trustedFromContext: false, reason: missingReason(local) };
  }
  const cloud = new wx.cloud.Cloud({
    resourceAppid: local.resourceAppId,
    resourceEnv: local.resourceEnv
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
