export type SharedCloudConfig = {
  resourceEnv?: string;
  resourceAppId?: string;
};

export type SharedCloudReadyReason =
  | "LOCAL_SHARED_REQUIRE_FAILED"
  | "LOCAL_SHARED_CONFIG_MISSING"
  | "LOCAL_SHARED_CONFIG_PRESENT";

export type SharedCloudReady = {
  ready: boolean;
  reason: SharedCloudReadyReason;
};

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function evaluateSharedCloudConfig(
  loaded: boolean,
  config?: SharedCloudConfig | null
): SharedCloudReady {
  if (!loaded) {
    return { ready: false, reason: "LOCAL_SHARED_REQUIRE_FAILED" };
  }
  if (!hasText(config?.resourceEnv) || !hasText(config?.resourceAppId)) {
    return { ready: false, reason: "LOCAL_SHARED_CONFIG_MISSING" };
  }
  return { ready: true, reason: "LOCAL_SHARED_CONFIG_PRESENT" };
}
