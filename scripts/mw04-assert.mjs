export function requireQueryOk(result, label) {
  if (!result || result.code !== 0) {
    throw new Error(`${label} query failed; refusing to treat leftovers as clean`);
  }
  return result;
}

export function commandErrorText(result) {
  return [
    result?.json?.error?.message,
    result?.json?.error?.code,
    result?.stderr,
    result?.stdout
  ]
    .filter(Boolean)
    .join("\n");
}

export function interpretCollectionDrop(result) {
  const text = commandErrorText(result);
  if (/NamespaceNotFound|ns not found/i.test(text)) {
    return { accepted: true, status: "absent" };
  }
  if (
    /FailedToParse|PermissionDenied|AccessDenied|Unauthorized|AuthFailure|InvalidParameter|Forbidden/i.test(
      text
    )
  ) {
    throw new Error("collection drop failed: permission, parameter, or parse error");
  }
  if (result && result.code === 0 && !result.json?.error) {
    return { accepted: true, status: "dropped" };
  }
  throw new Error(`collection drop failed: unknown result (code ${result && result.code})`);
}

export function validationFunctionNames(fnListJson) {
  return (fnListJson?.data?.Functions || [])
    .map((item) => item.FunctionName)
    .filter((name) => typeof name === "string" && name.startsWith("mw-validation-"));
}

export function storageObjectCount(storageJson) {
  if (storageJson?.meta?.total != null) {
    return Number(storageJson.meta.total);
  }
  const data = storageJson?.data;
  if (Array.isArray(data)) {
    return data.length;
  }
  const files = data?.files || data?.Files || data?.fileList || data?.list || [];
  return Array.isArray(files) ? files.length : 0;
}

export function walkCollectionNames(value, out = []) {
  if (!value) {
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => walkCollectionNames(item, out));
    return out;
  }
  if (typeof value === "object") {
    if (typeof value.name === "string") {
      out.push(value.name);
    }
    Object.values(value).forEach((item) => walkCollectionNames(item, out));
  }
  return out;
}

export function listedCollectionNames(listCollectionsJson) {
  return walkCollectionNames(listCollectionsJson?.data?.results || listCollectionsJson);
}

export function leftoverValidationCollections(names) {
  return (names || []).filter((name) => typeof name === "string" && name.startsWith("mw_validation_"));
}

export function assertTeardownEndState(state) {
  const remainingFunctions = state.remainingValidationFunctions;
  const objects = state.storageObjectCount;
  const leftoverCols = leftoverValidationCollections(state.listedCollectionNames);
  if (remainingFunctions !== 0) {
    throw new Error("mw-validation-* functions remain");
  }
  if (objects !== 0) {
    throw new Error("mw-test/validation/ objects remain");
  }
  if (leftoverCols.length > 0) {
    throw new Error("listCollections still contains mw_validation_* names");
  }
  if (state.acl !== "ADMINONLY") {
    throw new Error("storage ACL is not ADMINONLY");
  }
  if (state.enableOverrun !== false) {
    throw new Error("EnableOverrun is not false");
  }
  return true;
}

export function leftoverDecision(state) {
  try {
    assertTeardownEndState(state);
    return { ok: true, exitCode: 0 };
  } catch (error) {
    return { ok: false, exitCode: 1, error: { message: error && error.message } };
  }
}

export function assertUnauthorizedStatuses(results) {
  for (const item of results || []) {
    const status = item && item.http;
    if (status == null) {
      throw new Error("unauthorized URL check did not return HTTP status");
    }
    if (status >= 200 && status < 400) {
      throw new Error("unauthorized URL returned 2xx/3xx");
    }
    if (status !== 403 && status !== 404) {
      throw new Error("unauthorized URL returned a status other than 403 or 404");
    }
  }
  return true;
}

export function describeUnauthenticatedClient(client) {
  const code = client && client.error && client.error.code;
  if (code === "MISSING_CREDENTIALS") {
    return {
      unauthenticatedClientDenied: true,
      collectionRulesVerified: false,
      note: "未登录客户端被拒绝"
    };
  }
  return {
    unauthenticatedClientDenied: client && client.ok === false,
    collectionRulesVerified: false,
    note: "未登录客户端结果不能当作集合规则已经验证"
  };
}
