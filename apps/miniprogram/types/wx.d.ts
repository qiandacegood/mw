interface WxToast {
  title: string;
  icon?: "success" | "error" | "none";
}

interface WxModalResult {
  confirm: boolean;
  cancel: boolean;
}

declare const wx: {
  showToast(opts: WxToast): void;
  showModal(opts: {
    title: string;
    content: string;
    showCancel?: boolean;
    confirmText?: string;
    cancelText?: string;
    success?: (res: WxModalResult) => void;
    fail?: () => void;
  }): void;
  navigateTo(opts: { url: string }): void;
  switchTab(opts: { url: string }): void;
  stopPullDownRefresh(): void;
  setClipboardData(opts: { data: string; success?: () => void }): void;
  login(opts: { success?: (res: { code?: string }) => void; fail?: () => void }): void;
  getSystemInfoSync(): { platform?: string; osName?: string; system?: string; version?: string };
  requestVirtualPayment?(opts: Record<string, unknown>): void;
  onNetworkStatusChange(cb: (res: { isConnected: boolean }) => void): void;
  offNetworkStatusChange?(cb: (res: { isConnected: boolean }) => void): void;
  cloud: {
    Cloud: new (opts: { resourceAppid: string; resourceEnv: string }) => {
      init: () => Promise<void>;
      callFunction: (opts: { name: string; data: unknown }) => Promise<{ result?: Record<string, unknown> }>;
    };
  };
};

interface PageInstance {
  data: Record<string, unknown> & {
    index?: number;
    questionCount?: number;
    attemptId?: string;
    paperId?: string;
    offline?: boolean;
    item?: { questionId?: string; type?: string };
    items?: unknown[];
    draftAttemptId?: string;
    lastOrderId?: string;
    plans?: unknown[];
  };
  setData(data: Record<string, unknown>): void;
  loadPaper?: () => void;
  runPublic?: () => Promise<void>;
  runMember?: () => Promise<void>;
  reload?: (reset?: boolean) => void | Promise<void>;
  loadTree?: (preferredId?: string) => void | Promise<void>;
  applyNode?: (nodes: unknown, currentId?: string) => void;
  filters?: () => Record<string, unknown>;
  answers: Record<string, string[]>;
  session: {
    status: "idle" | "saving" | "saved" | "failed" | "conflict" | "offline";
    confirmed: boolean;
    pending: boolean;
    saving: boolean;
    queued: boolean;
    revision: number;
    conflictOpen: boolean;
  };
  onNetwork: (online: boolean) => void;
  syncSave: (offline?: boolean) => void;
  syncAnswered: (answeredCount: number) => void;
  submitting: boolean;
  onCardVisibleChange: (event?: { detail?: { visible?: boolean } }) => void;
  toggleTestPanel: () => void;
  showIndex: (index: number, items: any[], selected: Record<string, string[]>, extra?: Record<string, unknown>) => void;
  flushSave: (explicit: boolean) => void | Promise<void>;
  handleConflict: (details: Record<string, unknown>) => void | Promise<void>;
  replaceStart: (abandonAttemptId: string, expectedRevision?: number) => void | Promise<void>;
  goRegister: () => void;
  goResult?: (event?: { currentTarget?: { dataset?: { id?: string } } }) => void;
  goHistory?: () => void;
  goVip?: () => void;
  goOrders?: () => void;
  goRanking?: () => void;
  goSupport?: () => void;
  goFeedback?: (event?: { currentTarget?: { dataset?: { question?: string; version?: string; paper?: string } } }) => void;
  goDeletion?: () => void;
  copyMemberId?: () => void;
  pickType?: (event?: { currentTarget?: { dataset?: { type?: string } } }) => void;
  onPaper?: (event?: { detail?: { value?: string } }) => void;
  onQuestion?: (event?: { detail?: { value?: string } }) => void;
  onVersion?: (event?: { detail?: { value?: string } }) => void;
  onText?: (event?: { detail?: { value?: string } }) => void;
  goAnalysis?: (event?: { currentTarget?: { dataset?: { id?: string } } }) => void;
  submitAttempt?: (confirmUnanswered?: boolean) => void | Promise<void>;
  submitPaper?: () => void | Promise<void>;
  toggleWrong?: () => void;
  fetchPage?: (cursor?: string) => void | Promise<void>;
  /** MW17 排行榜页：四榜切换、类目选择、参与开关与分页。 */
  onPullDownRefresh?: (this: PageInstance) => void;
  loadCategories?: (this: PageInstance) => void | Promise<void>;
  applyList?: (this: PageInstance, data: Record<string, unknown>, append: boolean) => void;
  loadMore?: (this: PageInstance) => void | Promise<void>;
  retry?: (this: PageInstance) => void;
  onTabChange?: (this: PageInstance, event?: { detail?: { value?: unknown } }) => void;
  openCategoryPicker?: (this: PageInstance) => void;
  closeCategoryPicker?: (this: PageInstance) => void;
  onPickerVisibleChange?: (this: PageInstance, event?: { detail?: { visible?: boolean } }) => void;
  chooseCategory?: (this: PageInstance, event?: { currentTarget?: { dataset?: { id?: string; name?: string } } }) => void;
  openSettings?: (this: PageInstance) => void;
  closeSettings?: (this: PageInstance) => void;
  onSettingsVisibleChange?: (this: PageInstance, event?: { detail?: { visible?: boolean } }) => void;
  toggleRanking?: (this: PageInstance) => void | Promise<void>;
  buy?: (event?: { currentTarget?: { dataset?: { id?: string; version?: string } } }) => void | Promise<void>;
  pay?: () => void | Promise<void>;
  fakeSuccess?: () => void | Promise<void>;
  refresh?: (event?: { currentTarget?: { dataset?: { id?: string } } }) => void | Promise<void>;
  close?: (event?: { currentTarget?: { dataset?: { id?: string } } }) => void | Promise<void>;
  copyLeftover?: () => void;
}

