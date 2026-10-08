import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { UserConfig } from "vitest/config";

export const repoRoot = dirname(fileURLToPath(import.meta.url));

/** TypeScript source. Miniprogram esbuild always starts here. */
export const sharedSrcEntry = join(repoRoot, "packages", "shared", "src", "index.ts");

/** Compiled JS used by Node and Vitest via package exports / alias. */
export const sharedJsEntry = join(repoRoot, "packages", "shared", "dist", "index.js");

export function mwSharedResolve(): NonNullable<UserConfig["resolve"]> {
  return {
    alias: {
      "@mw/shared": sharedJsEntry
    }
  };
}

export function mwSharedViteOptions(): Pick<UserConfig, "resolve"> {
  return {
    resolve: mwSharedResolve()
  };
}
