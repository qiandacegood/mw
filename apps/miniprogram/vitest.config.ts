import { defineConfig } from "vitest/config";
import { mwSharedViteOptions } from "../../vitest.shared";

export default defineConfig({
  ...mwSharedViteOptions(),
  test: {
    environment: "node",
    include: ["**/*.test.ts"]
  }
});
