import { handleOfficial } from "../official.js";
import type { OfficialContext } from "../official.js";

export function handleMemberEntry(ctx: Omit<OfficialContext, "entry">) {
  return handleOfficial({ ...ctx, entry: "mw-member" });
}
