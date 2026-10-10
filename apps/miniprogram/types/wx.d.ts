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
  setClipboardData(opts: { data: string; success?: () => void }): void;
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
  showIndex: (index: number, items: any[], selected: Record<string, string[]>, extra?: Record<string, unknown>) => void;
  flushSave: (explicit: boolean) => void | Promise<void>;
  handleConflict: (details: Record<string, unknown>) => void | Promise<void>;
  replaceStart: (abandonAttemptId: string, expectedRevision?: number) => void | Promise<void>;
  goRegister: () => void;
}

interface PageOptions {
  data?: Record<string, unknown>;
  answers?: Record<string, string[]>;
  session?: PageInstance["session"];
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
  markLeftover?: (this: PageInstance) => void;
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
  showIndex?: (
    this: PageInstance,
    index: number,
    items: any[],
    selected: Record<string, string[]>,
    extra?: Record<string, unknown>
  ) => void;
  pick?: (this: PageInstance, event?: { currentTarget?: { dataset?: { id?: string } } }) => void;
  retrySave?: (this: PageInstance) => void;
  flushSave?: (this: PageInstance, explicit: boolean) => void | Promise<void>;
  handleConflict?: (this: PageInstance, details: Record<string, unknown>) => void | Promise<void>;
  prev?: (this: PageInstance) => void;
  next?: (this: PageInstance) => void;
  toggleCard?: (this: PageInstance) => void;
  jump?: (this: PageInstance, event?: { currentTarget?: { dataset?: { ord?: number } } }) => void;
  submitHint?: (this: PageInstance) => void;
}

declare function getApp<T = { globalData: Record<string, unknown> }>( ): T;

declare function Page(options: PageOptions): void;
declare function App(options: Record<string, unknown>): void;
declare function require(module: string): unknown;
