import { notWired } from "../cloudbase-guard.js";

export function main(): never {
  return notWired("mw-admin");
}
