export type AdminSession = {
  loggedIn: boolean;
  uidPresent: boolean;
  roles: string[];
  enabled?: boolean;
  error?: string;
  errorCode?: string;
  errorReason?: string;
};

type CloudApp = {
  auth: () => {
    signInWithPassword: (input: { username: string; password: string }) => Promise<unknown>;
    getLoginState: () => Promise<{ user?: { uid?: string } } | null>;
    signOut: () => Promise<unknown>;
  };
  callFunction: (input: { name: string; data: unknown }) => Promise<{ result?: unknown }>;
};

export function readAdminWebEnv(): { envId: string; region: string } {
  const envId = import.meta.env.VITE_CLOUDBASE_ENV_ID || "";
  const region = import.meta.env.VITE_CLOUDBASE_REGION || "ap-shanghai";
  if (!envId || envId.includes("placeholder")) {
    throw new Error("本地未配置后台环境，无法登录");
  }
  return { envId, region };
}

export async function createAdminApp(): Promise<CloudApp> {
  const { envId, region } = readAdminWebEnv();
  const mod = await import("@cloudbase/js-sdk");
  const cloudbase = mod.default || mod;
  return cloudbase.init({ env: envId, region }) as CloudApp;
}

export async function loginAndReadAdmin(app: CloudApp, username: string, password: string): Promise<AdminSession> {
  if (!username.trim() || !password) {
    return { loggedIn: false, uidPresent: false, roles: [], error: "请输入用户名和密码" };
  }
  await app.auth().signInWithPassword({ username: username.trim(), password });
  const state = await app.auth().getLoginState();
  const uidPresent = Boolean(state?.user?.uid);
  const result = await app.callFunction({
    name: "mw-admin",
    data: {
      apiVersion: "1",
      action: "admin.me",
      requestId: `req_admin_${Date.now()}`,
      data: {}
    }
  });
  const body = unwrapCallResult(result);
  if (!body?.ok) {
    return {
      loggedIn: false,
      uidPresent,
      roles: [],
      error: body?.error?.message || "后台拒绝",
      errorCode: body?.error?.code,
      errorReason: body?.error?.details?.reason
    };
  }
  return {
    loggedIn: true,
    uidPresent,
    roles: body.data?.roles || [],
    enabled: body.data?.enabled
  };
}

export async function signOutAdmin(app: CloudApp): Promise<void> {
  await app.auth().signOut();
}

export type AdminCallResult = {
  ok?: boolean;
  data?: Record<string, unknown>;
  error?: { code?: string; message?: string; details?: { reason?: string; note?: string } };
};

export async function callAdminCategory(
  app: CloudApp,
  action: "category.tree" | "category.create" | "category.update" | "category.delete" | "category.seed",
  data: Record<string, unknown>,
  idempotencyKey?: string
): Promise<AdminCallResult> {
  const payload: Record<string, unknown> = {
    apiVersion: "1",
    action,
    requestId: `req_admin_${action}_${Date.now()}`,
    data
  };
  if (action !== "category.tree") {
    payload.idempotencyKey = idempotencyKey || `mw09/admin/${action}/${Date.now()}`;
  }
  const result = await app.callFunction({ name: "mw-admin", data: payload });
  return unwrapCallResult(result);
}

export async function callAdminJob(
  app: CloudApp,
  action: "job.get" | "job.resume",
  data: { jobId: string; reason?: string },
  idempotencyKey?: string
): Promise<AdminCallResult> {
  const payload: Record<string, unknown> = {
    apiVersion: "1",
    action,
    requestId: `req_admin_${action}_${Date.now()}`,
    data
  };
  if (action === "job.resume") {
    payload.idempotencyKey = idempotencyKey || `mw06/test/admin_resume_${Date.now()}`;
  }
  const result = await app.callFunction({ name: "mw-admin", data: payload });
  return unwrapCallResult(result);
}

function unwrapCallResult(result: unknown): {
  ok?: boolean;
  data?: { roles?: string[]; enabled?: boolean } & Record<string, unknown>;
  error?: { code?: string; message?: string; details?: { reason?: string } };
} {
  if (!result || typeof result !== "object") return {};
  const rec = result as Record<string, unknown>;
  const candidates = [rec.result, rec.data, rec];
  for (const item of candidates) {
    if (item && typeof item === "object" && ("ok" in item || "error" in item)) {
      return item as {
        ok?: boolean;
        data?: { roles?: string[]; enabled?: boolean } & Record<string, unknown>;
        error?: { code?: string; message?: string; details?: { reason?: string } };
      };
    }
  }
  return {};
}
