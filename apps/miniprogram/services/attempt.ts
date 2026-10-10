import { callOfficialAction } from "./shared-cloud";
import { asRecord, errorInfo } from "./browse";

export {
  answersFromServer,
  applyConflictChoice,
  applyNetworkChange,
  applySaveFail,
  applySaveOk,
  beginSave,
  buildSaveBody,
  conflictChoiceOf,
  decideActiveDraft,
  displaySave,
  emptySaveSession,
  homeDraftView,
  markLocalChange,
  paperStartFlags,
  quizCard,
  replaceStartBody,
  saveLabelOf,
  submitHint,
  type QuizSaveSession,
  type QuizSaveStatus
} from "./attempt-ui";

export async function memberAction(
  action: string,
  data: Record<string, unknown> = {},
  extra: { requestId?: string; idempotencyKey?: string } = {}
): Promise<Record<string, unknown>> {
  const requestId = extra.requestId || `req_mp_${action}_${Date.now()}`;
  try {
    return await callOfficialAction("mw-member", action, data, {
      requestId,
      idempotencyKey: extra.idempotencyKey
    });
  } catch {
    return { ok: false, error: { code: "SERVICE_BUSY", message: "网络失败或服务繁忙", retryable: true } };
  }
}

export function attemptError(res: Record<string, unknown>): {
  code: string;
  reason: string;
  message: string;
  details: Record<string, unknown>;
} {
  const info = errorInfo(res);
  return { ...info, details: asRecord(asRecord(res.error).details) };
}
