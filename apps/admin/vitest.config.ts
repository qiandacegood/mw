import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";
import { mwSharedResolve } from "../../vitest.shared";

export default defineConfig({
  plugins: [vue()],
  resolve: mwSharedResolve(),
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
});
