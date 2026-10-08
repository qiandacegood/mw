import { parseAllowedMiniAppIds } from "@mw/shared";
import {
  cloudAuditStore,
  cloudIdempotencyStore,
  cloudJobStore,
  cloudMaintenanceStore,
  cloudWorkStore
} from "./modules/cloud-stores.js";
import { cloudMemberWorkStore, cloudPolicyStore } from "./modules/cloud-member-stores.js";
import { handleOfficial, type AdminUserRecord, type AdminUserStore, type OfficialEntry } from "./official.js";

function present(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function redactError(error: unknown): { name: string; message: string } {
  const err = error && typeof error === "object" ? (error as { name?: unknown; message?: unknown }) : {};
  return {
    name: typeof err.name === "string" ? err.name : "Error",
    message: typeof err.message === "string" ? err.message : "unknown"
  };
}

function readWxContext(): {
  fromAppId?: string;
  fromOpenId?: string;
  resourceAppId?: string;
  resourceOpenId?: string;
} {
  try {
    const wx = require("wx-server-sdk") as {
      init: (opts: { env: unknown }) => void;
      DYNAMIC_CURRENT_ENV: unknown;
      getWXContext: () => Record<string, unknown>;
    };
    wx.init({ env: wx.DYNAMIC_CURRENT_ENV });
    const ctx = wx.getWXContext() || {};
    return {
      fromAppId: present(ctx.FROM_APPID) ? String(ctx.FROM_APPID) : undefined,
      fromOpenId: present(ctx.FROM_OPENID) ? String(ctx.FROM_OPENID) : undefined,
      resourceAppId: present(ctx.APPID) ? String(ctx.APPID) : undefined,
      resourceOpenId: present(ctx.OPENID) ? String(ctx.OPENID) : undefined
    };
  } catch {
    return {};
  }
}

async function readAuthUid(): Promise<string | undefined> {
  try {
    const cloudbase = require("@cloudbase/node-sdk") as {
      init: (opts: { env: unknown }) => {
        auth: () => { getEndUserInfo: () => Promise<{ userInfo?: { uid?: string } }> };
      };
      SYMBOL_CURRENT_ENV: unknown;
    };
    const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
    const info = await app.auth().getEndUserInfo();
    const uid = info?.userInfo?.uid;
    return present(uid) ? String(uid) : undefined;
  } catch {
    return undefined;
  }
}

function cloudAdminStore(): AdminUserStore {
  return {
    async getByUid(uid: string): Promise<AdminUserRecord | undefined> {
      const cloudbase = require("@cloudbase/node-sdk") as {
        init: (opts: { env: unknown }) => {
          database: () => {
            collection: (name: string) => {
              doc: (id: string) => { get: () => Promise<unknown> };
            };
          };
        };
        SYMBOL_CURRENT_ENV: unknown;
      };
      const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
      const snap = await app.database().collection("admin_users").doc(uid).get();
      const data = unwrapDoc(snap);
      if (!data) return undefined;
      const roles = Array.isArray(data.roles) ? data.roles.filter((item) => typeof item === "string") : [];
      return {
        uid,
        roles: roles as AdminUserRecord["roles"],
        enabled: data.enabled === true,
        authVersion: typeof data.authVersion === "number" ? data.authVersion : 0
      };
    }
  };
}

function unwrapDoc(snap: unknown): Record<string, unknown> | undefined {
  if (!snap || typeof snap !== "object") return undefined;
  const rec = snap as Record<string, unknown>;
  if (rec.data && typeof rec.data === "object" && !Array.isArray(rec.data)) {
    const inner = rec.data as Record<string, unknown>;
    if (Array.isArray(inner.data)) {
      const first = inner.data[0];
      return first && typeof first === "object" ? (first as Record<string, unknown>) : undefined;
    }
    return inner;
  }
  if (Array.isArray(rec.data)) {
    const first = rec.data[0];
    return first && typeof first === "object" ? (first as Record<string, unknown>) : undefined;
  }
  return undefined;
}

export async function main(entry: OfficialEntry, event: unknown): Promise<unknown> {
  try {
    const wx = readWxContext();
    const authUid = entry === "mw-admin" ? await readAuthUid() : undefined;
    return await handleOfficial({
      entry,
      event,
      allowedAppIds: parseAllowedMiniAppIds(process.env.MW_ALLOWED_MINI_APPIDS),
      fromAppId: wx.fromAppId,
      fromOpenId: wx.fromOpenId,
      resourceAppId: wx.resourceAppId,
      resourceOpenId: wx.resourceOpenId,
      authUid,
      adminStore: entry === "mw-admin" ? cloudAdminStore() : undefined,
      jobsSecret: process.env.MW_JOBS_INVOKE_TOKEN,
      jobStore: entry === "mw-admin" || entry === "mw-jobs" ? cloudJobStore() : undefined,
      idempotencyStore: entry === "mw-admin" || entry === "mw-jobs" ? cloudIdempotencyStore() : undefined,
      auditStore: entry === "mw-admin" ? cloudAuditStore() : undefined,
      workStore: entry === "mw-admin" || entry === "mw-jobs" ? cloudWorkStore() : undefined,
      maintenanceStore: entry === "mw-pay-hook" || entry === "mw-admin" || entry === "mw-jobs" ? cloudMaintenanceStore() : undefined,
      policyStore: entry === "mw-public" || entry === "mw-member" ? cloudPolicyStore() : undefined,
      memberStore: entry === "mw-member" ? cloudMemberWorkStore() : undefined
    });
  } catch (error) {
    return {
      ok: false,
      requestId: "unknown",
      error: {
        code: "INTERNAL_ERROR",
        message: "内部错误",
        retryable: false,
        details: redactError(error)
      }
    };
  }
}
