import { describe, expect, it } from "vitest";
import {
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
  submitHint
} from "./attempt-ui.js";

describe("paper start flags", () => {
  it("sends guests to register and never says MW14 is unwired", () => {
    const guest = paperStartFlags(true, "free");
    expect(guest.canShowStart).toBe(false);
    expect(guest.vipRequired).toBe(false);
    expect(guest.startHint).toBe("");
    expect(JSON.stringify(guest)).not.toContain("MW14 未接通");
  });

  it("lets a free member start a free paper", () => {
    const flags = paperStartFlags(false, "free");
    expect(flags.canShowStart).toBe(true);
    expect(flags.vipRequired).toBe(false);
    expect(flags.startHint).toContain("答题草稿");
    expect(flags.startHint).not.toContain("MW14 未接通");
  });

  it("shows VIP_REQUIRED and hides start for a free member on a VIP paper", () => {
    const flags = paperStartFlags(false, "vip");
    expect(flags.canShowStart).toBe(false);
    expect(flags.vipRequired).toBe(true);
  });
});

describe("active draft confirmation", () => {
  it("does not drop a draft unless the user explicitly continues or replaces", () => {
    expect(decideActiveDraft({})).toBe("none");
    expect(decideActiveDraft({ confirm: false, cancel: false })).toBe("none");
    expect(decideActiveDraft({ confirm: true })).toBe("continue");
    expect(decideActiveDraft({ cancel: true })).toBe("replace");
    expect(replaceStartBody("p2", "a1", 3)).toEqual({
      paperId: "p2",
      abandonAttemptId: "a1",
      expectedRevision: 3,
      confirmed: true
    });
  });
});

describe("quiz save session", () => {
  it("sends the full current answers with expectedRevision and keeps saves serial", () => {
    const selected = { q2: ["B"], q1: ["A"] };
    expect(buildSaveBody("att_1", 4, selected)).toEqual({
      attemptId: "att_1",
      expectedRevision: 4,
      answers: [
        { questionId: "q1", optionIds: ["A"] },
        { questionId: "q2", optionIds: ["B"] }
      ]
    });
    const first = beginSave(emptySaveSession(0));
    expect(first.send).toBe(true);
    const second = beginSave(first.session);
    expect(second.send).toBe(false);
    expect(second.session.queued).toBe(true);
    const afterOk = applySaveOk(second.session, 1);
    expect(afterOk.confirmed).toBe(false);
    expect(afterOk.status).toBe("saving");
    expect(displaySave(afterOk, false).label).toBe("保存中");
  });

  it("shows 已保存 only after the server confirms the latest set", () => {
    const saving = beginSave(markLocalChange(emptySaveSession(0), false)).session;
    expect(displaySave(saving, false)).toEqual({ status: "saving", label: "保存中" });
    const saved = applySaveOk(saving, 1);
    expect(saved.confirmed).toBe(true);
    expect(displaySave(saved, false)).toEqual({ status: "saved", label: "已保存" });
    const fakeSaved = { ...saved, confirmed: false, status: "saved" as const };
    expect(displaySave(fakeSaved, false).label).toBe("保存失败");
  });

  it("does not show 已保存 for offline edits and only flushes after reconnect", () => {
    const offline = markLocalChange(emptySaveSession(1), true);
    expect(displaySave(offline, true)).toEqual({ status: "offline", label: "尚未同步" });
    expect(offline.confirmed).toBe(false);
    const stillOffline = applyNetworkChange(offline, true);
    expect(stillOffline.flush).toBe(false);
    expect(displaySave(stillOffline.session, true).label).toBe("尚未同步");
    const back = applyNetworkChange(offline, false);
    expect(back.flush).toBe(true);
    const alreadySaved = applySaveOk(beginSave(emptySaveSession(0)).session, 2);
    expect(applyNetworkChange(alreadySaved, true).flush).toBe(false);
    expect(displaySave(alreadySaved, true).label).toBe("已保存");
  });

  it("waits for an explicit conflict choice before resending", () => {
    const conflicted = applySaveFail(beginSave(emptySaveSession(1)).session, "DRAFT_CONFLICT", 5);
    expect(conflicted.status).toBe("conflict");
    expect(conflicted.conflictOpen).toBe(true);
    expect(conflicted.revision).toBe(5);
    expect(beginSave(conflicted).send).toBe(false);
    expect(applyConflictChoice(conflicted, "none").action).toBe("wait");
    expect(applyConflictChoice(conflicted, "server").action).toBe("reload");
    const page = applyConflictChoice(conflicted, "page");
    expect(page.action).toBe("resend");
    expect(page.session.conflictOpen).toBe(false);
    expect(conflictChoiceOf({ confirm: true })).toBe("server");
    expect(conflictChoiceOf({ cancel: true })).toBe("page");
    expect(conflictChoiceOf({})).toBe("none");
  });

  it("marks answered and unanswered cells on the answer card", () => {
    const card = quizCard(
      [{ questionId: "q1" }, { questionId: "q2" }, { questionId: "q3" }],
      { q1: ["A"] },
      1
    );
    expect(card).toEqual([
      { ord: 1, done: true, current: false },
      { ord: 2, done: false, current: true },
      { ord: 3, done: false, current: false }
    ]);
  });
});

describe("restore, continue, and submit stay on the server path", () => {
  it("restores only server-confirmed answers and surfaces a login draft", () => {
    expect(answersFromServer([{ questionId: "q1", optionIds: ["A"] }, { questionId: "" }])).toEqual({
      q1: ["A"]
    });
    expect(homeDraftView(true, { attemptId: "a1", paperTitle: "旧稿" }).hasDraft).toBe(false);
    expect(homeDraftView(false, { attemptId: "a1", paperTitle: "逻辑入门" })).toEqual({
      hasDraft: true,
      draftTitle: "逻辑入门",
      draftAttemptId: "a1"
    });
    expect(homeDraftView(false, { attemptId: null }).hasDraft).toBe(false);
  });

  it("explains MW15 and never names attempt.submit", () => {
    const hint = submitHint();
    expect(hint.action).toBe("none");
    expect(hint.content).toContain("MW15 未接通");
    expect(JSON.stringify(hint)).not.toContain("attempt.submit");
  });
});
