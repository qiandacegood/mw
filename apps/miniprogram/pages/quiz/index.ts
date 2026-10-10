import { asRecord } from "../../services/browse";
import {
  answersFromServer,
  applyConflictChoice,
  applyNetworkChange,
  applySaveFail,
  applySaveOk,
  attemptError,
  beginSave,
  buildSaveBody,
  conflictChoiceOf,
  displaySave,
  emptySaveSession,
  markLocalChange,
  memberAction,
  quizCard,
  submitHint
} from "../../services/attempt";
import { markLeftoverAttemptId } from "../../services/known-ids";

type QuizItem = {
  ord: number;
  questionId: string;
  type: string;
  stem: { text: string };
  options: Array<{ optionId: string; text: string }>;
};

Page({
  data: {
    state: "loading",
    message: "加载中…",
    attemptId: "",
    paperTitle: "",
    questionCount: 0,
    index: 0,
    revision: 0,
    answeredCount: 0,
    item: {} as QuizItem,
    items: [] as QuizItem[],
    selected: {} as Record<string, string[]>,
    currentOn: {} as Record<string, boolean>,
    card: [] as Array<{ ord: number; done: boolean }>,
    showCard: false,
    saveStatus: "idle",
    saveLabel: "未保存",
    offline: false,
    leftoverMarked: false
  },
  answers: {} as Record<string, string[]>,
  session: emptySaveSession(),
  onLoad(query?: Record<string, string | undefined>) {
    this.setData({ attemptId: String(query?.attemptId || "") });
    const self = this as { onNet?: (res: { isConnected: boolean }) => void };
    self.onNet = (res: { isConnected: boolean }) => {
      this.onNetwork(res.isConnected !== false);
    };
    wx.onNetworkStatusChange(self.onNet);
    void this.reload?.();
  },
  onUnload() {
    const self = this as { onNet?: (res: { isConnected: boolean }) => void };
    if (self.onNet && wx.offNetworkStatusChange) wx.offNetworkStatusChange(self.onNet);
  },
  onNetwork(online: boolean) {
    const offline = online !== true;
    const next = applyNetworkChange(this.session, offline);
    this.session = next.session;
    this.syncSave(offline);
    if (next.flush) void this.flushSave?.(true);
  },
  syncSave(offline?: boolean) {
    const nextOffline = offline ?? this.data.offline === true;
    const shown = displaySave(this.session, nextOffline);
    this.setData({
      offline: nextOffline,
      revision: this.session.revision,
      saveStatus: shown.status,
      saveLabel: shown.label
    });
  },
  async reload() {
    const attemptId = String(this.data.attemptId || "");
    if (!attemptId) {
      this.setData({ state: "error", message: "缺少答题记录。" });
      return;
    }
    this.setData({ state: "loading", message: "加载中…" });
    const got = await memberAction("attempt.get", { attemptId });
    if (!got.ok) {
      const info = attemptError(got);
      this.setData({ state: "error", message: info.message });
      return;
    }
    const draft = asRecord(got.data);
    if (String(draft.state || "") !== "inProgress") {
      this.setData({ state: "error", message: "这份记录已结束，不能继续答题。" });
      return;
    }
    const first = await memberAction("attempt.questionPage", { attemptId, chunkNo: 1 });
    if (!first.ok) {
      const info = attemptError(first);
      this.setData({ state: "error", message: info.message });
      return;
    }
    const pageData = asRecord(first.data);
    const chunkCount = Number(pageData.chunkCount || 1);
    const rawItems = [...(Array.isArray(pageData.items) ? pageData.items : [])];
    for (let chunkNo = 2; chunkNo <= chunkCount; chunkNo += 1) {
      const next = await memberAction("attempt.questionPage", { attemptId, chunkNo });
      if (!next.ok) {
        const info = attemptError(next);
        this.setData({ state: "error", message: info.message });
        return;
      }
      const nextItems = asRecord(next.data).items;
      if (Array.isArray(nextItems)) rawItems.push(...nextItems);
    }
    const items = rawItems.map((row) => {
      const rec = asRecord(row);
      const stem = asRecord(rec.stem);
      return {
        ord: Number(rec.ord || 0),
        questionId: String(rec.questionId || ""),
        type: String(rec.type || "single"),
        stem: { text: String(stem.text || "") },
        options: (Array.isArray(rec.options) ? rec.options : []).map((opt) => {
          const option = asRecord(opt);
          return { optionId: String(option.optionId || ""), text: String(option.text || "") };
        })
      };
    });
    const selected = answersFromServer(draft.answers);
    this.answers = { ...selected };
    this.session = {
      ...emptySaveSession(Number(draft.revision || 0)),
      status: "saved",
      confirmed: true
    };
    this.showIndex(0, items, selected, {
      attemptId,
      paperTitle: String(draft.paperTitle || "练习"),
      questionCount: Number(draft.questionCount || items.length),
      leftoverMarked: false
    });
    this.syncSave(false);
  },
  showIndex(index: number, items: QuizItem[], selected: Record<string, string[]>, extra: Record<string, unknown> = {}) {
    const item = items[index] || items[0];
    const picked = item ? selected[item.questionId] || [] : [];
    const currentOn: Record<string, boolean> = {};
    for (const id of picked) currentOn[id] = true;
    const shown = displaySave(this.session, this.data.offline === true);
    this.setData({
      state: "ok",
      index,
      items,
      item: item || {},
      currentOn,
      card: quizCard(items, selected, index),
      answeredCount: Object.keys(selected).filter((key) => (selected[key] || []).length).length,
      saveStatus: shown.status,
      saveLabel: shown.label,
      revision: this.session.revision,
      ...extra
    });
  },
  pick(event?: { currentTarget?: { dataset?: { id?: string } } }) {
    const optionId = String(event?.currentTarget?.dataset?.id || "");
    const item = this.data.item as QuizItem;
    if (!optionId || !item.questionId) return;
    const current = [...(this.answers[item.questionId] || [])];
    let next: string[];
    if (item.type === "multiple") {
      next = current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId];
    } else {
      next = [optionId];
    }
    if (next.length) this.answers[item.questionId] = next;
    else delete this.answers[item.questionId];
    const offline = this.data.offline === true;
    this.session = markLocalChange(this.session, offline);
    this.showIndex(Number(this.data.index || 0), (this.data.items || []) as QuizItem[], this.answers);
    if (offline) {
      this.syncSave(true);
      return;
    }
    void this.flushSave?.(false);
  },
  retrySave() {
    const shown = displaySave(this.session, this.data.offline === true);
    if (shown.status !== "failed" && shown.status !== "offline") return;
    if (this.data.offline === true) return;
    void this.flushSave?.(true);
  },
  async flushSave(explicit: boolean) {
    const decided = beginSave(this.session);
    this.session = decided.session;
    this.syncSave();
    if (!decided.send) return;
    const body = buildSaveBody(String(this.data.attemptId || ""), this.session.revision, this.answers);
    const requestId = explicit ? `req_mp_save_explicit_${Date.now()}` : `req_mp_save_${Date.now()}`;
    const res = await memberAction("attempt.save", body, { requestId, idempotencyKey: requestId });
    if (!res.ok) {
      const info = attemptError(res);
      this.session = applySaveFail(this.session, info.code, Number(info.details.serverRevision));
      this.syncSave();
      if (this.session.status === "conflict") {
        void this.handleConflict?.(info.details);
        return;
      }
      if (this.session.queued) void this.flushSave?.(false);
      return;
    }
    const data = asRecord(res.data);
    this.session = applySaveOk(this.session, Number(data.revision || this.session.revision));
    this.setData({ answeredCount: Number(data.answeredCount || body.answers.length) });
    this.syncSave();
    if (this.session.queued) void this.flushSave?.(false);
  },
  async handleConflict(details: Record<string, unknown>) {
    const serverRevision = Number(details.serverRevision || this.session.revision);
    this.session = { ...this.session, revision: serverRevision };
    const picked = await new Promise<{ confirm?: boolean; cancel?: boolean }>((resolve) => {
      wx.showModal({
        title: "草稿版本冲突",
        content: "服务端已有更新。用服务器已确认答案，还是保留本页并显式重发？未选择不会覆盖。",
        confirmText: "用服务器",
        cancelText: "用本页",
        success: (res) => resolve(res),
        fail: () => resolve({})
      });
    });
    const next = applyConflictChoice(this.session, conflictChoiceOf(picked));
    this.session = next.session;
    this.syncSave();
    if (next.action === "reload") {
      await this.reload?.();
      return;
    }
    if (next.action === "resend") await this.flushSave?.(true);
  },
  prev() {
    const index = Number(this.data.index || 0);
    if (index <= 0) return;
    this.showIndex(index - 1, (this.data.items || []) as QuizItem[], this.answers);
  },
  next() {
    const index = Number(this.data.index || 0);
    if (index + 1 >= Number(this.data.questionCount || 0)) return;
    this.showIndex(index + 1, (this.data.items || []) as QuizItem[], this.answers);
  },
  toggleCard() {
    this.setData({ showCard: !this.data.showCard });
  },
  jump(event?: { currentTarget?: { dataset?: { ord?: number } } }) {
    const ord = Number(event?.currentTarget?.dataset?.ord || 0);
    if (ord < 1) return;
    this.showIndex(ord - 1, (this.data.items || []) as QuizItem[], this.answers, { showCard: false });
  },
  submitHint() {
    const hint = submitHint();
    wx.showModal({
      title: hint.title,
      content: hint.content,
      showCancel: false
    });
  },
  markLeftover() {
    if (!markLeftoverAttemptId(String(this.data.attemptId || ""))) {
      wx.showToast({ title: "无法记入本轮 leftover", icon: "none" });
      return;
    }
    this.setData({ leftoverMarked: true });
    wx.showToast({ title: "已记入本轮 leftover", icon: "none" });
  }
});
