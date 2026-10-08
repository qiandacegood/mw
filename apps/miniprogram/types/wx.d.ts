interface WxToast {
  title: string;
  icon?: "success" | "error" | "none";
}

declare const wx: {
  showToast(opts: WxToast): void;
  navigateTo(opts: { url: string }): void;
  cloud: {
    Cloud: new (opts: { resourceAppid: string; resourceEnv: string }) => {
      init: () => Promise<void>;
      callFunction: (opts: { name: string; data: unknown }) => Promise<{ result?: Record<string, unknown> }>;
    };
  };
};

interface PageInstance {
  data: Record<string, unknown>;
  setData(data: Record<string, unknown>): void;
  loadPaper?: () => void;
  runPublic?: () => Promise<void>;
  runMember?: () => Promise<void>;
  reload?: () => void | Promise<void>;
}

interface PageOptions {
  data?: Record<string, unknown>;
  onLoad?: (this: PageInstance) => void;
  onShow?: (this: PageInstance) => void;
  loadPaper?: (this: PageInstance) => void;
  runPublic?: (this: PageInstance) => Promise<void>;
  runMember?: (this: PageInstance) => Promise<void>;
  goMe?: (this: PageInstance) => void;
  goRegister?: (this: PageInstance) => void;
  goMw08?: (this: PageInstance) => void;
  goProfile?: (this: PageInstance) => void;
  reload?: (this: PageInstance) => void | Promise<void>;
  onAgree?: (this: PageInstance, event: { detail?: { value?: string[] } }) => void;
  onNickname?: (this: PageInstance, event: { detail?: { value?: string } }) => void;
  onAvatar?: (this: PageInstance, event: { currentTarget?: { dataset?: { key?: string } } }) => void;
  submit?: (this: PageInstance) => void | Promise<void>;
  save?: (this: PageInstance) => void | Promise<void>;
  runSuite?: (this: PageInstance) => void | Promise<void>;
}

declare function Page(options: PageOptions): void;
declare function App(options: Record<string, unknown>): void;
declare function require(module: string): unknown;
