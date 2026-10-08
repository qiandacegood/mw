interface WxToast {
  title: string;
  icon?: "success" | "error" | "none";
}

declare const wx: {
  showToast(opts: WxToast): void;
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
}

interface PageOptions {
  data?: Record<string, unknown>;
  onLoad?: (this: PageInstance) => void;
  loadPaper?: (this: PageInstance) => void;
  runPublic?: (this: PageInstance) => Promise<void>;
  runMember?: (this: PageInstance) => Promise<void>;
}

declare function Page(options: PageOptions): void;
declare function App(options: Record<string, unknown>): void;
declare function require(module: string): unknown;
