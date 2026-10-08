import { describe, expect, it } from "vitest";
import { evaluateSharedCloudConfig } from "./shared-cloud-config.js";

describe("evaluateSharedCloudConfig", () => {
  it("reports REQUIRE_FAILED when the config module cannot load", () => {
    expect(evaluateSharedCloudConfig(false)).toEqual({
      ready: false,
      reason: "LOCAL_SHARED_REQUIRE_FAILED"
    });
    expect(
      evaluateSharedCloudConfig(false, {
        resourceEnv: "mw-fixture-env",
        resourceAppId: "wx_fixture_appid"
      })
    ).toEqual({
      ready: false,
      reason: "LOCAL_SHARED_REQUIRE_FAILED"
    });
  });

  it("reports CONFIG_MISSING when the module loaded but fields are incomplete", () => {
    expect(evaluateSharedCloudConfig(true)).toEqual({
      ready: false,
      reason: "LOCAL_SHARED_CONFIG_MISSING"
    });
    expect(evaluateSharedCloudConfig(true, null)).toEqual({
      ready: false,
      reason: "LOCAL_SHARED_CONFIG_MISSING"
    });
    expect(evaluateSharedCloudConfig(true, {})).toEqual({
      ready: false,
      reason: "LOCAL_SHARED_CONFIG_MISSING"
    });
    expect(evaluateSharedCloudConfig(true, { resourceEnv: "mw-fixture-env" })).toEqual({
      ready: false,
      reason: "LOCAL_SHARED_CONFIG_MISSING"
    });
    expect(evaluateSharedCloudConfig(true, { resourceAppId: "wx_fixture_appid" })).toEqual({
      ready: false,
      reason: "LOCAL_SHARED_CONFIG_MISSING"
    });
    expect(
      evaluateSharedCloudConfig(true, {
        resourceEnv: "   ",
        resourceAppId: "wx_fixture_appid"
      })
    ).toEqual({
      ready: false,
      reason: "LOCAL_SHARED_CONFIG_MISSING"
    });
  });

  it("reports CONFIG_PRESENT when resourceEnv and resourceAppId are complete", () => {
    expect(
      evaluateSharedCloudConfig(true, {
        resourceEnv: "mw-fixture-env",
        resourceAppId: "wx_fixture_appid"
      })
    ).toEqual({
      ready: true,
      reason: "LOCAL_SHARED_CONFIG_PRESENT"
    });
  });
});
