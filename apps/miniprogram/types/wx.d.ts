interface WxToast {
  title: string;
  icon?: "success" | "error" | "none";
}

declare const wx: {
  showToast(opts: WxToast): void;
};

interface PageInstance {
  data: Record<string, unknown>;
  setData(data: Record<string, unknown>): void;
  loadPaper?: () => void;
}

interface PageOptions {
  data?: Record<string, unknown>;
  onLoad?: (this: PageInstance) => void;
  loadPaper?: (this: PageInstance) => void;
}

declare function Page(options: PageOptions): void;
declare function App(options: Record<string, unknown>): void;
