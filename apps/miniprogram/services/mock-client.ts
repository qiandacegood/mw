import { handlePaperDetail, type ApiResponse, type PaperDetailData } from "@mw/shared";

export function fetchPaperDetail(paperId: string): ApiResponse<PaperDetailData> {
  return handlePaperDetail({
    apiVersion: "1",
    action: "paper.detail",
    requestId: `req_mp_${Date.now()}`,
    data: { paperId }
  });
}
