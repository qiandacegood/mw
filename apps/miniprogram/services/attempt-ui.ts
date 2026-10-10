function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export type QuizSaveStatus = "idle" | "saving" | "saved" | "failed" | "conflict" | "offline";

export type QuizSaveSession = {
  status: QuizSaveStatus;
  confirmed: boolean;
  pending: boolean;
  saving: boolean;
  queued: boolean;
  revision: number;
  conflictOpen: boolean;
};

export function emptySaveSession(revision = 0): QuizSaveSession {
  return {
    status: "idle",
    confirmed: false,
    pending: false,
    saving: false,
    queued: false,
    revision,
    conflictOpen: false
  };
}

export function saveLabelOf(status: string): string {
  if (status === "saving") return "保存中";
  if (status === "saved") return "已保存";
  if (status === "conflict") return "版本冲突";
  if (status === "failed") return "保存失败";
  if (status === "offline") return "尚未同步";
  return "未保存";
}

export function displaySave(session: QuizSaveSession, offline: boolean): { status: QuizSaveStatus; label: string } {
  if (offline && (session.pending || session.queued || !session.confirmed)) {
    return { status: "offline", label: "尚未同步" };
  }
  if (session.status === "saved" && session.confirmed !== true) {
    return { status: "failed", label: "保存失败" };
  }
  return { status: session.status, label: saveLabelOf(session.status) };
}

export function markLocalChange(session: QuizSaveSession, offline: boolean): QuizSaveSession {
  return {
    ...session,
    confirmed: false,
    pending: true,
    status: offline ? "offline" : session.conflictOpen ? "conflict" : "saving"
  };
}

export function beginSave(session: QuizSaveSession): { session: QuizSaveSession; send: boolean } {
  if (session.conflictOpen) {
    return { session: { ...session, pending: true, queued: true, confirmed: false }, send: false };
  }
  if (session.saving) {
    return { session: { ...session, pending: true, queued: true, confirmed: false, status: "saving" }, send: false };
  }
  return {
    session: { ...session, saving: true, queued: false, pending: true, confirmed: false, status: "saving" },
    send: true
  };
}

export function applySaveOk(session: QuizSaveSession, revision: number): QuizSaveSession {
  return {
    ...session,
    saving: false,
    revision,
    confirmed: !session.queued,
    pending: session.queued,
    status: session.queued ? "saving" : "saved"
  };
}

export function applySaveFail(
  session: QuizSaveSession,
  code: string,
  serverRevision?: number
): QuizSaveSession {
  if (code === "DRAFT_CONFLICT") {
    return {
      ...session,
      saving: false,
      queued: false,
      confirmed: false,
      pending: true,
      conflictOpen: true,
      status: "conflict",
      revision: Number.isFinite(serverRevision) ? Number(serverRevision) : session.revision
    };
  }
  return {
    ...session,
    saving: false,
    confirmed: false,
    pending: true,
    status: "failed"
  };
}

export function applyConflictChoice(
  session: QuizSaveSession,
  choice: "server" | "page" | "none"
): { session: QuizSaveSession; action: "reload" | "resend" | "wait" } {
  if (choice === "none") {
    return { session: { ...session, conflictOpen: true, status: "conflict", queued: false }, action: "wait" };
  }
  if (choice === "server") {
    return { session: { ...session, conflictOpen: false, queued: false }, action: "reload" };
  }
  return {
    session: {
      ...session,
      conflictOpen: false,
      queued: false,
      saving: false,
      confirmed: false,
      pending: true,
      status: "saving"
    },
    action: "resend"
  };
}

export function applyNetworkChange(
  session: QuizSaveSession,
  offline: boolean
): { session: QuizSaveSession; flush: boolean } {
  if (offline) {
    if (session.pending || session.queued || session.saving || !session.confirmed) {
      return { session: { ...session, status: "offline" }, flush: false };
    }
    return { session, flush: false };
  }
  const flush = (session.pending || session.queued || session.status === "failed") && !session.conflictOpen;
  return { session, flush };
}

export function buildSaveBody(
  attemptId: string,
  expectedRevision: number,
  selected: Record<string, string[]>
): { attemptId: string; expectedRevision: number; answers: Array<{ questionId: string; optionIds: string[] }> } {
  return {
    attemptId,
    expectedRevision,
    answers: Object.keys(selected)
      .filter((questionId) => (selected[questionId] || []).length)
      .sort((left, right) => left.localeCompare(right))
      .map((questionId) => ({ questionId, optionIds: [...(selected[questionId] || [])] }))
  };
}

export function paperStartFlags(guest: boolean, access: string): {
  guest: boolean;
  vipRequired: boolean;
  canShowStart: boolean;
  startHint: string;
} {
  const vipRequired = !guest && access === "vip";
  const canShowStart = !guest && access === "free";
  return {
    guest,
    vipRequired,
    canShowStart,
    startHint: canShowStart ? "开始将创建一份进行中的答题草稿。" : ""
  };
}

export function decideActiveDraft(choice: { confirm?: boolean; cancel?: boolean }): "continue" | "replace" | "none" {
  if (choice.confirm === true) return "continue";
  if (choice.cancel === true) return "replace";
  return "none";
}

export function replaceStartBody(paperId: string, abandonAttemptId: string, expectedRevision: number) {
  return { paperId, abandonAttemptId, expectedRevision, confirmed: true as const };
}

export function homeDraftView(guest: boolean, draft: Record<string, unknown>): {
  hasDraft: boolean;
  draftTitle: string;
  draftAttemptId: string;
} {
  const draftAttemptId = guest ? "" : String(draft.attemptId || "");
  return {
    hasDraft: Boolean(draftAttemptId),
    draftTitle: String(draft.paperTitle || "未完成的试卷"),
    draftAttemptId
  };
}

export function answersFromServer(raw: unknown): Record<string, string[]> {
  const selected: Record<string, string[]> = {};
  if (!Array.isArray(raw)) return selected;
  for (const row of raw) {
    const rec = asRecord(row);
    const qid = String(rec.questionId || "");
    if (!qid) continue;
    selected[qid] = Array.isArray(rec.optionIds) ? rec.optionIds.map((id) => String(id)) : [];
  }
  return selected;
}

export function quizCard(
  items: Array<{ questionId: string }>,
  selected: Record<string, string[]>,
  currentIndex: number
): Array<{ ord: number; done: boolean; current: boolean }> {
  return items.map((row, index) => ({
    ord: index + 1,
    done: Boolean((selected[row.questionId] || []).length),
    current: index === currentIndex
  }));
}

export function submitHint(): { title: string; content: string; action: "none" } {
  return {
    title: "尚未接通交卷",
    content: "MW15 未接通，不能交卷、评分或查看解析。",
    action: "none"
  };
}

export function conflictChoiceOf(choice: { confirm?: boolean; cancel?: boolean }): "server" | "page" | "none" {
  if (choice.confirm === true) return "server";
  if (choice.cancel === true) return "page";
  return "none";
}
