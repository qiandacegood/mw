import { handlePaperDetail, type ApiResponse } from "@mw/shared";

export function handleIsolatedAction(input: unknown): ApiResponse<unknown> {
  return handlePaperDetail(input);
}