interface PageOptions {
  data?: Record<string, unknown>;
  answers?: Record<string, string[]>;
  session?: PageInstance["session"];
  submitting?: boolean;
  onLoad?: (this: PageInstance, query?: Record<string, string | undefined>) => void;
  onShow?: (this: PageInstance) => void;
  onUnload?: (this: PageInstance) => void;
  loadPaper?: (this: PageInstance) => void;
  runPublic?: (this: PageInstance) => Promise<void>;
  runMember?: (this: PageInstance) => Promise<void>;
  goMe?: (this: PageInstance) => void;
  goRegister?: (this: PageInstance) => void;
  goMw08?: (this: PageInstance) => void;
  goProfile?: (this: PageInstance) => void;
  goCategory?: (this: PageInstance, event?: { currentTarget?: { dataset?: { id?: string } } }) => void;
  goPaper?: (this: PageInstance, event?: { currentTarget?: { dataset?: { id?: string } } }) => void;
  goDraft?: (this: PageInstance) => void;
  openLookup?: (this: PageInstance) => void;
  openList?: (this: PageInstance) => void;
  openPaper?: (this: PageInstance, event?: { currentTarget?: { dataset?: { id?: string } } }) => void;
  enterChild?: (this: PageInstance, event?: { currentTarget?: { dataset?: { id?: string } } }) => void;
  selectCrumb?: (this: PageInstance, event?: { currentTarget?: { dataset?: { id?: string } } }) => void;
  setDifficulty?: (this: PageInstance, event?: { currentTarget?: { dataset?: { value?: string } } }) => void;
  setAccess?: (this: PageInstance, event?: { currentTarget?: { dataset?: { value?: string } } }) => void;
  setProgress?: (this: PageInstance, event?: { currentTarget?: { dataset?: { value?: string } } }) => void;
  setSort?: (this: PageInstance, event?: { currentTarget?: { dataset?: { value?: string } } }) => void;
  clearFilters?: (this: PageInstance) => void;
  more?: (this: PageInstance) => void;
  startFree?: (this: PageInstance) => void | Promise<void>;
  replaceStart?: (this: PageInstance, abandonAttemptId: string, expectedRevision?: number) => void | Promise<void>;
  markLeftover?: (this: PageInstance, event?: { currentTarget?: { dataset?: { id?: string } } }) => void;
  reload?: (this: PageInstance, reset?: boolean) => void | Promise<void>;
  loadTree?: (this: PageInstance, preferredId?: string) => void | Promise<void>;
  applyNode?: (this: PageInstance, nodes: unknown, currentId?: string) => void;
  filters?: (this: PageInstance) => Record<string, unknown>;
  onLookupInput?: (this: PageInstance, event: { detail?: { value?: string } }) => void;
  onAgree?: (this: PageInstance, event: { detail?: { value?: string[] } }) => void;
  onNickname?: (this: PageInstance, event: { detail?: { value?: string } }) => void;
  onAvatar?: (this: PageInstance, event: { currentTarget?: { dataset?: { key?: string } } }) => void;
  submit?: (this: PageInstance) => void | Promise<void>;
  save?: (this: PageInstance) => void | Promise<void>;
  runSuite?: (this: PageInstance) => void | Promise<void>;
  copyKnownIds?: (this: PageInstance) => void;
  onNetwork?: (this: PageInstance, online: boolean) => void;
  syncSave?: (this: PageInstance, offline?: boolean) => void;
  syncAnswered?: (this: PageInstance, answeredCount: number) => void;
  showIndex?: (
    this: PageInstance,
    index: number,
    items: any[],
    selected: Record<string, string[]>,
    extra?: Record<string, unknown>
  ) => void;
  /** MW-UI01：TDesign radio/checkbox 分组通过 change 事件 detail.value 回传选中值 */
  pick?: (this: PageInstance, event?: { detail?: { value?: unknown } }) => void;
  retrySave?: (this: PageInstance) => void;
  flushSave?: (this: PageInstance, explicit: boolean) => void | Promise<void>;
  handleConflict?: (this: PageInstance, details: Record<string, unknown>) => void | Promise<void>;
  prev?: (this: PageInstance) => void;
  next?: (this: PageInstance) => void;
  toggleCard?: (this: PageInstance) => void;
  onCardVisibleChange?: (this: PageInstance, event?: { detail?: { visible?: boolean } }) => void;
  toggleTestPanel?: (this: PageInstance) => void;
  jump?: (this: PageInstance, event?: { currentTarget?: { dataset?: { ord?: number } } }) => void;
  submitHint?: (this: PageInstance) => void;
  goResult?: (this: PageInstance, event?: { currentTarget?: { dataset?: { id?: string } } }) => void;
  goHistory?: (this: PageInstance) => void;
  goAnalysis?: (this: PageInstance, event?: { currentTarget?: { dataset?: { id?: string } } }) => void;
  submitAttempt?: (this: PageInstance, confirmUnanswered?: boolean) => void | Promise<void>;
  submitPaper?: (this: PageInstance) => void | Promise<void>;
  toggleWrong?: (this: PageInstance) => void;
  fetchPage?: (this: PageInstance, cursor?: string) => void | Promise<void>;
  /** MW17 排行榜页：四榜切换、类目选择、参与开关与分页。 */
  onPullDownRefresh?: (this: PageInstance) => void;
  loadCategories?: (this: PageInstance) => void | Promise<void>;
  applyList?: (this: PageInstance, data: Record<string, unknown>, append: boolean) => void;
  loadMore?: (this: PageInstance) => void | Promise<void>;
  retry?: (this: PageInstance) => void;
  onTabChange?: (this: PageInstance, event?: { detail?: { value?: unknown } }) => void;
  openCategoryPicker?: (this: PageInstance) => void;
  closeCategoryPicker?: (this: PageInstance) => void;
  onPickerVisibleChange?: (this: PageInstance, event?: { detail?: { visible?: boolean } }) => void;
  chooseCategory?: (
    this: PageInstance,
    event?: { currentTarget?: { dataset?: { id?: string; name?: string } } }
  ) => void;
  openSettings?: (this: PageInstance) => void;
  closeSettings?: (this: PageInstance) => void;
  onSettingsVisibleChange?: (this: PageInstance, event?: { detail?: { visible?: boolean } }) => void;
  toggleRanking?: (this: PageInstance) => void | Promise<void>;
  goVip?: (this: PageInstance) => void;
  goOrders?: (this: PageInstance) => void;
  goRanking?: (this: PageInstance) => void;
  goSupport?: (this: PageInstance) => void;
  goPolicies?: (this: PageInstance) => void;
  onAck?: (this: PageInstance, event: { detail?: { value?: string[] } }) => void;
  reauth?: (this: PageInstance) => void | Promise<void>;
  goFeedback?: (
    this: PageInstance,
    event?: { currentTarget?: { dataset?: { question?: string; version?: string; paper?: string } } }
  ) => void;
  goDeletion?: (this: PageInstance) => void;
  copyMemberId?: (this: PageInstance) => void;
  pickType?: (this: PageInstance, event?: { currentTarget?: { dataset?: { type?: string } } }) => void;
  onPaper?: (this: PageInstance, event?: { detail?: { value?: string } }) => void;
  onQuestion?: (this: PageInstance, event?: { detail?: { value?: string } }) => void;
  onVersion?: (this: PageInstance, event?: { detail?: { value?: string } }) => void;
  onText?: (this: PageInstance, event?: { detail?: { value?: string } }) => void;
  buy?: (this: PageInstance, event?: { currentTarget?: { dataset?: { id?: string; version?: string } } }) => void | Promise<void>;
  pay?: (this: PageInstance) => void | Promise<void>;
  fakeSuccess?: (this: PageInstance) => void | Promise<void>;
  refresh?: (this: PageInstance, event?: { currentTarget?: { dataset?: { id?: string } } }) => void | Promise<void>;
  close?: (this: PageInstance, event?: { currentTarget?: { dataset?: { id?: string } } }) => void | Promise<void>;
  onReason?: (this: PageInstance, event?: { detail?: { value?: string } }) => void;
  requestRefund?: (this: PageInstance, event?: { currentTarget?: { dataset?: { id?: string } } }) => void | Promise<void>;
  copyLeftover?: (this: PageInstance) => void;
}

declare function getApp<T = { globalData: Record<string, unknown> }>( ): T;

declare function Page(options: PageOptions): void;
declare function App(options: Record<string, unknown>): void;
declare function require(module: string): unknown;
