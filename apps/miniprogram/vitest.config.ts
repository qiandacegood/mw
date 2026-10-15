import { defineConfig } from "vitest/config";
import { mwSharedResolve } from "../../vitest.shared";

export default defineConfig({
  resolve: {
    ...mwSharedResolve(),
    /**
     * 小程序源码会被 scripts/build-miniprogram.mjs 就地编译成同名 .js（已 gitignore）。
     * Vite 默认扩展名顺序里 .js 优先于 .ts，测试会静默跑到上一次构建的旧产物，
     * 于是"改了 TS 但测试还按旧行为通过/失败"。这里显式让 .ts 优先。
     */
    extensions: [".ts", ".mts", ".js", ".mjs", ".jsx", ".tsx", ".json"]
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"]
  }
});
