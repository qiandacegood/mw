export type AdminSession = {
  loggedIn: boolean;
  uidPresent: boolean;
  roles: string[];
  enabled?: boolean;
  error?: string;
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
  const body = result?.result as { ok?: boolean; data?: { roles?: string[]; enabled?: boolean }; error?: { code?: string; message?: string } };
  if (!body?.ok) {
    return {
      loggedIn: false,
      uidPresent,
      roles: [],
      error: body?.error?.message || "后台拒绝"
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
