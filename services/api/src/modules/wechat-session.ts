export type Code2SessionResult =
  | { ok: true; openid: string; sessionKey: string }
  | { ok: false; reason: string };

export type Code2SessionFn = (code: string) => Promise<Code2SessionResult>;

export async function exchangeJsCode(input: {
  appId: string;
  appSecret: string;
  code: string;
  transport?: (url: string) => Promise<Record<string, unknown>>;
}): Promise<Code2SessionResult> {
  if (!input.appId || !input.appSecret) return { ok: false, reason: "SESSION_CONFIG_MISSING" };
  if (!input.code) return { ok: false, reason: "WX_LOGIN_CODE_REQUIRED" };
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(input.appId)}&secret=${encodeURIComponent(input.appSecret)}&js_code=${encodeURIComponent(input.code)}&grant_type=authorization_code`;
  try {
    const json = input.transport
      ? await input.transport(url)
      : ((await (await fetch(url)).json()) as Record<string, unknown>);
    const errcode = typeof json.errcode === "number" ? json.errcode : 0;
    if (errcode) {
      if (errcode === 40163 || errcode === 40029) return { ok: false, reason: "WX_LOGIN_CODE_INVALID" };
      return { ok: false, reason: "WX_LOGIN_CODE_REJECTED" };
    }
    const openid = typeof json.openid === "string" ? json.openid : "";
    const sessionKey = typeof json.session_key === "string" ? json.session_key : "";
    if (!openid || !sessionKey) return { ok: false, reason: "SESSION_INCOMPLETE" };
    return { ok: true, openid, sessionKey };
  } catch {
    return { ok: false, reason: "SESSION_EXCHANGE_FAILED" };
  }
}

export async function readAccessToken(input: {
  appId: string;
  appSecret: string;
  transport?: (url: string) => Promise<Record<string, unknown>>;
}): Promise<{ ok: true; accessToken: string } | { ok: false; reason: string }> {
  if (!input.appId || !input.appSecret) return { ok: false, reason: "ACCESS_TOKEN_CONFIG_MISSING" };
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(input.appId)}&secret=${encodeURIComponent(input.appSecret)}`;
  try {
    const json = input.transport
      ? await input.transport(url)
      : ((await (await fetch(url)).json()) as Record<string, unknown>);
    const token = typeof json.access_token === "string" ? json.access_token : "";
    if (!token) return { ok: false, reason: "ACCESS_TOKEN_MISSING" };
    return { ok: true, accessToken: token };
  } catch {
    return { ok: false, reason: "ACCESS_TOKEN_FAILED" };
  }
}
