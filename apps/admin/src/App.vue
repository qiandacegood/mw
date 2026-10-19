<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  opsScanTruncatedNotice,
  paperIdForSourceKey,
  paperTemplateCsv,
  planDocId,
  questionIdForSourceKey,
  questionTemplateCsv
} from "@mw/shared";
import {
  callAdminCategory,
  callAdminCategoryChange,
  callAdminCorrection,
  callAdminGrowth,
  callAdminVip,
  callAdminPlan,
  callAdminOrder,
  callAdminRefund,
  callAdminJob,
  callAdminQuestion,
  callAdminPaper,
  callAdminImport,
  callAdminRanking,
  callAdminMember,
  callAdminFeedback,
  callAdminOps,
  completeAdminUpload,
  createAdminApp,
  loginAndReadAdmin,
  signOutAdmin,
  type AdminCallResult,
  type AdminGrowthAction,
  type AdminRankingAction,
  type AdminMemberAction,
  type AdminFeedbackAction,
  type AdminOpsAction,
  type AdminVipAction,
  type AdminPlanAction,
  type AdminOrderAction,
  type AdminRefundAction,
  type AdminSession
} from "./cloudbase-web";

type CategoryNode = {
  id: string;
  categoryId?: string;
  parentId: string | null;
  depth: number;
  name: string;
  sort: number;
  enabled: boolean;
  effectiveEnabled?: boolean;
  revision?: number;
};

type QuestionListRow = {
  questionId: string;
  categoryId: string;
  type: string;
  stem?: { text?: string };
  status?: string;
  difficulty?: string;
  defaultPoints?: number;
  revision?: number;
};

type PaperListRow = {
  paperId: string;
  title: string;
  summary?: string;
  access?: string;
  difficulty?: string;
  questionCount?: number;
  maxScore?: number;
  categoryId: string;
  status?: string;
  revision?: number;
  publishedAt?: string | null;
};

const username = ref("");
const password = ref("");
const status = ref("尚未登录。请在本页输入用户名和密码，不要把密码发给对话。");
const session = ref<AdminSession | null>(null);
const busy = ref(false);
const jobId = ref(new URLSearchParams(window.location.search).get("jobId") || "");
const resumeReason = ref("human resume after needsReview");
const jobResult = ref("");
const treeVersion = ref(0);
const nodes = ref<CategoryNode[]>([]);
const selectedId = ref("");
const parentId = ref("");
const nodeName = ref("");
const nodeSort = ref(10);
const evidence = ref("");
const lastError = ref("");
const changeTargetParentId = ref("");
const changeReason = ref("MW18 专用测试子树迁移");
const changePreviewId = ref("");
const changePlanHash = ref("");
const changeJobId = ref("");
const changeStatusText = ref("先预览再确认。commit 只绑定服务端预览，不信任本页自报计划。");
const changeView = ref("");
const qType = ref<"single" | "multiple" | "trueFalse">("single");
const qStem = ref("虚构题干：条件甲成立时应选哪一项？");
const qOptions = ref("选项甲\n选项乙\n选项丙");
const qAnswers = ref("A");
const qAnalysis = ref("因为条件甲成立，所以选甲。多选可写漏选或误选说明。");
const qPoints = ref(5);
const qDifficulty = ref("beginner");
const qCategoryId = ref("");
const qRevision = ref(0);
const qQuestionId = ref("");
const qVersionId = ref("");
const qStatus = ref("");
const qComplete = ref(true);
const qMissing = ref("");
const promptAssetId = ref("");
const analysisAssetId = ref("");
const previewUrl = ref("");
const previewKind = ref("");
const previewOpen = ref(false);
const previewFailed = ref(false);
const qEvidence = ref("");
const lastTicketOnce = ref(false);
const knownQuestions = ref<string[]>([]);
const knownVersions = ref<string[]>([]);
const knownAssets = ref<string[]>([]);
const pTitle = ref("MW11虚构练习卷");
const pSummary = ref("虚构简介，只用于组卷发布核验。");
const pGoal = ref("练习条件判断");
const pAccess = ref<"free" | "vip">("free");
const pDifficulty = ref("beginner");
const pSort = ref(10);
const pRevision = ref(0);
const pPaperId = ref("");
const pStatus = ref("");
const pMaxScore = ref(0);
const pQuestionCount = ref(0);
const pActiveVersionId = ref("");
const pWithdrawReason = ref("答案错误，紧急撤回未提交交卷");
const pFromVersionId = ref("");
const pToVersionId = ref("");
const corrReason = ref("MW19 题目正确答案纠错");
const corrPreviewId = ref("");
const corrPlanHash = ref("");
const corrJobId = ref("");
const corrStatusText = ref("先紧急撤回，再填 from/to 版本预览。commit 只绑定服务端预览。");
const corrView = ref("");
const pItemText = ref("");
const pPreview = ref("");
const pEvidence = ref("");
const pLocalStatus = ref("先在题库保存或点选一道题，再点「加入当前题」。");
const knownPapers = ref<string[]>([]);
const knownPaperVersions = ref<string[]>([]);
const knownChunks = ref<string[]>([]);
const knownAnswers = ref<string[]>([]);
const knownCorrectionPreviews = ref<string[]>([]);
const knownCorrectionWork = ref<string[]>([]);
const questionCatalog = ref<QuestionListRow[]>([]);
const questionListCategory = ref("");
const questionListStatusFilter = ref("");
const questionListStatus = ref("登录后会自动读取题库。");
const paperCatalog = ref<PaperListRow[]>([]);
const paperListCategory = ref("");
const paperListStatusFilter = ref("");
const paperListAccessFilter = ref("");
const paperListCursor = ref<string | null>(null);
const paperListStatus = ref("登录后会自动读取试卷。");
const iKind = ref<"question" | "paper">("question");
const iStatus = ref("先下载模板，只填虚构内容。必须先导题库再导试卷。operations 不能导入。");
const iEvidence = ref("");
const iPreview = ref("");
const iBatchId = ref("");
const iBatchState = ref("");
const iTicketId = ref("");
const iSampleKeys = ref<string[]>([]);
const knownBatches = ref<string[]>([]);
const knownImportRows = ref<string[]>([]);
const knownSourceKeys = ref<string[]>([]);
const gLevelsText = ref("");
const gConfigVersion = ref<number | null>(null);
const gConfigSource = ref("");
const gReason = ref("MW16 调整等级门槛");
const gStatus = ref("先点「读取当前等级配置」，再改门槛 JSON，然后预览影响。预览不写库。");
const gImpact = ref("");
const gEvidence = ref("");
const gMemberId = ref("");
const vMemberId = ref("");
const vReason = ref("");
const vDurationDays = ref("1");
const vDurationSeconds = ref("");
const vSourceId = ref("");
const vStatus = ref("赠送必须填写原因。content 角色会被拒。本轮不写订单。");
const vEvidence = ref("");
const vLastGrantId = ref("");
const vLastSourceId = ref("");
const planId = ref("plan_test_30d");
const planVersion = ref("1");
const planTitle = ref("30 天测试套餐");
const planDays = ref("30");
const planPriceFen = ref("9900");
const planProductAndroid = ref("test_android_30d");
const planReason = ref("MW21 发布测试套餐");
const planStatus = ref("content 角色会被拒。只发布测试价，非正式售价。");
const planEvidence = ref("");
const lastPlanIds = ref<string[]>([]);
const orderMemberId = ref("");
const orderId = ref("");
const orderStatus = ref("operations 可核对同一订单。已支付不得改价。");
const orderEvidence = ref("");
const lastOrderIds = ref<string[]>([]);
const lastRefundIds = ref<string[]>([]);
const refundMemberId = ref("");
const refundOrderId = ref("");
const refundAdvice = ref("建议整笔退款（测试）");
const refundReason = ref("MW22 退款原因");
const refundAmountFen = ref("9900");
const refundOutcome = ref("succeeded");
const refundStatus = ref("content 不能审退款。operations 只能 review。super 才能 execute。Apple 无商户退款按钮。");
const refundEvidence = ref("");
const refundView = ref("");
/** MW17 榜单治理：快照状态、真实更新时间与更新延迟都由服务端返回，本页不伪造。 */
const rReason = ref("MW17 重建四维榜单快照");
const rStatus = ref("先点「读取榜单快照状态」，再按需「重建并发布榜单快照」。重建需要 super 角色。");
const rView = ref("");
const rEvidence = ref("");
const memberQuery = ref("");
const memberIdInput = ref("");
const memberReason = ref("MW23 治理原因");
const memberStatus = ref("operations 可查会员，不能 disable/ban。content 不能看订单明细，也不能处理反馈。");
const memberView = ref("");
const memberEvidence = ref("");
const lastFeedbackIds = ref<string[]>([]);
const feedbackNote = ref("已核对原版解析无误");
const feedbackStatus = ref("operations 处理题目反馈。content 会被拒。不能借反馈改答案库。");
const feedbackView = ref("");
const feedbackEvidence = ref("");
const opsStatus = ref("operations 可看统计与教程。content 看不到收款金额。流水不是利润。重复练习计入次数。");
const opsView = ref("");
const opsEvidence = ref("");
const lastOpsSnapshotIds = ref<string[]>([]);
const opsStats = ref<Record<string, unknown> | null>(null);
const opsExceptions = ref<Array<{ kind: string; count: number; page: string; action: string; note: string }>>([]);
const opsTutorial = ref<
  Array<{ step: number; id: string; title: string; actions: string[]; page: string; executeRole: string; note: string }>
>([]);

type PageKey =
  | "admin-categories"
  | "admin-questions"
  | "admin-papers"
  | "admin-import-questions"
  | "admin-import-papers"
  | "admin-import"
  | "admin-growth"
  | "admin-vip"
  | "admin-plans"
  | "admin-orders"
  | "admin-refunds"
  | "admin-ranking"
  | "admin-members"
  | "admin-ops"
  | "admin-jobs";
type NavGroup = "content" | "import" | "ops";

const PAGES: Record<PageKey, { group: string; nav: NavGroup; title: string; desc: string }> = {
  "admin-categories": {
    group: "内容管理",
    nav: "content",
    title: "类目",
    desc: "最多三级，一至三级都可挂卷。树节点显示已加载题数与卷数。改父级仍禁止走 update；迁移与安全删除走本页预览确认。"
  },
  "admin-questions": {
    group: "内容管理",
    nav: "content",
    title: "题库",
    desc: "从列表查看现有题数并点选编辑。单选 / 多选 / 判断。解析必填。图片 ≤2MB，JPG/PNG/WebP。解析图不进公开或会员接口。"
  },
  "admin-papers": {
    group: "内容管理",
    nav: "content",
    title: "试卷编排与发布",
    desc: "从列表查看现有试卷并点选编辑。组卷、整卷预览、发布、普通下架、紧急撤回，以及 MW19 答案纠错重评。发布不等于公众上线。"
  },
  "admin-import-questions": {
    group: "内容导入",
    nav: "import",
    title: "题库导入",
    desc: "UTF-8 CSV，单文件 ≤5 MB、最多 1000 个数据行。阻断错误整批拒绝。"
  },
  "admin-import-papers": {
    group: "内容导入",
    nav: "import",
    title: "试卷导入",
    desc: "同一卷一题一行。卷级字段必须一致，题序必须连续。未先导题库的试卷导入必须失败。"
  },
  "admin-import": {
    group: "内容导入",
    nav: "import",
    title: "导入批次",
    desc: "预览当前批次、确认提交，并按 ID 回读本批草稿。"
  },
  "admin-growth": {
    group: "运营",
    nav: "ops",
    title: "成长等级与勋章配置",
    desc: "门槛必须从 0 起严格递增。发布前先预览影响人数；不删除既得勋章。VIP 购买或到期不参与加减分。"
  },
  "admin-vip": {
    group: "运营",
    nav: "ops",
    title: "VIP 赠送与撤销",
    desc: "人工赠送必须有原因，来源标 gift，不写订单。撤销只扣该赠送来源未用时长。本轮不做付款。"
  },
  "admin-plans": {
    group: "运营",
    nav: "ops",
    title: "VIP 套餐发布",
    desc: "仅 super 可发布。必须校验平台商品、天数和金额。开发只用测试价，改价改天必须新 planVersion。"
  },
  "admin-orders": {
    group: "运营",
    nav: "ops",
    title: "订单核对",
    desc: "operations 可查本人以外的订单并同单核对。不修改金额。已付未开通走同一订单补偿。日账差异只列不改金额。"
  },
  "admin-refunds": {
    group: "运营",
    nav: "ops",
    title: "退款审核与执行",
    desc: "operations 只能写审核建议。super 整笔执行。Apple 不出现商户退款按钮。最终成功才撤该 order 未用时长。"
  },
  "admin-ranking": {
    group: "运营",
    nav: "ops",
    title: "榜单治理",
    desc: "总分、分类、周进步、月进步四个榜单由服务端快照提供。免费卷与 VIP 卷统一计入，没有费用筛选。禁榜走会员页，不等于停用。"
  },
  "admin-members": {
    group: "运营",
    nav: "ops",
    title: "会员详情与禁榜",
    desc: "operations 可查会员，不含 OPENID 与订单明细。停用与禁榜分记，原因必填，仅 super。禁榜不等于停用。注销状态只读，content 仍无订单明细。停用 ≠ 注销。"
  },
  "admin-ops": {
    group: "运营",
    nav: "ops",
    title: "反馈与基础统计",
    desc: "operations 看基础统计与逐步教程。scanTruncated 显示在数字旁；true 时标明未扫全，数字不是全集。content 无订单金额。流水不是利润。重复练习计入次数。反馈绑定题目版本，不能改答案库。"
  },
  "admin-jobs": {
    group: "运营",
    nav: "ops",
    title: "任务查询与恢复",
    desc: "按任务 ID 读取进度，或对失败任务填写原因后恢复。"
  }
};

const currentPage = ref<PageKey>("admin-categories");
const sidebarVisible = ref(true);
const navExpanded = ref<Record<NavGroup, boolean>>({ content: true, import: true, ops: true });
let mediaQuery: MediaQueryList | null = null;

function isNarrowViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches;
}

function syncSidebarToViewport(): void {
  sidebarVisible.value = !isNarrowViewport();
}

onMounted(() => {
  mediaQuery = window.matchMedia("(max-width: 900px)");
  sidebarVisible.value = !mediaQuery.matches;
  mediaQuery.addEventListener("change", syncSidebarToViewport);
});
onUnmounted(() => {
  mediaQuery?.removeEventListener("change", syncSidebarToViewport);
});

function go(page: PageKey): void {
  currentPage.value = page;
  navExpanded.value = { ...navExpanded.value, [PAGES[page].nav]: true };
  if (isNarrowViewport()) sidebarVisible.value = false;
  if (page === "admin-questions" && !questionCatalog.value.length) void refreshQuestionList();
  if (page === "admin-papers" && !paperCatalog.value.length) void refreshPaperList();
  if (page === "admin-ops" && !opsTutorial.value.length) void loadOpsTutorial();
}

function toggleGroup(key: NavGroup): void {
  navExpanded.value = { ...navExpanded.value, [key]: !navExpanded.value[key] };
}

function toggleSidebar(): void {
  sidebarVisible.value = !sidebarVisible.value;
}

const currentMeta = computed(() => PAGES[currentPage.value]);
const opsScanNotice = computed(() =>
  opsScanTruncatedNotice(opsStats.value?.scanTruncated === true, Number(opsStats.value?.scanBudget) || undefined)
);
const identityLabel = computed(() => {
  if (!session.value?.loggedIn) return "未登录";
  return session.value.roles.length ? session.value.roles.join(" / ") : "已登录";
});
const loginFailed = computed(() => Boolean(session.value && !session.value.loggedIn));

/** 与产品说明书一致的初始建议门槛：用于「填入提高门槛」时整体抬高且保持严格递增。 */
const RECOMMENDED_MIN_SCORES = [0, 100, 300, 800, 1500, 3000];

function rememberId(list: { value: string[] }, id: string): void {
  if (id && !list.value.includes(id)) list.value = [...list.value, id];
}

const selected = computed(() => nodes.value.find((row) => (row.categoryId || row.id) === selectedId.value));
const displayedQuestions = computed(() =>
  questionCatalog.value.filter((row) => {
    if (questionListCategory.value && row.categoryId !== questionListCategory.value) return false;
    if (questionListStatusFilter.value && row.status !== questionListStatusFilter.value) return false;
    return true;
  })
);
const displayedPapers = computed(() =>
  paperCatalog.value.filter((row) => {
    if (paperListCategory.value && row.categoryId !== paperListCategory.value) return false;
    if (paperListStatusFilter.value && row.status !== paperListStatusFilter.value) return false;
    if (paperListAccessFilter.value && row.access !== paperListAccessFilter.value) return false;
    return true;
  })
);
const selectedCategoryQuestions = computed(() =>
  selectedId.value ? questionCatalog.value.filter((row) => row.categoryId === selectedId.value) : []
);
const selectedCategoryPapers = computed(() =>
  selectedId.value ? paperCatalog.value.filter((row) => row.categoryId === selectedId.value) : []
);

function nodeId(row: CategoryNode): string {
  return row.categoryId || row.id;
}

function categoryLabel(id: string): string {
  const row = nodes.value.find((item) => nodeId(item) === id);
  return row ? row.name : id ? `${id.slice(0, 8)}…` : "未分类";
}

function categoryQuestionCount(id: string): number {
  return questionCatalog.value.filter((row) => row.categoryId === id).length;
}

function categoryPaperCount(id: string): number {
  return paperCatalog.value.filter((row) => row.categoryId === id).length;
}

function questionTypeLabel(type: string): string {
  if (type === "multiple") return "多选";
  if (type === "trueFalse") return "判断";
  return "单选";
}

function difficultyLabel(value: string): string {
  if (value === "intermediate") return "进阶";
  if (value === "challenge") return "挑战";
  return "入门";
}

function accessLabel(value: string): string {
  return value === "vip" ? "VIP" : "免费";
}

function paperStatusLabel(value: string): string {
  if (value === "published") return "已发布";
  if (value === "unpublished") return "已下架";
  if (value === "withdrawn") return "已撤回";
  if (value === "draft") return "草稿";
  return value || "未知";
}

function questionStatusLabel(value: string): string {
  return value === "disabled" ? "停用" : "启用";
}

function stemPreview(text: string, max = 40): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return "（无题干）";
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function asQuestionRows(value: unknown): QuestionListRow[] {
  if (!Array.isArray(value)) return [];
  const rows: QuestionListRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const questionId = String(rec.questionId || "");
    if (!questionId) continue;
    const stem = rec.stem && typeof rec.stem === "object" ? (rec.stem as { text?: unknown }) : {};
    rows.push({
      questionId,
      categoryId: String(rec.categoryId || ""),
      type: String(rec.type || "single"),
      stem: { text: typeof stem.text === "string" ? stem.text : "" },
      status: String(rec.status || ""),
      difficulty: String(rec.difficulty || ""),
      defaultPoints: typeof rec.defaultPoints === "number" ? rec.defaultPoints : 0,
      revision: typeof rec.revision === "number" ? rec.revision : 0
    });
  }
  return rows;
}

function asPaperRows(value: unknown): PaperListRow[] {
  if (!Array.isArray(value)) return [];
  const rows: PaperListRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const paperId = String(rec.paperId || "");
    if (!paperId) continue;
    rows.push({
      paperId,
      title: String(rec.title || "未命名试卷"),
      summary: typeof rec.summary === "string" ? rec.summary : "",
      access: String(rec.access || ""),
      difficulty: String(rec.difficulty || ""),
      questionCount: typeof rec.questionCount === "number" ? rec.questionCount : 0,
      maxScore: typeof rec.maxScore === "number" ? rec.maxScore : 0,
      categoryId: String(rec.categoryId || ""),
      status: typeof rec.status === "string" ? rec.status : "",
      revision: typeof rec.revision === "number" ? rec.revision : 0,
      publishedAt: typeof rec.publishedAt === "string" ? rec.publishedAt : null
    });
  }
  return rows;
}

function indent(depth: number): string {
  return `${"— ".repeat(Math.max(0, depth - 1))}`;
}

function recordEvidence(action: string, result: AdminCallResult, extra: Record<string, unknown> = {}): void {
  const data = result.data || {};
  const row = {
    action,
    ok: result.ok === true,
    errorCode: result.error?.code || "",
    errorReason: result.error?.details?.reason || "",
    categoryId: typeof data.categoryId === "string" ? data.categoryId : extra.categoryId || "",
    depth: data.depth,
    name: data.name,
    enabled: data.enabled,
    treeVersion: data.treeVersion ?? treeVersion.value,
    writeConcurrency: data.writeConcurrency || "expectedTreeVersion"
  };
  const parsed = evidence.value ? JSON.parse(evidence.value) : { writeConcurrency: "expectedTreeVersion", steps: [] };
  parsed.steps.push(row);
  if (Array.isArray(data.nodes)) {
    parsed.tree = (data.nodes as CategoryNode[]).map((item) => ({
      categoryId: nodeId(item),
      depth: item.depth,
      name: item.name,
      enabled: item.enabled,
      parentId: item.parentId,
      sort: item.sort
    }));
    parsed.treeVersion = data.treeVersion;
  }
  evidence.value = JSON.stringify(parsed, null, 2);
}

async function login(): Promise<void> {
  busy.value = true;
  status.value = "正在登录…";
  try {
    const app = await createAdminApp();
    const result = await loginAndReadAdmin(app, username.value, password.value);
    password.value = "";
    session.value = result;
    status.value = result.error
      ? `登录未获得后台权限：${result.error}`
      : `已登录。角色 ${result.roles.join(",") || "无"}`;
    if (result.loggedIn) {
      await refreshTree();
      await refreshQuestionList({ manageBusy: false });
      await refreshPaperList({ manageBusy: false });
    }
  } catch (error) {
    password.value = "";
    session.value = { loggedIn: false, uidPresent: false, roles: [], error: "登录失败" };
    status.value = error instanceof Error ? error.message : "登录失败";
  } finally {
    busy.value = false;
  }
}

async function runCategory(
  action: "category.tree" | "category.create" | "category.update" | "category.delete" | "category.seed",
  data: Record<string, unknown>
): Promise<AdminCallResult> {
  const app = await createAdminApp();
  const result = await callAdminCategory(app, action, data);
  lastError.value = result.ok ? "" : result.error?.code || "CALL_FAILED";
  recordEvidence(action, result, data);
  if (result.ok && typeof result.data?.treeVersion === "number") {
    treeVersion.value = result.data.treeVersion as number;
  }
  if (result.ok && Array.isArray(result.data?.nodes)) {
    nodes.value = result.data.nodes as CategoryNode[];
  }
  return result;
}

async function refreshTree(): Promise<void> {
  busy.value = true;
  status.value = "正在读取类目树…";
  try {
    await runCategory("category.tree", {});
    status.value = `类目树已刷新。treeVersion=${treeVersion.value}`;
  } catch {
    status.value = "读取类目树失败";
  } finally {
    busy.value = false;
  }
}

async function seedRoots(): Promise<void> {
  busy.value = true;
  try {
    const result = await runCategory("category.seed", {});
    status.value = result.ok ? "种子十类已确保" : `种子失败：${result.error?.code}`;
    await runCategory("category.tree", {});
  } finally {
    busy.value = false;
  }
}

function pick(row: CategoryNode): void {
  selectedId.value = nodeId(row);
  parentId.value = nodeId(row);
  nodeName.value = row.name;
  nodeSort.value = row.sort;
  qCategoryId.value = nodeId(row);
}

async function createNode(): Promise<void> {
  busy.value = true;
  try {
    const result = await runCategory("category.create", {
      name: nodeName.value,
      parentId: parentId.value || null,
      sort: nodeSort.value,
      expectedTreeVersion: treeVersion.value
    });
    status.value = result.ok ? `已新增 depth=${result.data?.depth}` : `新增失败：${result.error?.code}`;
    await runCategory("category.tree", {});
  } finally {
    busy.value = false;
  }
}

async function updateNode(patch: Record<string, unknown>): Promise<void> {
  if (!selectedId.value) {
    status.value = "请先点选一个节点";
    return;
  }
  busy.value = true;
  try {
    const result = await runCategory("category.update", {
      categoryId: selectedId.value,
      expectedTreeVersion: treeVersion.value,
      ...patch
    });
    const done =
      patch.enabled === false ? `已停用 ${nodeName.value || selectedId.value}` : patch.enabled === true ? `已启用 ${nodeName.value || selectedId.value}` : "已更新";
    status.value = result.ok ? done : `更新失败：${result.error?.code} ${result.error?.details?.reason || ""}`.trim();
    await runCategory("category.tree", {});
  } finally {
    busy.value = false;
  }
}

async function deleteNode(): Promise<void> {
  if (!selectedId.value) {
    status.value = "请先点选一个测试节点";
    return;
  }
  busy.value = true;
  try {
    const result = await runCategory("category.delete", {
      categoryId: selectedId.value,
      expectedTreeVersion: treeVersion.value,
      reason: "unused test node"
    });
    status.value = result.ok ? "已逻辑删除" : `删除失败：${result.error?.code}`;
    await runCategory("category.tree", {});
  } finally {
    busy.value = false;
  }
}

async function tryFourth(): Promise<void> {
  if (!selected.value || selected.value.depth !== 3) {
    status.value = "请先选中一个三级节点再试第四级";
    return;
  }
  busy.value = true;
  try {
    const result = await runCategory("category.create", {
      name: "第四级反例",
      parentId: selectedId.value,
      expectedTreeVersion: treeVersion.value
    });
    status.value = result.ok ? "第四级不应成功" : `第四级已拒绝：${result.error?.code}`;
  } finally {
    busy.value = false;
  }
}

async function tryDuplicate(): Promise<void> {
  if (!selected.value) {
    status.value = "请先点选一个节点，用它的名称做同级重名";
    return;
  }
  busy.value = true;
  try {
    const result = await runCategory("category.create", {
      name: selected.value.name,
      parentId: selected.value.parentId,
      expectedTreeVersion: treeVersion.value
    });
    status.value = result.ok ? "同级重名不应成功" : `同级重名已拒绝：${result.error?.code}`;
  } finally {
    busy.value = false;
  }
}

async function tryMoveParent(): Promise<void> {
  if (!selectedId.value) {
    status.value = "请先点选一个节点";
    return;
  }
  busy.value = true;
  try {
    const result = await runCategory("category.update", {
      categoryId: selectedId.value,
      expectedTreeVersion: treeVersion.value,
      parentId: parentId.value || null,
      name: nodeName.value
    });
    status.value = result.ok ? "改父级不应成功" : `改父级已拒绝：${result.error?.code}`;
  } finally {
    busy.value = false;
  }
}

async function runCategoryChange(
  action: "category.change.preview" | "category.change.commit" | "category.change.status",
  data: Record<string, unknown>
): Promise<AdminCallResult> {
  const app = await createAdminApp();
  const result = await callAdminCategoryChange(app, action, data);
  lastError.value = result.ok ? "" : result.error?.code || "CALL_FAILED";
  recordEvidence(action, result, data);
  changeView.value = JSON.stringify(result, null, 2);
  if (typeof result.data?.previewId === "string") changePreviewId.value = result.data.previewId;
  if (typeof result.data?.planHash === "string") changePlanHash.value = result.data.planHash;
  if (typeof result.data?.jobId === "string") changeJobId.value = result.data.jobId;
  return result;
}

async function previewCategoryMove(): Promise<void> {
  if (!selectedId.value) {
    changeStatusText.value = "请先点选要移动的测试节点，不要用种子十类。";
    return;
  }
  busy.value = true;
  try {
    const result = await runCategoryChange("category.change.preview", {
      expectedTreeVersion: treeVersion.value,
      operations: [
        { type: "move", categoryId: selectedId.value, parentId: changeTargetParentId.value || null }
      ]
    });
    changeStatusText.value = result.ok
      ? `预览已生成。planHash=${String(result.data?.planHash || "").slice(0, 12)}… 请确认后再提交。`
      : `预览失败：${result.error?.code} ${result.error?.details?.reason || ""}`;
  } finally {
    busy.value = false;
  }
}

async function previewCategoryDelete(): Promise<void> {
  if (!selectedId.value) {
    changeStatusText.value = "请先点选专用测试节点。有引用必须先迁题迁卷。";
    return;
  }
  busy.value = true;
  try {
    const ops: Array<Record<string, unknown>> = [];
    if (changeTargetParentId.value) {
      ops.push({ type: "relocatePapers", fromCategoryId: selectedId.value, toCategoryId: changeTargetParentId.value });
      ops.push({ type: "relocateQuestions", fromCategoryId: selectedId.value, toCategoryId: changeTargetParentId.value });
    }
    ops.push({ type: "delete", categoryId: selectedId.value });
    const result = await runCategoryChange("category.change.preview", {
      expectedTreeVersion: treeVersion.value,
      operations: ops
    });
    changeStatusText.value = result.ok
      ? `删除预览已生成。迁卷 ${Array.isArray(result.data?.relocatedPapers) ? result.data.relocatedPapers.length : 0}，迁题 ${Array.isArray(result.data?.relocatedQuestions) ? result.data.relocatedQuestions.length : 0}。`
      : `删除预览失败：${result.error?.code} ${result.error?.details?.reason || ""}`;
  } finally {
    busy.value = false;
  }
}

async function commitCategoryChangeAction(): Promise<void> {
  if (!changePreviewId.value || !changePlanHash.value) {
    changeStatusText.value = "请先预览。commit 不接受本页手填计划。";
    return;
  }
  busy.value = true;
  try {
    const result = await runCategoryChange("category.change.commit", {
      previewId: changePreviewId.value,
      planHash: changePlanHash.value,
      reason: changeReason.value,
      confirmed: true
    });
    changeStatusText.value = result.ok
      ? `已提交维护任务 ${String(result.data?.jobId || "")}。notBefore=${String(result.data?.notBefore || "")}。35 秒内不会推进。`
      : `确认失败：${result.error?.code} ${result.error?.details?.reason || ""} ${result.error?.details?.note || ""}`.trim();
  } finally {
    busy.value = false;
  }
}

async function refreshChangeStatus(): Promise<void> {
  busy.value = true;
  try {
    const result = await runCategoryChange("category.change.status", changeJobId.value ? { jobId: changeJobId.value } : {});
    const catalog = (result.data?.catalog || {}) as Record<string, unknown>;
    changeStatusText.value = result.ok
      ? `维护=${catalog.structureUpdating === true ? "进行中" : "未占用"} · 分类榜=${String(catalog.categoryRankingStatus || "")} · ${String(catalog.categoryRankingError || "")}`
      : `读取进度失败：${result.error?.code}`;
    if (result.ok && (result.data as { updating?: boolean })?.updating) {
      nodes.value = [];
    }
  } finally {
    busy.value = false;
  }
}

async function resumeChangeJob(): Promise<void> {
  if (!changeJobId.value) {
    changeStatusText.value = "没有可恢复的 jobId。job.resume 只用于失败恢复，不能代替正常调度。";
    return;
  }
  busy.value = true;
  try {
    const app = await createAdminApp();
    const result = await callAdminJob(app, "job.resume", { jobId: changeJobId.value, reason: changeReason.value });
    recordEvidence("job.resume", result, { jobId: changeJobId.value });
    changeView.value = JSON.stringify(result, null, 2);
    changeStatusText.value = result.ok ? "已请求恢复。请再读进度。" : `恢复失败：${result.error?.code}`;
  } finally {
    busy.value = false;
  }
}

function copyEvidence(): void {
  const knownIds = {
    categories: nodes.value
      .map((row) => nodeId(row))
      .filter((id) => /^[0-9a-f]{64}$/i.test(id) && !rowIsSeed(id)),
    names: [],
    idempotency: [],
    audits: []
  };
  const payload = evidence.value ? JSON.parse(evidence.value) : {};
  payload.knownIds = knownIds;
  const text = JSON.stringify(payload, null, 2);
  evidence.value = text;
  void navigator.clipboard?.writeText(text);
  status.value = "已复制脱敏证据。不要发送密码。";
}

function rowIsSeed(id: string): boolean {
  const row = nodes.value.find((item) => nodeId(item) === id);
  return Boolean(row && row.depth === 1 && INITIAL_HINT.has(row.name));
}

const INITIAL_HINT = new Set([
  "逻辑思维",
  "逆向思维",
  "发散思维",
  "聚合思维",
  "形象思维",
  "抽象思维",
  "创造性思维",
  "批判性思维",
  "博弈思维",
  "开放性思维"
]);

async function runJob(action: "job.get" | "job.resume"): Promise<void> {
  if (!session.value?.loggedIn) {
    status.value = "请先登录";
    return;
  }
  busy.value = true;
  status.value = `正在调用 ${action}…`;
  try {
    const app = await createAdminApp();
    const result = await callAdminJob(
      app,
      action,
      { jobId: jobId.value, reason: resumeReason.value },
      `mw06/test/admin_${action}_${Date.now()}`
    );
    jobResult.value = JSON.stringify(
      {
        ok: result.ok === true,
        errorCode: result.error?.code,
        errorReason: result.error?.details?.reason,
        jobState: (result.data as { job?: { state?: string } } | undefined)?.job?.state,
        replayed: (result.data as { replayed?: boolean } | undefined)?.replayed === true,
        pending: (result.data as { pending?: boolean } | undefined)?.pending === true
      },
      null,
      2
    );
    status.value = result.ok ? `${action} 成功` : `${action} 失败`;
  } catch {
    jobResult.value = JSON.stringify({ ok: false, errorCode: "CALL_FAILED" }, null, 2);
    status.value = `${action} 失败`;
  } finally {
    busy.value = false;
  }
}

function optionLetters(count: number): string[] {
  return Array.from({ length: count }, (_, index) => String.fromCharCode(65 + index));
}

function parsedOptions(): Array<{ optionId: string; text: string; assetIds: string[] }> {
  if (qType.value === "trueFalse") {
    return [
      { optionId: "TRUE", text: "正确", assetIds: [] },
      { optionId: "FALSE", text: "错误", assetIds: [] }
    ];
  }
  const lines = qOptions.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.map((text, index) => ({ optionId: optionLetters(lines.length)[index] || `O${index + 1}`, text, assetIds: [] }));
}

async function hashText(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function hashFile(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function recordQuestionEvidence(action: string, result: AdminCallResult, extra: Record<string, unknown> = {}): void {
  const data = result.data || {};
  const row = {
    action,
    ok: result.ok === true,
    errorCode: result.error?.code || "",
    errorReason: result.error?.details?.reason || "",
    type: data.type || extra.type || "",
    categoryId: extra.categoryId || data.categoryId || "",
    revision: data.revision,
    ticketOnce: extra.ticketOnce === true,
    complete: data.complete
  };
  const parsed = qEvidence.value ? JSON.parse(qEvidence.value) : { writeConcurrency: "expectedRevision", steps: [] };
  parsed.steps.push(row);
  qEvidence.value = JSON.stringify(parsed, null, 2);
}

async function runQuestion(
  action: "question.list" | "question.get" | "question.save" | "question.disable" | "upload.authorize" | "upload.status",
  data: Record<string, unknown>
): Promise<AdminCallResult> {
  const app = await createAdminApp();
  const result = await callAdminQuestion(app, action, data);
  lastError.value = result.ok ? "" : result.error?.code || "CALL_FAILED";
  recordQuestionEvidence(action, result, data);
  return result;
}

async function refreshQuestionList(options: { manageBusy?: boolean } = {}): Promise<void> {
  const manageBusy = options.manageBusy !== false;
  if (manageBusy) busy.value = true;
  questionListStatus.value = "正在读取题库…";
  try {
    const result = await runQuestion("question.list", { limit: 100 });
    if (!result.ok) {
      questionListStatus.value = `读取题库失败：${result.error?.code || ""} ${result.error?.details?.reason || ""}`;
      return;
    }
    questionCatalog.value = asQuestionRows(result.data?.items);
    const loaded = questionCatalog.value.length;
    questionListStatus.value =
      loaded >= 100 ? `已加载 ${loaded} 题（达到上限，可能还有更多）` : `已加载 ${loaded} 题`;
  } catch {
    questionListStatus.value = "读取题库失败";
  } finally {
    if (manageBusy) busy.value = false;
  }
}

async function openQuestionFromList(row: QuestionListRow): Promise<void> {
  qQuestionId.value = row.questionId;
  qCategoryId.value = row.categoryId;
  await loadQuestion();
}

function addQuestionFromList(row: QuestionListRow): void {
  qQuestionId.value = row.questionId;
  qCategoryId.value = row.categoryId;
  if (typeof row.defaultPoints === "number" && row.defaultPoints > 0) qPoints.value = row.defaultPoints;
  addCurrentQuestion();
  go("admin-papers");
}

function viewCategoryQuestions(): void {
  questionListCategory.value = selectedId.value;
  go("admin-questions");
}

function viewCategoryPapers(): void {
  paperListCategory.value = selectedId.value;
  go("admin-papers");
}

async function saveQuestion(): Promise<void> {
  if (!qCategoryId.value && selectedId.value) qCategoryId.value = selectedId.value;
  if (!qCategoryId.value) {
    status.value = "请先选择一个类目";
    return;
  }
  busy.value = true;
  try {
    const options = parsedOptions();
    const answerIds =
      qType.value === "trueFalse"
        ? [qAnswers.value === "FALSE" ? "FALSE" : "TRUE"]
        : qAnswers.value
            .split(/[|,，\s]+/)
            .map((item) => item.trim())
            .filter(Boolean);
    const result = await runQuestion("question.save", {
      ...(qQuestionId.value ? { questionId: qQuestionId.value } : {}),
      expectedRevision: qRevision.value,
      categoryId: qCategoryId.value,
      type: qType.value,
      stem: { text: qStem.value, assetIds: promptAssetId.value ? [promptAssetId.value] : [] },
      options,
      answer: { optionIds: answerIds },
      analysis: { text: qAnalysis.value, assetIds: analysisAssetId.value ? [analysisAssetId.value] : [] },
      defaultPoints: qPoints.value,
      difficulty: qDifficulty.value
    });
    if (result.ok) {
      qQuestionId.value = String(result.data?.questionId || "");
      qVersionId.value = String(result.data?.versionId || "");
      qRevision.value = Number(result.data?.revision || 1);
      qStatus.value = String(result.data?.status || "active");
      qComplete.value = result.data?.complete !== false;
      rememberId(knownQuestions, qQuestionId.value);
      rememberId(knownVersions, qVersionId.value);
      status.value = `已保存 ${qType.value} revision=${qRevision.value}。三种题型请各点一次「新建下一题」再保存，不要覆盖同一题。`;
      await refreshQuestionList({ manageBusy: false });
    } else {
      status.value = `保存失败：${result.error?.code}`;
    }
  } finally {
    busy.value = false;
  }
}

function applyLoadedQuestion(data: Record<string, unknown>): string {
  const question = (
    data.question && typeof data.question === "object" && !Array.isArray(data.question) ? data.question : data
  ) as Record<string, unknown>;
  const stem = question.stem && typeof question.stem === "object" ? (question.stem as Record<string, unknown>) : {};
  const analysis = question.analysis && typeof question.analysis === "object" ? (question.analysis as Record<string, unknown>) : {};
  const answer = question.answer && typeof question.answer === "object" ? (question.answer as Record<string, unknown>) : {};
  const type = question.type === "multiple" || question.type === "trueFalse" ? question.type : "single";
  const options = Array.isArray(question.options) ? question.options : [];
  const answerIds = Array.isArray(answer.optionIds) ? answer.optionIds.map((item) => String(item)) : [];
  qQuestionId.value = String(question.questionId || qQuestionId.value);
  qCategoryId.value = String(question.categoryId || qCategoryId.value);
  qType.value = type;
  qStem.value = typeof stem.text === "string" ? stem.text : "";
  qOptions.value = options
    .map((row) => (row && typeof row === "object" ? String((row as { text?: unknown }).text || "") : ""))
    .filter(Boolean)
    .join("\n");
  qAnswers.value = type === "trueFalse" ? answerIds[0] === "FALSE" ? "FALSE" : "TRUE" : answerIds.join("|");
  qAnalysis.value = typeof analysis.text === "string" ? analysis.text : "";
  qPoints.value = typeof question.defaultPoints === "number" ? question.defaultPoints : qPoints.value;
  qDifficulty.value = question.difficulty === "intermediate" || question.difficulty === "challenge" ? question.difficulty : "beginner";
  qRevision.value = Number(question.revision || 0);
  qVersionId.value = String(question.versionId || question.currentVersionId || "");
  qStatus.value = String(question.status || "");
  qComplete.value = data.complete === true;
  const missing = Array.isArray(question.missingAssets)
    ? (question.missingAssets as Array<{ assetId?: string; kind?: string }>)
    : [];
  qMissing.value = missing.map((item) => `${item.kind || "?"}:${String(item.assetId || "").slice(0, 8)}`).join(",");
  const assets = Array.isArray(data.assets) ? (data.assets as Array<Record<string, unknown>>) : [];
  const prompt = assets.find((item) => item.kind === "prompt");
  previewUrl.value = typeof prompt?.readUrl === "string" ? prompt.readUrl : "";
  previewKind.value = previewUrl.value ? "prompt" : "";
  promptAssetId.value = typeof prompt?.assetId === "string" ? prompt.assetId : "";
  const analysisAsset = assets.find((item) => item.kind === "analysis");
  analysisAssetId.value = typeof analysisAsset?.assetId === "string" ? analysisAsset.assetId : "";
  return qStem.value;
}

async function loadQuestion(): Promise<void> {
  if (!qQuestionId.value) {
    status.value = "没有 questionId。请从试卷编排「题目」框复制冒号前那一串，不要用 knownIds 哈希。";
    return;
  }
  busy.value = true;
  previewFailed.value = false;
  try {
    const result = await runQuestion("question.get", { questionId: qQuestionId.value.trim() });
    if (!result.ok) {
      status.value =
        result.error?.code === "NOT_FOUND"
          ? "读取失败：云端没有这道题。请用试卷页「题目」文本框里冒号前的 ID，不要用「复制 knownIds」里的哈希。"
          : `读取失败：${result.error?.code}`;
      return;
    }
    const stem = applyLoadedQuestion(result.data || {});
    if (!qComplete.value || qMissing.value) {
      previewFailed.value = true;
      status.value = `已读取「${stem || "（无题干）"}」，但题目未完整`;
    } else {
      status.value = `已读取「${stem || "（无题干）"}」 revision=${qRevision.value}`;
    }
  } finally {
    busy.value = false;
  }
}

async function disableCurrent(): Promise<void> {
  if (!qQuestionId.value) {
    status.value = "没有可停用的题";
    return;
  }
  busy.value = true;
  try {
    const result = await runQuestion("question.disable", {
      questionId: qQuestionId.value,
      expectedRevision: qRevision.value,
      reason: "mw10 unused fixture"
    });
    status.value = result.ok ? "已停用" : `停用失败：${result.error?.code}`;
    if (result.ok) {
      qStatus.value = "disabled";
      await refreshQuestionList({ manageBusy: false });
    }
  } finally {
    busy.value = false;
  }
}

async function uploadPicked(file: File | undefined, purpose: "prompt" | "analysis"): Promise<void> {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    status.value = "超过 2 MB";
    lastError.value = "INVALID_ARGUMENT";
    return;
  }
  busy.value = true;
  lastTicketOnce.value = false;
  try {
    const sha256 = await hashFile(file);
    const contentType = file.type === "image/jpeg" || file.type === "image/webp" ? file.type : "image/png";
    const authorized = await runQuestion("upload.authorize", {
      purpose,
      contentType,
      size: file.size,
      sha256,
      caption: purpose === "analysis" ? "虚构解析图" : "虚构题干图"
    });
    if (!authorized.ok || typeof authorized.data?.uploadTicket !== "string") {
      status.value = `签发失败：${authorized.error?.code || authorized.error?.details?.reason}`;
      return;
    }
    const ticket = authorized.data.uploadTicket as string;
    const app = await createAdminApp();
    const completed = await completeAdminUpload(app, {
      uploadTicket: ticket,
      sha256,
      size: file.size,
      fileBase64: await fileToBase64(file)
    });
    recordQuestionEvidence("mw-upload.complete", completed, { ticketOnce: true, type: purpose });
    lastTicketOnce.value = completed.ok === true;
    if (!completed.ok) {
      status.value = `上传失败：${completed.error?.code || completed.error?.details?.reason}`;
      return;
    }
    const replay = await completeAdminUpload(app, {
      uploadTicket: ticket,
      sha256,
      size: file.size,
      fileBase64: await fileToBase64(file)
    });
    recordQuestionEvidence("mw-upload.replay", replay, { ticketOnce: false });
    const assetId = String(completed.data?.assetId || authorized.data?.assetId || "");
    rememberId(knownAssets, assetId);
    if (purpose === "prompt") promptAssetId.value = assetId;
    else analysisAssetId.value = assetId;
    previewUrl.value = URL.createObjectURL(file);
    previewKind.value = purpose;
    previewFailed.value = false;
    status.value = replay.ok ? "重放不应成功" : `${purpose} 图已上传，重放已拒绝`;
  } finally {
    busy.value = false;
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const text = String(reader.result || "");
      const comma = text.indexOf(",");
      resolve(comma >= 0 ? text.slice(comma + 1) : text);
    };
    reader.readAsDataURL(file);
  });
}

function openPreview(): void {
  if (!previewUrl.value) {
    previewFailed.value = true;
    status.value = "缺图，不能当作完整题";
    return;
  }
  previewOpen.value = true;
}

function startNewQuestion(): void {
  qQuestionId.value = "";
  qVersionId.value = "";
  qRevision.value = 0;
  qStatus.value = "";
  qComplete.value = true;
  qMissing.value = "";
  promptAssetId.value = "";
  analysisAssetId.value = "";
  previewUrl.value = "";
  previewKind.value = "";
  previewOpen.value = false;
  previewFailed.value = false;
  lastTicketOnce.value = false;
  status.value = "已清空当前题，下一题会新建，不会覆盖刚才那道。多选正确答案至少两项，例如 A|C。";
}

async function copyQuestionEvidence(): Promise<void> {
  const parsed = qEvidence.value ? JSON.parse(qEvidence.value) : { steps: [] };
  const questions = knownQuestions.value.length ? knownQuestions.value : qQuestionId.value ? [qQuestionId.value] : [];
  const versions = knownVersions.value.length ? knownVersions.value : qVersionId.value ? [qVersionId.value] : [];
  const assets = knownAssets.value.length
    ? knownAssets.value
    : [promptAssetId.value, analysisAssetId.value].filter(Boolean);
  parsed.knownIds = {
    questions: await Promise.all(questions.map((id) => hashText(id))),
    versions: await Promise.all(versions.map((id) => hashText(id))),
    assets: await Promise.all(assets.map((id) => hashText(id))),
    tickets: [],
    objects: [],
    idempotency: [],
    audits: []
  };
  parsed.summary = {
    type: qType.value,
    categoryId: qCategoryId.value,
    revision: qRevision.value,
    ticketOnce: lastTicketOnce.value,
    status: qStatus.value,
    complete: qComplete.value
  };
  const text = JSON.stringify(parsed, null, 2);
  qEvidence.value = text;
  void navigator.clipboard?.writeText(text);
  status.value = "已复制题库脱敏证据。不要发送密码、明文票据或环境 ID。";
}

function recordPaperEvidence(action: string, result: AdminCallResult, extra: Record<string, unknown> = {}): void {
  const data = result.data || {};
  const row = {
    action,
    ok: result.ok === true,
    errorCode: result.error?.code || "",
    errorReason: result.error?.details?.reason || extra.reason || "",
    paperId: typeof data.paperId === "string" ? data.paperId : extra.paperId || pPaperId.value,
    status: data.status || extra.status || "",
    revision: data.revision,
    versionId: data.versionId || data.activeVersionId || "",
    questionCount: data.questionCount || data.draftQuestionCount,
    maxScore: data.maxScore || data.draftMaxScore
  };
  const parsed = pEvidence.value ? JSON.parse(pEvidence.value) : { writeConcurrency: "expectedRevision", steps: [] };
  parsed.steps.push(row);
  pEvidence.value = JSON.stringify(parsed, null, 2);
}

function paperItems(): Array<{ questionId: string; points: number; ord: number }> {
  const lines = pItemText.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line, index) => {
    const [id, points] = line.split(":");
    return { questionId: (id || "").trim(), points: Number(points || 5), ord: index + 1 };
  });
}

function setPaperStatus(message: string): void {
  pLocalStatus.value = message;
  status.value = message;
}

function looksLikeFakeQuestionId(id: string): boolean {
  return /^(?:1+|2+|3+|123+|111+|222+|333+)$/.test(id) || (id.length < 16 && /^\d+$/.test(id));
}

function addCurrentQuestion(): void {
  if (!qQuestionId.value) {
    setPaperStatus("请先在题库保存或从列表点选一道题，再点「加入当前题」。");
    return;
  }
  const lines = pItemText.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !looksLikeFakeQuestionId(line.split(":")[0] || ""));
  if (!lines.some((line) => line.startsWith(qQuestionId.value))) {
    lines.push(`${qQuestionId.value}:${qPoints.value || 5}`);
  }
  pItemText.value = lines.join("\n");
  setPaperStatus(`已加入当前题 ${qQuestionId.value.slice(0, 12)}…，共 ${lines.length} 题。`);
}

async function refreshPaperList(options: { manageBusy?: boolean; loadMore?: boolean } = {}): Promise<void> {
  const manageBusy = options.manageBusy !== false;
  if (manageBusy) busy.value = true;
  paperListStatus.value = options.loadMore ? "正在加载更多试卷…" : "正在读取试卷…";
  try {
    const data: Record<string, unknown> = { limit: 100, sort: "latest" };
    if (options.loadMore && paperListCursor.value) data.cursor = paperListCursor.value;
    const result = await runPaper("paper.list", data);
    if (!result.ok) {
      paperListStatus.value = `读取试卷失败：${result.error?.code || ""} ${result.error?.details?.reason || ""}`;
      return;
    }
    const rows = asPaperRows(result.data?.items);
    paperCatalog.value = options.loadMore ? [...paperCatalog.value, ...rows] : rows;
    paperListCursor.value = typeof result.data?.nextCursor === "string" && result.data.nextCursor ? result.data.nextCursor : null;
    const loaded = paperCatalog.value.length;
    paperListStatus.value = paperListCursor.value
      ? `已加载 ${loaded} 份试卷，还有更多`
      : `已加载 ${loaded} 份试卷`;
  } catch {
    paperListStatus.value = "读取试卷失败";
  } finally {
    if (manageBusy) busy.value = false;
  }
}

async function openPaperFromList(row: PaperListRow): Promise<void> {
  pPaperId.value = row.paperId;
  if (row.categoryId) qCategoryId.value = row.categoryId;
  await loadPaperById();
}

function startNewPaper(): void {
  pPaperId.value = "";
  pRevision.value = 0;
  pStatus.value = "";
  pMaxScore.value = 0;
  pQuestionCount.value = 0;
  pActiveVersionId.value = "";
  pFromVersionId.value = "";
  pToVersionId.value = "";
  pTitle.value = "";
  pSummary.value = "";
  pGoal.value = "";
  pAccess.value = "free";
  pDifficulty.value = "beginner";
  pSort.value = 10;
  pItemText.value = "";
  pPreview.value = "";
  setPaperStatus("已清空当前卷，保存时会新建，不会覆盖刚才那份。");
}

async function runPaper(
  action: "paper.list" | "paper.get" | "paper.save" | "paper.preview" | "paper.publish" | "paper.unpublish" | "paper.withdraw",
  data: Record<string, unknown>
): Promise<AdminCallResult> {
  try {
    const app = await createAdminApp();
    const result = await callAdminPaper(app, action, data);
    lastError.value = result.ok ? "" : result.error?.code || "CALL_FAILED";
    recordPaperEvidence(action, result, data);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "CALL_FAILED";
    lastError.value = "CALL_FAILED";
    const failed = { ok: false, error: { code: "CALL_FAILED", message, details: { reason: message } } };
    recordPaperEvidence(action, failed, data);
    return failed;
  }
}

function applyPaperView(data: Record<string, unknown>): void {
  const paper = (data.paper && typeof data.paper === "object" ? data.paper : data) as Record<string, unknown>;
  pPaperId.value = String(paper.paperId || data.paperId || pPaperId.value);
  pRevision.value = Number(paper.revision || data.revision || pRevision.value);
  pStatus.value = String(paper.status || data.status || "");
  pMaxScore.value = Number(paper.draftMaxScore || paper.maxScore || data.maxScore || 0);
  pQuestionCount.value = Number(paper.draftQuestionCount || paper.questionCount || data.questionCount || 0);
  pActiveVersionId.value = String(paper.activeVersionId || data.versionId || pActiveVersionId.value);
  if (typeof paper.title === "string" && paper.title) pTitle.value = paper.title;
  if (typeof paper.summary === "string") pSummary.value = paper.summary;
  if (typeof paper.goal === "string") pGoal.value = paper.goal;
  if (paper.access === "free" || paper.access === "vip") pAccess.value = paper.access;
  if (paper.difficulty === "beginner" || paper.difficulty === "intermediate" || paper.difficulty === "challenge") {
    pDifficulty.value = paper.difficulty;
  }
  if (typeof paper.sort === "number") pSort.value = paper.sort;
  const items = Array.isArray(paper.draftItems) ? paper.draftItems : [];
  if (items.length) {
    pItemText.value = items
      .map((row) => {
        const rec = row && typeof row === "object" ? (row as { questionId?: unknown; points?: unknown }) : {};
        return `${String(rec.questionId || "")}:${Number(rec.points || 0)}`;
      })
      .filter((line) => !line.startsWith(":"))
      .join("\n");
  }
  rememberId(knownPapers, pPaperId.value);
  if (pActiveVersionId.value) rememberId(knownPaperVersions, pActiveVersionId.value);
}

async function loadPaperById(): Promise<void> {
  const paperId = pPaperId.value.trim();
  if (!paperId) {
    setPaperStatus("请先在「试卷 ID」贴上要打开的试卷，不要只改标题。");
    return;
  }
  busy.value = true;
  try {
    const result = await runPaper("paper.get", { paperId });
    if (!result.ok) {
      setPaperStatus(`按 ID 读取试卷失败：${result.error?.code || ""} ${result.error?.details?.reason || ""}`);
      return;
    }
    applyPaperView(result.data || {});
    setPaperStatus(`已打开「${pTitle.value}」status=${pStatus.value} revision=${pRevision.value}。改标题不会换卷。`);
  } finally {
    busy.value = false;
  }
}

async function savePaperDraft(): Promise<void> {
  if (!qCategoryId.value && selectedId.value) qCategoryId.value = selectedId.value;
  const items = paperItems();
  if (!items.length) {
    setPaperStatus("题目栏是空的。请先在题库保存或点选题目，再点「加入当前题」。");
    return;
  }
  if (items.some((item) => looksLikeFakeQuestionId(item.questionId))) {
    setPaperStatus("题目栏里有无效的短数字 ID。请清空后从题库列表加入真实题目。");
    return;
  }
  if (!qCategoryId.value) {
    setPaperStatus("还没选类目。请先在上方类目树点一个节点，或在题库填类目 ID。");
    return;
  }
  busy.value = true;
  setPaperStatus("正在保存草稿…");
  try {
    const result = await runPaper("paper.save", {
      ...(pPaperId.value ? { paperId: pPaperId.value } : {}),
      expectedRevision: pRevision.value,
      title: pTitle.value,
      summary: pSummary.value,
      goal: pGoal.value,
      categoryId: qCategoryId.value,
      access: pAccess.value,
      difficulty: pDifficulty.value,
      sort: pSort.value,
      suggestedMinutes: 20,
      items
    });
    if (result.ok) {
      applyPaperView(result.data || {});
      setPaperStatus(`草稿已保存 revision=${pRevision.value}，${pQuestionCount.value} 题，满分 ${pMaxScore.value}`);
      await refreshPaperList({ manageBusy: false });
    } else {
      setPaperStatus(`保存草稿失败：${result.error?.code || ""} ${result.error?.details?.reason || result.error?.message || ""}`);
    }
  } finally {
    busy.value = false;
  }
}

async function previewPaper(): Promise<void> {
  if (!pPaperId.value) {
    setPaperStatus("还没有 paperId。必须先「保存草稿」成功，预览/发布才会有反应。");
    return;
  }
  busy.value = true;
  setPaperStatus("正在整卷预览…");
  try {
    const result = await runPaper("paper.preview", { paperId: pPaperId.value });
    pPreview.value = JSON.stringify(result.data || result.error || {}, null, 2);
    setPaperStatus(result.ok ? "整卷预览已生成（含管理端解析，不进公开包）" : `预览失败：${result.error?.code}`);
  } finally {
    busy.value = false;
  }
}

async function publishPaper(fault?: "missingChunk" | "badManifest"): Promise<void> {
  if (!pPaperId.value) {
    setPaperStatus("还没有 paperId。必须先「保存草稿」成功，再发布。");
    return;
  }
  busy.value = true;
  setPaperStatus(fault ? `正在故意${fault === "missingChunk" ? "缺块" : "坏摘要"}发布（应拒绝）…` : "正在发布…");
  try {
    const result = await runPaper("paper.publish", {
      paperId: pPaperId.value,
      expectedRevision: pRevision.value,
      confirmOverlap: true,
      ...(fault ? { injectPublishFault: fault } : {})
    });
    if (result.ok) {
      applyPaperView(result.data || {});
      if (pFromVersionId.value) pToVersionId.value = pActiveVersionId.value;
      setPaperStatus(`发布成功 version=${pActiveVersionId.value}`);
      await refreshPaperList({ manageBusy: false });
    } else {
      setPaperStatus(`发布拒绝：${result.error?.code || ""} ${result.error?.details?.reason || result.error?.message || ""}`);
    }
  } finally {
    busy.value = false;
  }
}

async function unpublishPaper(): Promise<void> {
  if (!pPaperId.value) {
    setPaperStatus("还没有已保存的试卷，不能下架。");
    return;
  }
  busy.value = true;
  setPaperStatus("正在普通下架…");
  try {
    const result = await runPaper("paper.unpublish", { paperId: pPaperId.value, expectedRevision: pRevision.value });
    if (result.ok) {
      applyPaperView(result.data || {});
      await refreshPaperList({ manageBusy: false });
    }
    setPaperStatus(result.ok ? "已普通下架，只阻止新开始" : `下架失败：${result.error?.code}`);
  } finally {
    busy.value = false;
  }
}

async function runCorrection(
  action: "correction.preview" | "correction.commit" | "correction.status",
  data: Record<string, unknown>
): Promise<AdminCallResult> {
  const app = await createAdminApp();
  const result = await callAdminCorrection(app, action, data);
  lastError.value = result.ok ? "" : result.error?.code || "CALL_FAILED";
  corrView.value = JSON.stringify(result, null, 2);
  if (typeof result.data?.previewId === "string") {
    corrPreviewId.value = result.data.previewId;
    rememberId(knownCorrectionPreviews, result.data.previewId);
  }
  if (typeof result.data?.planHash === "string") corrPlanHash.value = result.data.planHash;
  if (typeof result.data?.jobId === "string") {
    corrJobId.value = result.data.jobId;
    rememberId(knownCorrectionWork, result.data.jobId);
  }
  return result;
}

async function previewCorrectionAction(): Promise<void> {
  if (!pPaperId.value || !pFromVersionId.value || !pToVersionId.value) {
    corrStatusText.value = "需要 paperId、fromVersionId（撤回前版本）、toVersionId（修订后版本）。";
    return;
  }
  busy.value = true;
  try {
    const result = await runCorrection("correction.preview", {
      paperId: pPaperId.value,
      fromVersionId: pFromVersionId.value,
      toVersionId: pToVersionId.value
    });
    corrStatusText.value = result.ok
      ? `预览已生成。受影响尝试 ${String(result.data?.affectedAttemptCount ?? 0)}，会员 ${String(result.data?.affectedMemberCount ?? 0)}。请 super 确认。`
      : `预览失败：${result.error?.code} ${result.error?.details?.reason || ""}`;
  } finally {
    busy.value = false;
  }
}

async function commitCorrectionAction(): Promise<void> {
  if (!corrPreviewId.value || !corrPlanHash.value) {
    corrStatusText.value = "请先预览。commit 不接受本页手填计划。";
    return;
  }
  busy.value = true;
  try {
    const result = await runCorrection("correction.commit", {
      previewId: corrPreviewId.value,
      planHash: corrPlanHash.value,
      reason: corrReason.value,
      confirmed: true
    });
    corrStatusText.value = result.ok
      ? `已提交重评任务 ${String(result.data?.jobId || "")}。notBefore=${String(result.data?.notBefore || "")}。35 秒内不会推进。`
      : `确认失败：${result.error?.code} ${result.error?.details?.reason || ""}`;
  } finally {
    busy.value = false;
  }
}

async function refreshCorrectionStatus(): Promise<void> {
  busy.value = true;
  try {
    const result = await runCorrection("correction.status", corrJobId.value ? { jobId: corrJobId.value } : {});
    corrStatusText.value = result.ok
      ? `维护交卷=${result.data?.submitClosed === true ? "已关" : "开放"} · 更新中=${result.data?.updating === true ? "是" : "否"} · ${String((result.data?.work as { rankingStatus?: string } | undefined)?.rankingStatus || "")}`
      : `读取进度失败：${result.error?.code}`;
  } finally {
    busy.value = false;
  }
}

async function resumeCorrectionJob(): Promise<void> {
  if (!corrJobId.value) {
    corrStatusText.value = "没有可恢复的 jobId。job.resume 只用于失败恢复，不能代替正常调度。";
    return;
  }
  busy.value = true;
  try {
    const app = await createAdminApp();
    const result = await callAdminJob(app, "job.resume", { jobId: corrJobId.value, reason: corrReason.value });
    corrView.value = JSON.stringify(result, null, 2);
    corrStatusText.value = result.ok ? "已请求恢复。请再读进度。" : `恢复失败：${result.error?.code}`;
  } finally {
    busy.value = false;
  }
}

async function withdrawPaper(): Promise<void> {
  if (!pPaperId.value) {
    setPaperStatus("还没有已保存的试卷，不能撤回。");
    return;
  }
  busy.value = true;
  setPaperStatus("正在紧急撤回…");
  try {
    const result = await runPaper("paper.withdraw", {
      paperId: pPaperId.value,
      expectedRevision: pRevision.value,
      reason: pWithdrawReason.value
    });
    if (result.ok) {
      applyPaperView(result.data || {});
      if (pActiveVersionId.value && !pFromVersionId.value) pFromVersionId.value = pActiveVersionId.value;
      await refreshPaperList({ manageBusy: false });
    }
    setPaperStatus(result.ok ? "已紧急撤回，未提交不可交卷" : `撤回失败：${result.error?.code}`);
  } finally {
    busy.value = false;
  }
}

async function readPublishedSnapshot(): Promise<void> {
  if (!pPaperId.value) {
    setPaperStatus("还没有已保存的试卷，不能读快照。");
    return;
  }
  busy.value = true;
  try {
    const result = await runPaper("paper.get", { paperId: pPaperId.value, ...(pActiveVersionId.value ? { versionId: pActiveVersionId.value } : {}) });
    if (result.ok) {
      applyPaperView(result.data || {});
      const version = (result.data as { version?: { chunkIds?: string[]; answerChunkIds?: string[] } })?.version;
      for (const id of version?.chunkIds || []) rememberId(knownChunks, id);
      for (const id of version?.answerChunkIds || []) rememberId(knownAnswers, id);
    }
    const preview = await runPaper("paper.preview", { paperId: pPaperId.value });
    pPreview.value = JSON.stringify(preview.data || preview.error || {}, null, 2);
    setPaperStatus(result.ok ? "已读取发布快照。改题后这里应仍是旧题面。" : `读取失败：${result.error?.code}`);
  } finally {
    busy.value = false;
  }
}

async function copyPaperEvidence(): Promise<void> {
  const parsed = pEvidence.value ? JSON.parse(pEvidence.value) : { steps: [] };
  parsed.knownIds = {
    papers: await Promise.all(knownPapers.value.map((id) => hashText(id))),
    versions: await Promise.all(knownPaperVersions.value.map((id) => hashText(id))),
    chunks: await Promise.all(knownChunks.value.map((id) => hashText(id))),
    answers: await Promise.all(knownAnswers.value.map((id) => hashText(id))),
    questions: await Promise.all(knownQuestions.value.map((id) => hashText(id))),
    questionVersions: await Promise.all(knownVersions.value.map((id) => hashText(id))),
    assets: await Promise.all(knownAssets.value.map((id) => hashText(id))),
    previews: await Promise.all(knownCorrectionPreviews.value.map((id) => hashText(id))),
    work: await Promise.all(knownCorrectionWork.value.map((id) => hashText(id))),
    idempotency: [],
    audits: []
  };
  parsed.summary = {
    paperIdHashed: pPaperId.value ? await hashText(pPaperId.value) : "",
    status: pStatus.value,
    revision: pRevision.value,
    questionCount: pQuestionCount.value,
    maxScore: pMaxScore.value
  };
  const text = JSON.stringify(parsed, null, 2);
  pEvidence.value = text;
  void navigator.clipboard?.writeText(text);
  setPaperStatus("已复制试卷脱敏 knownIds。不要发送密码、环境 ID 或明文 _id。");
}

function downloadText(name: string, text: string): void {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadQuestionTemplate(): void {
  downloadText("mw12-question-template.csv", questionTemplateCsv());
  iStatus.value = "已下载题库模板。把「请填入已有类目标识」换成上方类目树里的真实类目 ID。样例是虚构的。";
}

function downloadPaperTemplate(): void {
  downloadText("mw12-paper-template.csv", paperTemplateCsv());
  iStatus.value = "已下载试卷模板。试卷只能引用已经导入并 committed 的题目来源键。";
}

function downloadFilledSamples(): void {
  const category = qCategoryId.value || selectedId.value;
  if (!category) {
    iStatus.value = "请先在类目树点选一个节点，再生成带类目 ID 的虚构样例。";
    return;
  }
  downloadText("mw12-question-sample.csv", questionTemplateCsv().replace(/请填入已有类目标识/g, category));
  downloadText("mw12-paper-sample.csv", paperTemplateCsv().replace(/请填入已有类目标识/g, category));
  iStatus.value = "已下载虚构题库与试卷样例。不要导入真实会员或真实题。";
}

function recordImportEvidence(action: string, result: AdminCallResult, extra: Record<string, unknown> = {}): void {
  const data = result.data || {};
  const row = {
    action,
    ok: result.ok === true,
    errorCode: result.error?.code || "",
    errorReason: result.error?.details?.reason || result.error?.message || "",
    batchState: data.state || extra.state || "",
    originalBatch: data.originalBatch === true,
    rowCount: data.rowCount,
    errorCount: data.errorCount
  };
  const parsed = iEvidence.value ? JSON.parse(iEvidence.value) : { steps: [] };
  parsed.steps.push(row);
  iEvidence.value = JSON.stringify(parsed, null, 2);
}

async function runImport(
  action: "import.validate" | "import.preview" | "import.commit" | "import.status",
  data: Record<string, unknown>
): Promise<AdminCallResult> {
  const app = await createAdminApp();
  const result = await callAdminImport(app, action, data);
  lastError.value = result.ok ? "" : result.error?.code || "CALL_FAILED";
  recordImportEvidence(action, result, data);
  if (typeof result.data?.batchId === "string") {
    iBatchId.value = result.data.batchId;
    rememberId(knownBatches, result.data.batchId);
  }
  if (typeof result.data?.state === "string") iBatchState.value = result.data.state;
  const keys = Array.isArray(result.data?.sampleKeys) ? result.data.sampleKeys.filter((item): item is string => typeof item === "string") : [];
  if (keys.length) iSampleKeys.value = keys;
  iPreview.value = JSON.stringify(result.data || result.error || {}, null, 2);
  return result;
}

async function uploadImportFile(file: File | undefined): Promise<void> {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    iStatus.value = "超过 5 MB，整批拒绝。";
    lastError.value = "INVALID_ARGUMENT";
    return;
  }
  busy.value = true;
  try {
    const sha256 = await hashFile(file);
    const authorized = await runQuestion("upload.authorize", {
      purpose: "import",
      contentType: "text/csv",
      size: file.size,
      sha256,
      caption: iKind.value === "paper" ? "虚构试卷CSV" : "虚构题库CSV"
    });
    if (!authorized.ok || typeof authorized.data?.uploadTicket !== "string") {
      iStatus.value = `导入票据签发失败：${authorized.error?.code || ""}${authorized.error?.details?.reason ? " / " + authorized.error.details.reason : ""}`;
      return;
    }
    const uploadTicket = authorized.data.uploadTicket as string;
    const ticketId = typeof authorized.data.ticketId === "string" ? authorized.data.ticketId : "";
    iTicketId.value = ticketId;
    const app = await createAdminApp();
    const completed = await completeAdminUpload(app, {
      uploadTicket,
      sha256,
      size: file.size,
      fileBase64: await fileToBase64(file)
    });
    recordImportEvidence("mw-upload.complete", completed, { kind: iKind.value });
    if (!completed.ok) {
      iStatus.value = `导入文件上传失败：${completed.error?.code || ""}${completed.error?.details?.reason ? " / " + completed.error.details.reason : ""}`;
      return;
    }
    if (typeof authorized.data.assetId === "string") rememberId(knownAssets, authorized.data.assetId);
    iStatus.value = ticketId ? "文件已暂存，可点校验预览。明文票据不会写入证据。" : "上传完成但未返回 ticketId，请重试。";
    if (ticketId) {
      const validated = await runImport("import.validate", { kind: iKind.value, ticketId });
      iStatus.value = validated.ok
        ? `校验通过，状态 ${String(validated.data?.state || "")}。请再点预览并确认提交。`
        : `整批拒绝：${validated.error?.code || ""}${validated.error?.details?.reason ? " / " + validated.error.details.reason : validated.error?.message ? " / " + validated.error.message : ""}。半批不会作为有效题目出现。`;
    }
  } finally {
    busy.value = false;
  }
}

async function previewImportBatch(): Promise<void> {
  if (!iBatchId.value) {
    iStatus.value = "还没有批次。请先上传 CSV。";
    return;
  }
  busy.value = true;
  try {
    const result = await runImport("import.preview", { batchId: iBatchId.value });
    iStatus.value = result.ok ? `预览绑定摘要与类目版本。状态 ${String(result.data?.state || "")}` : `预览失败：${result.error?.code}`;
  } finally {
    busy.value = false;
  }
}

async function commitImportBatch(): Promise<void> {
  if (!iBatchId.value) {
    iStatus.value = "还没有可提交的批次。";
    return;
  }
  busy.value = true;
  try {
    const result = await runImport("import.commit", { batchId: iBatchId.value });
    iStatus.value = result.ok
      ? `已提交，状态 ${String(result.data?.state || "")}。committed 后才能按 ID 读到草稿。`
      : `提交失败：${result.error?.code || result.error?.details?.reason}`;
  } finally {
    busy.value = false;
  }
}

async function readImportStatus(): Promise<void> {
  if (!iBatchId.value) {
    iStatus.value = "还没有批次。";
    return;
  }
  busy.value = true;
  try {
    const result = await runImport("import.status", { batchId: iBatchId.value });
    iStatus.value = result.ok ? `批次状态 ${String(result.data?.state || "")}` : `状态读取失败：${result.error?.code}`;
  } finally {
    busy.value = false;
  }
}

async function readImportedDrafts(): Promise<void> {
  if (!iSampleKeys.value.length && iKind.value === "question") {
    iStatus.value = "请先预览以得到来源键，再按 ID 读取。";
    return;
  }
  busy.value = true;
  try {
    if (iKind.value === "question") {
      for (const key of iSampleKeys.value) {
        const questionId = questionIdForSourceKey(key);
        const result = await runQuestion("question.get", { questionId });
        if (result.ok) {
          const question = (result.data?.question || {}) as { questionId?: string; versionId?: string };
          if (question.questionId) rememberId(knownQuestions, question.questionId);
          if (question.versionId) rememberId(knownVersions, question.versionId);
        } else {
          iStatus.value = `按 ID 读取失败（未 committed 时应 NOT_FOUND）：${result.error?.code}`;
          return;
        }
      }
      iStatus.value = "已按 ID 读到导入草稿题。";
    } else {
      for (const key of iSampleKeys.value) {
        const paperId = paperIdForSourceKey(key);
        const result = await runPaper("paper.get", { paperId });
        if (result.ok) {
          const paper = (result.data?.paper || {}) as { paperId?: string };
          if (paper.paperId) rememberId(knownPapers, paper.paperId);
        } else {
          iStatus.value = `按 ID 读取试卷失败（未 committed 时应 NOT_FOUND）：${result.error?.code}`;
          return;
        }
      }
      iStatus.value = "已按 ID 读到导入草稿试卷。";
    }
  } finally {
    busy.value = false;
  }
}

async function copyImportEvidence(): Promise<void> {
  const parsed = iEvidence.value ? JSON.parse(iEvidence.value) : { steps: [] };
  parsed.knownIds = {
    batches: await Promise.all(knownBatches.value.map((id) => hashText(id))),
    rows: await Promise.all(knownImportRows.value.map((id) => hashText(id))),
    sourceKeys: await Promise.all(knownSourceKeys.value.map((id) => hashText(id))),
    questions: await Promise.all(knownQuestions.value.map((id) => hashText(id))),
    questionVersions: await Promise.all(knownVersions.value.map((id) => hashText(id))),
    papers: await Promise.all(knownPapers.value.map((id) => hashText(id))),
    assets: await Promise.all(knownAssets.value.map((id) => hashText(id))),
    idempotency: [],
    audits: []
  };
  parsed.summary = {
    batchState: iBatchState.value,
    kind: iKind.value,
    sampleKeyCount: iSampleKeys.value.length
  };
  const text = JSON.stringify(parsed, null, 2);
  iEvidence.value = text;
  void navigator.clipboard?.writeText(text);
  iStatus.value = "已复制 SHA-256 knownIds。不要发送密码、环境 ID 或明文 _id。";
}

async function runGrowth(action: AdminGrowthAction, data: Record<string, unknown>): Promise<AdminCallResult> {
  const app = await createAdminApp();
  const result = await callAdminGrowth(app, action, data);
  const parsed = gEvidence.value ? JSON.parse(gEvidence.value) : { steps: [] };
  const body = result.data || {};
  parsed.steps.push({
    action,
    ok: result.ok === true,
    errorCode: result.error?.code || "",
    errorReason: result.error?.details?.reason || "",
    configVersion: body.configVersion ?? (body.config as { configVersion?: number } | undefined)?.configVersion ?? null,
    wroteDocs: body.wroteDocs === undefined ? action !== "growth.preview" : body.wroteDocs,
    affected: body.affected ?? null,
    upgraded: body.upgraded ?? null,
    downgraded: body.downgraded ?? null,
    medalsToGrant: body.medalsToGrant ?? null,
    truncated: body.truncated ?? null
  });
  gEvidence.value = JSON.stringify(parsed, null, 2);
  return result;
}

function levelRows(input: unknown): Record<string, unknown>[] {
  if (!Array.isArray(input)) return [];
  return input.filter((row) => row && typeof row === "object") as Record<string, unknown>[];
}

function issueText(details: unknown): string {
  const issues = (details as { issues?: unknown } | undefined)?.issues;
  return Array.isArray(issues) ? issues.map((item) => String(item)).join(" ") : "";
}

async function loadGrowthConfig(): Promise<void> {
  busy.value = true;
  gStatus.value = "正在读取等级配置…";
  try {
    const result = await runGrowth("growth.config", {});
    if (!result.ok) {
      gStatus.value = `读取失败：${result.error?.code || "CALL_FAILED"} ${result.error?.details?.reason || ""}`;
      return;
    }
    const config = (result.data?.config || {}) as { configVersion?: number; levels?: unknown };
    gConfigVersion.value = typeof config.configVersion === "number" ? config.configVersion : null;
    gConfigSource.value = String(result.data?.source || "");
    gLevelsText.value = JSON.stringify(levelRows(config.levels).map((row) => ({
      levelId: row.levelId,
      name: row.name,
      minScore: row.minScore,
      medalId: row.medalId,
      medalName: row.medalName
    })), null, 2);
    gStatus.value = `已读取。configVersion=${gConfigVersion.value} · 来源=${gConfigSource.value}。预览不写库；发布需 super。`;
  } catch {
    gStatus.value = "读取等级配置失败";
  } finally {
    busy.value = false;
  }
}

function parseLevelsText(): { ok: true; levels: unknown[] } | { ok: false; reason: string } {
  try {
    const parsed = JSON.parse(gLevelsText.value || "[]");
    if (!Array.isArray(parsed)) return { ok: false, reason: "NOT_ARRAY" };
    return { ok: true, levels: parsed };
  } catch {
    return { ok: false, reason: "NOT_JSON" };
  }
}

/** 本地预检：与共享层同一套规则的友好提示，避免把明显非法的门槛发到服务端。 */
function localLevelIssues(levels: unknown[]): string[] {
  const rows = levelRows(levels);
  const issues: string[] = [];
  if (!rows.length) return ["门槛不能为空"];
  const first = rows[0];
  if (!first || Number(first.minScore) !== 0) issues.push("第一级门槛必须是 0");
  const levelIds = new Set<string>();
  const medalIds = new Set<string>();
  rows.forEach((row, index) => {
    const levelId = String(row.levelId || "");
    const medalId = String(row.medalId || "");
    if (levelId && levelIds.has(levelId)) issues.push(`levelId 重复：${levelId}`);
    levelIds.add(levelId);
    if (medalId && medalIds.has(medalId)) issues.push(`medalId 重复：${medalId}`);
    medalIds.add(medalId);
    if (!String(row.name || "").trim()) issues.push(`第 ${index + 1} 级缺名称`);
    if (!String(row.medalName || "").trim()) issues.push(`第 ${index + 1} 级缺勋章名`);
    const previous = index > 0 ? rows[index - 1] : undefined;
    if (previous && Number(row.minScore) <= Number(previous.minScore)) {
      issues.push(`门槛必须严格递增：第 ${index + 1} 级 ${Number(row.minScore)} 不大于上一级 ${Number(previous.minScore)}`);
    }
  });
  return [...new Set(issues)];
}

/**
 * 本地预检只做提示：默认不发送明显非法的门槛；
 * 需要核对服务端拒绝路径（负向核验）时，点「确定」仍会发送，由服务端给出 INVALID_ARGUMENT。
 */
function confirmSendInvalid(issues: string[]): boolean {
  if (!issues.length) return true;
  const proceed = window.confirm(`本地预检发现问题：\n- ${issues.join("\n- ")}\n\n仍要发送给服务端验证拒绝路径吗？（确定=发送，取消=不发送）`);
  if (!proceed) {
    gImpact.value = "";
    gStatus.value = `门槛不合法，未发送：${issues.join("；")}`;
  }
  return proceed;
}

/** 快速填充门槛，避免手改 JSON 出错。只改浏览器里的文本，不写库。 */
function fillLevels(mode: "crossLevel" | "raise" | "invalidFirst" | "missingMedal"): void {
  const parsed = parseLevelsText();
  if (!parsed.ok) {
    gStatus.value = "门槛 JSON 当前无法解析：先点「读取当前等级配置」再填充。";
    return;
  }
  const rows = levelRows(parsed.levels).map((row) => ({ ...row }));
  const first = rows[0];
  const second = rows[1];
  const third = rows[2];
  if (!first || !second || !third) {
    gStatus.value = "门槛行数不足，先点「读取当前等级配置」。";
    return;
  }
  if (mode === "crossLevel") {
    second.minScore = 5;
    third.minScore = 8;
    gStatus.value = "已填入跨级核对门槛（L2=5、L3=8）。先「预览影响（不写库）」，确认后再「发布门槛并重算」。";
  } else if (mode === "raise") {
    // 门槛必须严格递增：只抬 L2 会把 L3 压在下面，服务端会拒 LEVEL_MIN_NOT_INCREASING。
    let previous = 0;
    rows.forEach((row, index) => {
      const recommended = RECOMMENDED_MIN_SCORES[index];
      const next = index === 0 ? 0 : typeof recommended === "number" ? recommended : previous + 1000;
      previous = next;
      row.minScore = next;
    });
    gStatus.value = "已填入提高后的门槛（建议值 0/100/300/800/1500/3000，整体不低于上一级）。先预览应显示降级，再发布；发布后既得勋章不应消失。";
  } else if (mode === "invalidFirst") {
    first.minScore = 10;
    gStatus.value = "已填入非法门槛（首级不是 0）。发布应被拒 INVALID_ARGUMENT，configVersion 不得变化。";
  } else {
    second.medalName = "";
    gStatus.value = "已填入缺勋章名的门槛。发布应被拒 INVALID_ARGUMENT。";
  }
  gLevelsText.value = JSON.stringify(rows, null, 2);
}

async function previewGrowth(): Promise<void> {
  const parsed = parseLevelsText();
  if (!parsed.ok) {
    gStatus.value = `门槛 JSON 无法解析：${parsed.reason}`;
    return;
  }
  if (!confirmSendInvalid(localLevelIssues(parsed.levels))) return;
  busy.value = true;
  try {
    const result = await runGrowth("growth.preview", { levels: parsed.levels });
    if (!result.ok) {
      gImpact.value = "";
      gStatus.value = `预览被拒：${result.error?.code || "CALL_FAILED"} ${result.error?.details?.reason || ""} ${issueText(result.error?.details)}`;
      return;
    }
    const data = (result.data || {}) as Record<string, unknown>;
    gImpact.value = JSON.stringify(data, null, 2);
    const transitions = Array.isArray(data.byTransition)
      ? (data.byTransition as Array<{ fromLevelId?: string; toLevelId?: string; count?: number }>)
          .map((row) => `${row.fromLevelId}→${row.toLevelId}:${row.count}`)
          .join(" ")
      : "";
    gStatus.value = `预览完成（未写库，configVersion 仍是 ${gConfigVersion.value ?? "未读取"}）：扫描 ${data.scannedMembers ?? "?"} 人，影响 ${data.affected ?? "?"}，升级 ${data.upgraded ?? "?"}，降级 ${data.downgraded ?? "?"}，待补发勋章 ${data.medalsToGrant ?? "?"}。扫描上限 ${data.scanLimit ?? "?"}${data.truncated ? "（已截断，数字不是全集）" : ""}${transitions ? ` · 迁移 ${transitions}` : ""}`;
  } catch {
    gStatus.value = "预览失败";
  } finally {
    busy.value = false;
  }
}

async function publishGrowth(): Promise<void> {
  const parsed = parseLevelsText();
  if (!parsed.ok) {
    gStatus.value = `门槛 JSON 无法解析：${parsed.reason}`;
    return;
  }
  if (!confirmSendInvalid(localLevelIssues(parsed.levels))) return;
  busy.value = true;
  try {
    const result = await runGrowth("growth.publish", {
      levels: parsed.levels,
      reason: gReason.value,
      expectedConfigVersion: gConfigVersion.value ?? 0
    });
    if (!result.ok) {
      gStatus.value = `发布被拒：${result.error?.code || "CALL_FAILED"} ${result.error?.details?.reason || ""} ${issueText(result.error?.details)}`;
      if (result.error?.code === "VERSION_CONFLICT") gStatus.value += "。请重新读取配置后再发。";
      return;
    }
    const config = (result.data?.config || {}) as { configVersion?: number };
    const recompute = (result.data?.recompute || {}) as Record<string, unknown>;
    const responseVersion = typeof config.configVersion === "number" ? config.configVersion : null;
    gConfigVersion.value = responseVersion ?? gConfigVersion.value;
    // 以云端回读为准确认落库；发布响应版本与回读不一致时不得当作成功。
    await loadGrowthConfig();
    const cloudVersion = gConfigVersion.value;
    const head =
      responseVersion !== null && cloudVersion === responseVersion
        ? `已发布且云端回读一致：configVersion=${cloudVersion}`
        : `发布响应版本 ${responseVersion ?? "?"} 与云端回读 ${cloudVersion ?? "?"} 不一致，请重新读取配置后再试`;
    gStatus.value = `${head}（本次提交版本 ${responseVersion ?? "?"}）。按现有总分重算 ${recompute.recomputed ?? "?"} 人，等级变化 ${recompute.levelChanged ?? "?"}，补发勋章 ${recompute.medalsGranted ?? "?"}${recompute.truncated ? "（重算首批已截断，可再点按当前门槛重算）" : ""}。既得勋章不删除。`;
  } catch {
    gStatus.value = "发布失败";
  } finally {
    busy.value = false;
  }
}

async function recomputeGrowthLevels(): Promise<void> {
  busy.value = true;
  try {
    const data: Record<string, unknown> = { limit: 200 };
    if (gMemberId.value.trim()) data.targetMemberId = gMemberId.value.trim();
    const result = await runGrowth("growth.recompute", data);
    if (!result.ok) {
      gStatus.value = `重算被拒：${result.error?.code || "CALL_FAILED"} ${result.error?.details?.reason || ""}`;
      return;
    }
    const recompute = (result.data?.recompute || {}) as Record<string, unknown>;
    gStatus.value = `按当前门槛（configVersion=${result.data?.configVersion}）重算 ${recompute.recomputed ?? 0} 人，等级变化 ${recompute.levelChanged ?? 0}，补发勋章 ${recompute.medalsGranted ?? 0}。重复执行不会额外写入。`;
  } catch {
    gStatus.value = "重算失败";
  } finally {
    busy.value = false;
  }
}

function copyGrowthEvidence(): void {
  const parsed = gEvidence.value ? JSON.parse(gEvidence.value) : { steps: [] };
  parsed.summary = {
    configVersion: gConfigVersion.value,
    configSource: gConfigSource.value,
    wroteDocs: true,
    exactIdSweepOnly: true
  };
  const text = JSON.stringify(parsed, null, 2);
  gEvidence.value = text;
  void navigator.clipboard?.writeText(text);
  gStatus.value = "已复制等级配置证据。不要发送密码、环境 ID 或明文 _id。";
}

async function runVip(action: AdminVipAction, data: Record<string, unknown>): Promise<AdminCallResult> {
  const app = await createAdminApp();
  const result = await callAdminVip(app, action, data);
  const parsed = vEvidence.value ? JSON.parse(vEvidence.value) : { steps: [] };
  parsed.steps.push({
    action,
    ok: result.ok === true,
    errorCode: result.error?.code || "",
    errorReason: result.error?.details?.reason || "",
    sourceType: result.data?.sourceType || "gift",
    sourceId: result.data?.sourceId || "",
    grantIdHash: result.data?.grantId ? await hashText(String(result.data.grantId)) : "",
    active: result.data?.active === true,
    expiresAt: result.data?.expiresAt || null,
    revokedSeconds: result.data?.revokedSeconds ?? null
  });
  vEvidence.value = JSON.stringify(parsed, null, 2);
  return result;
}

function vipGrantPayload(): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    targetMemberId: vMemberId.value.trim(),
    reason: vReason.value.trim()
  };
  if (vSourceId.value.trim()) payload.sourceId = vSourceId.value.trim();
  const seconds = Number(vDurationSeconds.value);
  if (vDurationSeconds.value.trim() && Number.isInteger(seconds) && seconds > 0) {
    payload.durationSeconds = seconds;
    return payload;
  }
  payload.durationDays = Number(vDurationDays.value) || 1;
  return payload;
}

async function grantVip(): Promise<void> {
  if (!vReason.value.trim()) {
    vStatus.value = "赠送必须填写原因。";
    return;
  }
  busy.value = true;
  vStatus.value = "正在赠送…";
  try {
    const result = await runVip("vip.grant", vipGrantPayload());
    if (!result.ok) {
      vStatus.value = `赠送被拒：${result.error?.code || "CALL_FAILED"} ${result.error?.details?.reason || ""}`;
      return;
    }
    vLastGrantId.value = String(result.data?.grantId || "");
    vLastSourceId.value = String(result.data?.sourceId || vSourceId.value.trim());
    vStatus.value = `已赠送。sourceType=gift · sourceId=${result.data?.sourceId || ""} · 有效=${result.data?.active === true} · 到期=${result.data?.expiresAt || "无"}。未写订单。`;
  } catch {
    vStatus.value = "赠送失败";
  } finally {
    busy.value = false;
  }
}

async function revokeVip(): Promise<void> {
  if (!vReason.value.trim() || !vSourceId.value.trim()) {
    vStatus.value = "撤销必须填写原因和 sourceId。";
    return;
  }
  busy.value = true;
  vStatus.value = "正在撤销未用赠送…";
  try {
    const result = await runVip("vip.revokeGift", {
      targetMemberId: vMemberId.value.trim(),
      sourceId: vSourceId.value.trim(),
      reason: vReason.value.trim()
    });
    if (!result.ok) {
      vStatus.value = `撤销被拒：${result.error?.code || "CALL_FAILED"} ${result.error?.details?.reason || ""}`;
      return;
    }
    vStatus.value = `已撤销未用 ${result.data?.revokedSeconds ?? 0} 秒。有效=${result.data?.active === true} · 到期=${result.data?.expiresAt || "无"}。`;
  } catch {
    vStatus.value = "撤销失败";
  } finally {
    busy.value = false;
  }
}

async function copyVipLeftover(): Promise<void> {
  const members = vMemberId.value.trim() ? [await hashText(vMemberId.value.trim())] : [];
  const grants = vLastGrantId.value ? [await hashText(vLastGrantId.value)] : [];
  const sourceIds = vLastSourceId.value || vSourceId.value.trim() ? [await hashText(vLastSourceId.value || vSourceId.value.trim())] : [];
  const payload = { members, grants, sourceIds, papers: [], attempts: [] };
  const text = JSON.stringify(payload);
  vEvidence.value = JSON.stringify({ knownIds: payload, note: "只入册本轮赠送与测试对象" }, null, 2);
  void navigator.clipboard?.writeText(text);
  vStatus.value = "已复制本轮 VIP leftover knownIds（SHA-256）。不要发送明文 memberId。";
}

function planPayload(): Record<string, unknown> {
  return {
    planId: planId.value.trim(),
    planVersion: Number(planVersion.value) || 1,
    title: planTitle.value.trim(),
    durationDays: Number(planDays.value) || 30,
    priceFen: Number(planPriceFen.value) || 9900,
    productIds: { android: planProductAndroid.value.trim() },
    channels: ["android"],
    testOnly: true,
    reason: planReason.value.trim()
  };
}

async function runPlan(action: AdminPlanAction, data: Record<string, unknown>): Promise<AdminCallResult> {
  const app = await createAdminApp();
  const result = await callAdminPlan(app, action, data);
  const parsed = planEvidence.value ? JSON.parse(planEvidence.value) : { steps: [] };
  parsed.steps.push({
    action,
    ok: result.ok === true,
    errorCode: result.error?.code || "",
    errorReason: result.error?.details?.reason || "",
    planId: result.data?.planId || data.planId,
    planVersion: result.data?.planVersion || data.planVersion,
    enabled: result.data?.enabled ?? null
  });
  planEvidence.value = JSON.stringify(parsed, null, 2);
  return result;
}

async function publishTestPlan(): Promise<void> {
  busy.value = true;
  planStatus.value = "正在发布测试套餐…";
  try {
    const result = await runPlan("plan.publish", planPayload());
    if (!result.ok) {
      planStatus.value = `发布被拒：${result.error?.code || "CALL_FAILED"} ${result.error?.details?.reason || ""}`;
      return;
    }
    lastPlanIds.value = [
      ...new Set([
        ...lastPlanIds.value,
        planDocId(String(result.data?.planId || planId.value), Number(result.data?.planVersion || planVersion.value) || 1)
      ])
    ];
    planStatus.value = `已发布测试套餐 ${result.data?.planId} v${result.data?.planVersion}。测试价非正式售价。`;
  } catch {
    planStatus.value = "发布失败";
  } finally {
    busy.value = false;
  }
}

async function listPlans(): Promise<void> {
  busy.value = true;
  try {
    const result = await runPlan("plan.list", {});
    planStatus.value = result.ok ? `已读取 ${Array.isArray(result.data?.items) ? result.data.items.length : 0} 个套餐版本。` : `读取失败：${result.error?.code || ""}`;
  } finally {
    busy.value = false;
  }
}

async function leftoverPayload(): Promise<{
  plans: string[];
  orders: string[];
  refunds: string[];
  members: string[];
  papers: string[];
  attempts: string[];
  feedbacks: string[];
}> {
  const plans = await Promise.all(lastPlanIds.value.map((id) => hashText(id)));
  const orders = await Promise.all(lastOrderIds.value.map((id) => hashText(id)));
  const refunds = await Promise.all(lastRefundIds.value.map((id) => hashText(id)));
  const feedbacks = await Promise.all(lastFeedbackIds.value.map((id) => hashText(id)));
  return { plans, orders, refunds, members: [], papers: [], attempts: [], feedbacks };
}

async function copyPlanLeftover(): Promise<void> {
  const payload = await leftoverPayload();
  const text = JSON.stringify(payload);
  planEvidence.value = JSON.stringify({ knownIds: payload, note: "只入册本轮测试套餐与订单哈希" }, null, 2);
  void navigator.clipboard?.writeText(text);
  planStatus.value = "已复制本轮套餐 leftover 哈希。";
}

async function runOrder(action: AdminOrderAction, data: Record<string, unknown>): Promise<AdminCallResult> {
  const app = await createAdminApp();
  const result = await callAdminOrder(app, action, data);
  const parsed = orderEvidence.value ? JSON.parse(orderEvidence.value) : { steps: [] };
  parsed.steps.push({
    action,
    ok: result.ok === true,
    errorCode: result.error?.code || "",
    errorReason: result.error?.details?.reason || "",
    orderId: result.data?.orderId || data.orderId,
    payState: result.data?.payState || null,
    grantState: result.data?.grantState || null
  });
  orderEvidence.value = JSON.stringify(parsed, null, 2);
  if (result.data?.orderId) lastOrderIds.value = [...new Set([...lastOrderIds.value, String(result.data.orderId)])];
  return result;
}

async function listMemberOrders(): Promise<void> {
  busy.value = true;
  try {
    const result = await runOrder("order.list", { memberId: orderMemberId.value.trim() });
    orderStatus.value = result.ok ? `已读取本人以外指定会员订单 ${Array.isArray(result.data?.items) ? result.data.items.length : 0} 条。` : `读取失败：${result.error?.code || ""} ${result.error?.details?.reason || ""}`;
  } finally {
    busy.value = false;
  }
}

async function reconcileOrder(): Promise<void> {
  busy.value = true;
  try {
    const result = await runOrder("order.reconcile", { orderId: orderId.value.trim() });
    orderStatus.value = result.ok
      ? `核对 ${result.data?.payState} / ${result.data?.grantState}。同一订单补偿不会重复延长。`
      : `核对失败：${result.error?.code || ""} ${result.error?.details?.reason || ""}`;
  } finally {
    busy.value = false;
  }
}

async function copyOrderLeftover(): Promise<void> {
  const payload = await leftoverPayload();
  const text = JSON.stringify(payload);
  orderEvidence.value = JSON.stringify({ knownIds: payload, note: "只入册本轮订单、退款与套餐哈希" }, null, 2);
  void navigator.clipboard?.writeText(text);
  orderStatus.value = "已复制本轮订单 leftover 哈希。";
}

async function runRefund(action: AdminRefundAction, data: Record<string, unknown>): Promise<AdminCallResult> {
  const app = await createAdminApp();
  const result = await callAdminRefund(app, action, data);
  const parsed = refundEvidence.value ? JSON.parse(refundEvidence.value) : { steps: [] };
  parsed.steps.push({
    action,
    ok: result.ok === true,
    errorCode: result.error?.code || "",
    errorReason: result.error?.details?.reason || "",
    refundId: result.data?.refundId || "",
    state: result.data?.state || null,
    kind: result.data?.kind || null,
    merchantRefundSupported: result.data?.merchantRefundSupported,
    revokedSeconds: result.data?.revokedSeconds ?? null
  });
  refundEvidence.value = JSON.stringify(parsed, null, 2);
  if (result.data?.refundId) lastRefundIds.value = [...new Set([...lastRefundIds.value, String(result.data.refundId)])];
  const leftover = result.data?.leftover as { orders?: unknown[] } | undefined;
  if (Array.isArray(leftover?.orders)) {
    lastOrderIds.value = [...new Set([...lastOrderIds.value, ...leftover.orders.map((id) => String(id))])];
  }
  const keepB = result.data?.keepB as
    | { orderA?: string; orderB?: string; remainingASeconds?: number; remainingBSeconds?: number }
    | undefined;
  if (keepB?.orderA) lastOrderIds.value = [...new Set([...lastOrderIds.value, String(keepB.orderA), String(keepB.orderB || "")])];
  if (result.data?.orderId) lastOrderIds.value = [...new Set([...lastOrderIds.value, String(result.data.orderId)])];
  return result;
}

async function prepareRefundFixture(): Promise<void> {
  busy.value = true;
  try {
    const result = await runRefund("refund.fixturePrepare", {
      targetMemberId: refundMemberId.value.trim(),
      reason: refundReason.value.trim() || "MW22 测试夹具"
    });
    refundView.value = JSON.stringify(result.data || result.error, null, 2);
    const keepB = result.data?.keepB as
      | { orderA?: string; remainingASeconds?: number; remainingBSeconds?: number }
      | undefined;
    refundStatus.value = result.ok
      ? `已构造测试夹具（非正式售价、非渠道成功骗发放）。A 余 ${keepB?.remainingASeconds || 0} 秒 / B 余 ${keepB?.remainingBSeconds || 0} 秒。Apple 无商户退款。`
      : `夹具失败：${result.error?.code || ""} ${result.error?.details?.reason || ""}`;
    if (keepB?.orderA) refundOrderId.value = String(keepB.orderA);
  } finally {
    busy.value = false;
  }
}

async function listRefunds(): Promise<void> {
  busy.value = true;
  try {
    const result = await runRefund("refund.list", {});
    refundView.value = JSON.stringify(result.data || result.error, null, 2);
    refundStatus.value = result.ok
      ? `已读取退款申请 ${Array.isArray(result.data?.items) ? result.data.items.length : 0} 条。`
      : `读取失败：${result.error?.code || ""} ${result.error?.details?.reason || ""}`;
  } finally {
    busy.value = false;
  }
}

async function reviewRefund(): Promise<void> {
  busy.value = true;
  try {
    const result = await runRefund("refund.review", {
      orderId: refundOrderId.value.trim(),
      advice: refundAdvice.value.trim(),
      reason: refundReason.value.trim()
    });
    refundView.value = JSON.stringify(result.data || result.error, null, 2);
    refundStatus.value = result.ok
      ? `已写入审核建议。不能发起渠道退款。state=${result.data?.state || ""}`
      : `审核失败：${result.error?.code || ""} ${result.error?.details?.reason || ""}`;
  } finally {
    busy.value = false;
  }
}

async function executeRefund(): Promise<void> {
  busy.value = true;
  try {
    const result = await runRefund("refund.execute", {
      orderId: refundOrderId.value.trim(),
      amountFen: Number(refundAmountFen.value) || 0,
      reason: refundReason.value.trim()
    });
    refundView.value = JSON.stringify(result.data || result.error, null, 2);
    if (result.data?.merchantRefundSupported === false) {
      refundStatus.value = `Apple/iOS 无商户退款按钮对应的 execute：${result.error?.details?.reason || result.data?.appleGuidance || "MERCHANT_REFUND_UNSUPPORTED"}`;
    } else {
      refundStatus.value = result.ok
        ? `已绑定申请与金额。state=${result.data?.state || ""} kind=${result.data?.kind || ""}。未真实退款。未知结果不新建退款单。`
        : `执行失败：${result.error?.code || ""} ${result.error?.details?.reason || ""}`;
    }
  } finally {
    busy.value = false;
  }
}

async function recordRefundChannel(): Promise<void> {
  busy.value = true;
  try {
    const result = await runRefund("refund.recordChannelResult", {
      orderId: refundOrderId.value.trim(),
      outcome: refundOutcome.value,
      confirmedFen: Number(refundAmountFen.value) || undefined,
      eventKey: `mw22-sandbox-${refundOrderId.value.trim()}`,
      reason: refundReason.value.trim() || "sandbox channel result"
    });
    refundView.value = JSON.stringify(result.data || result.error, null, 2);
    refundStatus.value = result.ok
      ? `已录入渠道最终结果（测试夹具，非现网退款）。state=${result.data?.state || ""} revokedSeconds=${result.data?.revokedSeconds ?? ""} replayed=${result.replayed === true}`
      : `录入失败：${result.error?.code || ""} ${result.error?.details?.reason || ""}`;
  } finally {
    busy.value = false;
  }
}

async function listReconcileDiffs(): Promise<void> {
  busy.value = true;
  try {
    const result = await runOrder("order.reconcile", refundOrderId.value.trim() ? { orderId: refundOrderId.value.trim() } : {});
    refundView.value = JSON.stringify(result.data || result.error, null, 2);
    refundStatus.value = result.ok
      ? `日账差异 ${Array.isArray(result.data?.diffs) ? result.data.diffs.length : 0} 条。amountFenUnchanged=${result.data?.amountFenUnchanged === true}`
      : `对账失败：${result.error?.code || ""} ${result.error?.details?.reason || ""}`;
  } finally {
    busy.value = false;
  }
}

async function copyRefundLeftover(): Promise<void> {
  const payload = await leftoverPayload();
  const text = JSON.stringify(payload);
  refundEvidence.value = JSON.stringify({ knownIds: payload, note: "只入册本轮退款单/测试订单/order 来源账本哈希" }, null, 2);
  void navigator.clipboard?.writeText(text);
  refundStatus.value = "已复制本轮退款 leftover 哈希。";
}

async function runRanking(action: AdminRankingAction, data: Record<string, unknown>): Promise<AdminCallResult> {
  const app = await createAdminApp();
  const result = await callAdminRanking(app, action, data);
  const parsed = rEvidence.value ? JSON.parse(rEvidence.value) : { steps: [] };
  const body = result.data || {};
  parsed.steps.push({
    action,
    ok: result.ok === true,
    errorCode: result.error?.code || "",
    errorReason: result.error?.details?.reason || "",
    publishedGeneration: body.publishedGeneration ?? body.generation ?? null,
    publishedAt: body.publishedAt ?? null,
    refreshStatus: (body.refresh as { status?: string } | undefined)?.status ?? null,
    rowCount: body.rowCount ?? null,
    rowCounts: body.rowCounts ?? null,
    historyGapMembers: body.historyGapMembers ?? null,
    historyGapScore: body.historyGapScore ?? null,
    truncated: body.truncated ?? null,
    replayed: body.replayed ?? null
  });
  rEvidence.value = JSON.stringify(parsed, null, 2);
  return result;
}

function rankingStatusView(body: Record<string, unknown>): string {
  const refresh = (body.refresh || {}) as Record<string, unknown>;
  const rows = (body.rowCounts || {}) as Record<string, unknown>;
  const gap = body.historyGapMembers === undefined ? "-" : String(body.historyGapMembers);
  const gapScore = body.historyGapScore === undefined ? "-" : String(body.historyGapScore);
  return [
    `快照运行状态：${String(refresh.status || "unknown")}`,
    `已发布代：${String(body.publishedGeneration || "（从未发布）")}`,
    `更新时间（真实构建时间）：${String(body.publishedAt || "（无）")}`,
    `待刷新请求时间：${String(body.requestedAt || "（无）")}`,
    `重建进行中标记：${String(body.buildingSince || "（无）")}`,
    `刷新目标：${String(refresh.targetMs || 60000)} ms · 已滞后：${String(refresh.lagMs ?? "-")} ms · 待刷新时长：${String(refresh.pendingMs ?? "-")} ms`,
    `上次构建：${body.lastBuildOk === true ? "成功" : "未成功/未执行"} ${String(body.lastBuildError || "")}`.trim(),
    `榜单数：${String(body.boardCount ?? 0)} · 名次行：${String(body.rowCount ?? 0)}`,
    `各 scope 行数：total=${String(rows.total ?? 0)} category=${String(rows.category ?? 0)} week=${String(rows.week ?? 0)} month=${String(rows.month ?? 0)}`,
    `历史缺口：${gap} 位会员 / ${gapScore} 分未纳入可追溯榜值（已确认不补记）`,
    `采样是否截断：${body.truncated === true ? "是" : "否"}`
  ].join("\n");
}

async function loadRankingStatus(): Promise<void> {
  busy.value = true;
  rStatus.value = "正在读取榜单快照状态…";
  try {
    const result = await runRanking("ranking.status", {});
    if (!result.ok) {
      rStatus.value = `读取失败：${result.error?.code || "CALL_FAILED"} ${result.error?.details?.reason || ""}`;
      return;
    }
    rView.value = rankingStatusView(result.data || {});
    rStatus.value = "已读取榜单快照状态。本页显示的时间都是服务端真实记录，不伪造刷新时间。";
  } catch {
    rStatus.value = "读取榜单快照状态失败";
  } finally {
    busy.value = false;
  }
}

async function rebuildRankingSnapshot(scopes?: string[]): Promise<void> {
  busy.value = true;
  try {
    const reason = rReason.value.trim();
    if (!reason) {
      rStatus.value = "重建被拒：请填写重建原因（写审计）。";
      return;
    }
    const result = await runRanking("ranking.rebuild", scopes?.length ? { reason, scopes } : { reason });
    if (!result.ok) {
      rStatus.value = `重建被拒：${result.error?.code || "CALL_FAILED"} ${result.error?.details?.reason || ""}`;
      return;
    }
    const body = result.data || {};
    const boards = Array.isArray((body as { boards?: unknown }).boards)
      ? ((body as { boards: Record<string, unknown>[] }).boards || [])
      : [];
    rStatus.value = [
      `已发布新快照：generation=${String(body.generation || "")}`,
      `publishedAt=${String(body.publishedAt || "")}`,
      `榜单数=${String(body.boardCount ?? 0)} 名次行=${String(body.rowCount ?? 0)}`,
      `历史缺口=${String(body.historyGapMembers ?? 0)} 位 / ${String(body.historyGapScore ?? 0)} 分`,
      `清理旧代行=${String(body.obsoleteRemoved ?? 0)}`,
      `回放=${body.replayed === true ? "是（幂等命中，未重复发布）" : "否"}`,
      `板块：${boards.map((row) => `${String(row.scope)}/${String(row.categoryId || "-")}=${String(row.participantCount)}人(展示${String(row.displayCount)})`).join(" · ") || "无"}`
    ].join("｜");
  } catch {
    rStatus.value = "重建榜单快照失败";
  } finally {
    busy.value = false;
  }
}

function copyRankingEvidence(): void {
  const parsed = rEvidence.value ? JSON.parse(rEvidence.value) : { steps: [] };
  parsed.summary = { view: rView.value, exactIdSweepOnly: true };
  const text = JSON.stringify(parsed, null, 2);
  rEvidence.value = text;
  void navigator.clipboard?.writeText(text);
  rStatus.value = "已复制榜单治理证据。不要发送密码、环境 ID 或明文 _id。";
}

async function runMember(action: AdminMemberAction, data: Record<string, unknown>): Promise<AdminCallResult> {
  const app = await createAdminApp();
  return callAdminMember(app, action, data);
}

async function runFeedback(action: AdminFeedbackAction, data: Record<string, unknown>): Promise<AdminCallResult> {
  const app = await createAdminApp();
  return callAdminFeedback(app, action, data);
}

async function runOps(action: AdminOpsAction, data: Record<string, unknown> = {}): Promise<AdminCallResult> {
  const app = await createAdminApp();
  return callAdminOps(app, action, data);
}

function opsFen(value: unknown): string {
  return typeof value === "number" && Number.isInteger(value) ? `${value} 分` : "—";
}

async function loadOpsTutorial(): Promise<void> {
  try {
    const result = await runOps("ops.tutorial");
    const steps = Array.isArray(result.data?.steps) ? result.data.steps : [];
    opsTutorial.value = steps.map((row) => {
      const rec = row as Record<string, unknown>;
      return {
        step: Number(rec.step) || 0,
        id: String(rec.id || ""),
        title: String(rec.title || ""),
        actions: Array.isArray(rec.actions) ? rec.actions.map((item) => String(item)) : [],
        page: String(rec.page || "admin-ops"),
        executeRole: String(rec.executeRole || ""),
        note: String(rec.note || "")
      };
    });
    if (!result.ok) {
      opsStatus.value = `教程读取失败：${result.error?.code || ""} ${result.error?.details?.reason || ""}`;
    }
  } catch {
    opsStatus.value = "教程读取失败。";
  }
}

async function loadOpsStats(persistFixture = false): Promise<void> {
  busy.value = true;
  try {
    const [stats, exceptions] = await Promise.all([
      runOps("ops.stats", persistFixture ? { persistFixture: true } : {}),
      runOps("ops.exceptions")
    ]);
    if (!opsTutorial.value.length) await loadOpsTutorial();
    opsStats.value = stats.ok ? (stats.data as Record<string, unknown>) : null;
    const entries = exceptions.ok && Array.isArray(exceptions.data?.entries) ? exceptions.data.entries : [];
    opsExceptions.value = entries.map((row) => {
      const rec = row as Record<string, unknown>;
      return {
        kind: String(rec.kind || ""),
        count: Number(rec.count) || 0,
        page: String(rec.page || "admin-ops"),
        action: String(rec.action || ""),
        note: String(rec.note || "")
      };
    });
    opsView.value = JSON.stringify({ stats: stats.data || stats.error, exceptions: exceptions.data || exceptions.error }, null, 2);
    if (typeof stats.data?.leftoverSnapshotId === "string" && stats.data.leftoverSnapshotId) {
      lastOpsSnapshotIds.value = [...new Set([...lastOpsSnapshotIds.value, stats.data.leftoverSnapshotId])];
    }
    if (!stats.ok && stats.error?.details?.reason === "CONTENT_STATS_DENIED") {
      opsStatus.value = "content 不能看统计与收款金额。教程步骤仍可打开导入/上架入口。";
      return;
    }
    opsStatus.value = stats.ok
      ? `已读取统计。流水不是利润。重复练习计入次数。当日 ${String(stats.data?.dayKey || "")}。${opsScanTruncatedNotice(stats.data?.scanTruncated === true, Number(stats.data?.scanBudget) || undefined)}`
      : `统计失败：${stats.error?.code || ""} ${stats.error?.details?.reason || ""}`;
  } finally {
    busy.value = false;
  }
}

function openOpsPage(page: string): void {
  if (page in PAGES) go(page as PageKey);
}

async function copyOpsLeftover(): Promise<void> {
  const snapshots = await Promise.all(lastOpsSnapshotIds.value.map((id) => hashText(id)));
  const payload = { snapshots, tutorialFixtures: [] as string[] };
  opsEvidence.value = JSON.stringify(
    { knownIds: payload, note: "只入册本轮统计快照哈希。不入册订单/退款/会员/审计。" },
    null,
    2
  );
  void navigator.clipboard?.writeText(JSON.stringify(payload));
  opsStatus.value = lastOpsSnapshotIds.value.length
    ? "已复制本轮统计快照 leftover 哈希。不得把空清单当 leftover=0。"
    : "本轮没有统计快照。空清单不得报 leftover=0。";
}

async function listAdminMembersPage(): Promise<void> {
  busy.value = true;
  try {
    const result = await runMember("member.list", memberQuery.value.trim() ? { nickname: memberQuery.value.trim() } : {});
    memberView.value = JSON.stringify(result.data || result.error, null, 2);
    memberStatus.value = result.ok
      ? `已列出 ${Array.isArray(result.data?.items) ? result.data.items.length : 0} 名会员。不含 OPENID / 订单明细。`
      : `列出失败：${result.error?.code || ""} ${result.error?.details?.reason || ""}`;
  } finally {
    busy.value = false;
  }
}

async function getAdminMemberPage(): Promise<void> {
  busy.value = true;
  try {
    const result = await runMember("member.get", { targetMemberId: memberIdInput.value.trim() });
    memberView.value = JSON.stringify(result.data || result.error, null, 2);
    if (result.ok && result.data?.memberId) memberIdInput.value = String(result.data.memberId);
    memberStatus.value = result.ok
      ? `状态=${result.data?.status || ""} 注销=${result.data?.status === "deleted" || result.data?.status === "deleting" ? "只读" : "否"} optIn=${result.data?.rankingOptIn === true} banned=${result.data?.rankingBanned === true}`
      : `读取失败：${result.error?.code || ""} ${result.error?.details?.reason || ""}`;
  } finally {
    busy.value = false;
  }
}

async function setMemberDisabled(disabled: boolean): Promise<void> {
  busy.value = true;
  try {
    const reason = memberReason.value.trim();
    if (!reason) {
      memberStatus.value = "原因必填。";
      return;
    }
    const result = await runMember("member.disable", {
      targetMemberId: memberIdInput.value.trim(),
      disabled,
      reason
    });
    memberView.value = JSON.stringify(result.data || result.error, null, 2);
    memberStatus.value = result.ok
      ? `${disabled ? "已停用" : "已恢复"} status=${result.data?.status || ""}。停用后仍可 member.me，不能写。`
      : `失败：${result.error?.code || ""} ${result.error?.details?.reason || ""}`;
  } finally {
    busy.value = false;
  }
}

async function setRankingBanned(banned: boolean): Promise<void> {
  busy.value = true;
  try {
    const reason = memberReason.value.trim();
    if (!reason) {
      memberStatus.value = "原因必填。";
      return;
    }
    const result = await runMember("ranking.ban", {
      targetMemberId: memberIdInput.value.trim(),
      banned,
      reason
    });
    memberView.value = JSON.stringify(result.data || result.error, null, 2);
    memberStatus.value = result.ok
      ? `${banned ? "已禁榜" : "已解禁"} rankingBanned=${result.data?.rankingBanned === true} status=${result.data?.status || ""}。禁榜不等于停用。`
      : `失败：${result.error?.code || ""} ${result.error?.details?.reason || ""}`;
  } finally {
    busy.value = false;
  }
}

async function listFeedbacksPage(): Promise<void> {
  busy.value = true;
  try {
    const result = await runFeedback("feedback.list", { status: "open" });
    feedbackView.value = JSON.stringify(result.data || result.error, null, 2);
    const items = Array.isArray(result.data?.items) ? result.data.items : [];
    for (const row of items) {
      const id = String((row as { feedbackId?: string }).feedbackId || "");
      if (id && !lastFeedbackIds.value.includes(id)) lastFeedbackIds.value = [...lastFeedbackIds.value, id];
    }
    feedbackStatus.value = result.ok
      ? `开放反馈 ${items.length} 条。content 会被拒。`
      : `列出失败：${result.error?.code || ""} ${result.error?.details?.reason || ""}`;
  } finally {
    busy.value = false;
  }
}

async function resolveFeedbackPage(): Promise<void> {
  busy.value = true;
  try {
    const feedbackId = lastFeedbackIds.value[lastFeedbackIds.value.length - 1] || "";
    const result = await runFeedback("feedback.resolve", { feedbackId, note: feedbackNote.value.trim() });
    feedbackView.value = JSON.stringify(result.data || result.error, null, 2);
    feedbackStatus.value = result.ok
      ? `已处理 ${result.data?.feedbackId || ""}。不能改答案库。`
      : `处理失败：${result.error?.code || ""} ${result.error?.details?.reason || ""}`;
  } finally {
    busy.value = false;
  }
}

async function copyFeedbackLeftover(): Promise<void> {
  const payload = await leftoverPayload();
  const text = JSON.stringify(payload);
  feedbackEvidence.value = JSON.stringify({ knownIds: payload, note: "只入册本轮反馈哈希；不停用误伤账号、不删会员" }, null, 2);
  void navigator.clipboard?.writeText(text);
  feedbackStatus.value = "已复制本轮反馈 leftover 哈希。";
}

async function logout(): Promise<void> {
  try {
    const app = await createAdminApp();
    await signOutAdmin(app);
  } catch {
    /* still clear local view */
  }
  session.value = null;
  currentPage.value = "admin-categories";
  questionCatalog.value = [];
  paperCatalog.value = [];
  questionListCategory.value = "";
  paperListCategory.value = "";
  status.value = "已退出";
}
</script>

<template>
  <main v-if="!session?.loggedIn" class="login-view">
    <section class="login-card" aria-labelledby="login-title">
      <p class="brand">思维工坊 · 管理后台</p>
      <h1 id="login-title">管理员登录</h1>
      <p class="muted">使用 CloudBase 用户名密码。密码只在浏览器本次提交，不要把密码发给对话。</p>
      <form @submit.prevent="login">
        <label>
          账号
          <input v-model="username" autocomplete="username" :disabled="busy" />
        </label>
        <label>
          密码
          <input v-model="password" type="password" autocomplete="current-password" :disabled="busy" />
        </label>
        <button type="submit" :disabled="busy">登录并读取 admin.me</button>
        <p v-if="loginFailed" class="field-error" role="alert">{{ status }}</p>
        <p v-else class="muted">{{ status }}</p>
      </form>
    </section>
  </main>

  <div v-else class="app-view">
    <header class="topbar">
      <div class="topbar-left">
        <button
          class="icon-btn"
          type="button"
          aria-label="折叠导航"
          :aria-expanded="sidebarVisible ? 'true' : 'false'"
          aria-controls="sidebar"
          @click="toggleSidebar"
        >
          ☰
        </button>
        <span class="brand">思维工坊</span>
        <span class="brand-sep">/</span>
        <span class="brand-sub">管理后台</span>
      </div>
      <div class="topbar-right">
        <span class="identity-tag">{{ identityLabel }}</span>
        <button class="ghost-btn" type="button" :disabled="busy" @click="logout">退出登录</button>
      </div>
    </header>

    <div class="layout">
      <nav id="sidebar" class="sidebar" aria-label="主导航" :hidden="!sidebarVisible">
        <div class="nav-section">
          <button
            class="nav-group"
            type="button"
            :aria-expanded="navExpanded.content ? 'true' : 'false'"
            aria-controls="nav-pages-content"
            @click="toggleGroup('content')"
          >
            内容管理
          </button>
          <div id="nav-pages-content" class="nav-pages" :hidden="!navExpanded.content">
            <button
              class="nav-item"
              type="button"
              :class="{ active: currentPage === 'admin-categories' }"
              :aria-current="currentPage === 'admin-categories' ? 'page' : undefined"
              @click="go('admin-categories')"
            >
              类目
            </button>
            <button
              class="nav-item"
              type="button"
              :class="{ active: currentPage === 'admin-questions' }"
              :aria-current="currentPage === 'admin-questions' ? 'page' : undefined"
              @click="go('admin-questions')"
            >
              题库
            </button>
            <button
              class="nav-item"
              type="button"
              :class="{ active: currentPage === 'admin-papers' }"
              :aria-current="currentPage === 'admin-papers' ? 'page' : undefined"
              @click="go('admin-papers')"
            >
              试卷编排
            </button>
          </div>
        </div>
        <div class="nav-section">
          <button
            class="nav-group"
            type="button"
            :aria-expanded="navExpanded.import ? 'true' : 'false'"
            aria-controls="nav-pages-import"
            @click="toggleGroup('import')"
          >
            内容导入
          </button>
          <div id="nav-pages-import" class="nav-pages" :hidden="!navExpanded.import">
            <button
              class="nav-item"
              type="button"
              :class="{ active: currentPage === 'admin-import-questions' }"
              :aria-current="currentPage === 'admin-import-questions' ? 'page' : undefined"
              @click="go('admin-import-questions')"
            >
              题库导入
            </button>
            <button
              class="nav-item"
              type="button"
              :class="{ active: currentPage === 'admin-import-papers' }"
              :aria-current="currentPage === 'admin-import-papers' ? 'page' : undefined"
              @click="go('admin-import-papers')"
            >
              试卷导入
            </button>
            <button
              class="nav-item"
              type="button"
              :class="{ active: currentPage === 'admin-import' }"
              :aria-current="currentPage === 'admin-import' ? 'page' : undefined"
              @click="go('admin-import')"
            >
              导入批次
            </button>
          </div>
        </div>
        <div class="nav-section">
          <button
            class="nav-group"
            type="button"
            :aria-expanded="navExpanded.ops ? 'true' : 'false'"
            aria-controls="nav-pages-ops"
            @click="toggleGroup('ops')"
          >
            运营
          </button>
          <div id="nav-pages-ops" class="nav-pages" :hidden="!navExpanded.ops">
            <button
              class="nav-item"
              type="button"
              :class="{ active: currentPage === 'admin-growth' }"
              :aria-current="currentPage === 'admin-growth' ? 'page' : undefined"
              @click="go('admin-growth')"
            >
              成长等级
            </button>
            <button
              class="nav-item"
              type="button"
              :class="{ active: currentPage === 'admin-vip' }"
              :aria-current="currentPage === 'admin-vip' ? 'page' : undefined"
              @click="go('admin-vip')"
            >
              VIP 赠送
            </button>
            <button
              class="nav-item"
              type="button"
              :class="{ active: currentPage === 'admin-plans' }"
              :aria-current="currentPage === 'admin-plans' ? 'page' : undefined"
              @click="go('admin-plans')"
            >
              VIP 套餐
            </button>
            <button
              class="nav-item"
              type="button"
              :class="{ active: currentPage === 'admin-orders' }"
              :aria-current="currentPage === 'admin-orders' ? 'page' : undefined"
              @click="go('admin-orders')"
            >
              订单核对
            </button>
            <button
              class="nav-item"
              type="button"
              :class="{ active: currentPage === 'admin-refunds' }"
              :aria-current="currentPage === 'admin-refunds' ? 'page' : undefined"
              @click="go('admin-refunds')"
            >
              退款审核
            </button>
            <button
              class="nav-item"
              type="button"
              :class="{ active: currentPage === 'admin-ranking' }"
              :aria-current="currentPage === 'admin-ranking' ? 'page' : undefined"
              @click="go('admin-ranking')"
            >
              榜单治理
            </button>
            <button
              class="nav-item"
              type="button"
              :class="{ active: currentPage === 'admin-members' }"
              :aria-current="currentPage === 'admin-members' ? 'page' : undefined"
              @click="go('admin-members')"
            >
              会员详情
            </button>
            <button
              class="nav-item"
              type="button"
              :class="{ active: currentPage === 'admin-ops' }"
              :aria-current="currentPage === 'admin-ops' ? 'page' : undefined"
              @click="go('admin-ops')"
            >
              反馈与统计
            </button>
            <button
              class="nav-item"
              type="button"
              :class="{ active: currentPage === 'admin-jobs' }"
              :aria-current="currentPage === 'admin-jobs' ? 'page' : undefined"
              @click="go('admin-jobs')"
            >
              任务查询
            </button>
          </div>
        </div>
      </nav>

      <div class="main">
        <section class="page" :class="{ 'is-active': currentPage === 'admin-categories' }" data-page="admin-categories">
          <p class="breadcrumb">{{ currentMeta.group }} / {{ currentMeta.title }}</p>
          <div class="page-head">
            <div>
              <h1 class="page-title">{{ currentMeta.title }}</h1>
              <p class="page-desc">{{ currentMeta.desc }}</p>
            </div>
            <div class="page-actions">
              <button type="button" class="primary-btn" :disabled="busy" @click="seedRoots">确保初始十类</button>
              <button type="button" class="ghost" :disabled="busy" @click="refreshTree">刷新树</button>
            </div>
          </div>
          <p class="status">treeVersion={{ treeVersion }} · 写并发字段 expectedTreeVersion</p>
          <p v-if="status" class="status">{{ status }}</p>
          <div class="workspace">
            <div class="tree-pane">
              <ul class="tree">
                <li v-for="row in nodes" :key="nodeId(row)" class="tree-node">
                  <button
                    type="button"
                    class="tree-row"
                    :class="{ selected: nodeId(row) === selectedId }"
                    @click="pick(row)"
                  >
                    <span class="tree-label">{{ indent(row.depth) }}{{ row.name }}</span>
                    <span class="tree-meta">{{ categoryQuestionCount(nodeId(row)) }}题 · {{ categoryPaperCount(nodeId(row)) }}卷 · {{ row.enabled ? "启用" : "停用" }}</span>
                  </button>
                </li>
              </ul>
              <p v-if="!nodes.length" class="status">暂无类目。可先点「确保初始十类」。 </p>
            </div>
            <div class="detail-pane">
              <h2 class="detail-title">{{ nodeName || "未选择类目" }}</h2>
              <p class="detail-meta">当前 ID {{ selectedId || "—" }}</p>
              <p class="detail-meta">当前父级 {{ selected?.parentId || "（一级）" }}</p>
              <p class="detail-meta">
                本类目已加载 {{ selectedCategoryQuestions.length }} 题、{{ selectedCategoryPapers.length }} 卷
              </p>
              <div v-if="selectedId" class="actions">
                <button type="button" class="ghost" :disabled="busy" @click="viewCategoryQuestions">查看题库列表</button>
                <button type="button" class="ghost" :disabled="busy" @click="viewCategoryPapers">查看试卷列表</button>
              </div>
              <div v-if="selectedId" class="catalog-preview">
                <p class="panel-subtitle">本类目题目</p>
                <p v-if="!selectedCategoryQuestions.length" class="status">该类目暂无已加载题目。</p>
                <ul v-else class="mini-list">
                  <li v-for="row in selectedCategoryQuestions.slice(0, 8)" :key="row.questionId">
                    <button type="button" class="text-btn" :disabled="busy" @click="openQuestionFromList(row); go('admin-questions')">
                      {{ stemPreview(row.stem?.text || "") }}
                    </button>
                    <span class="tree-meta">{{ questionTypeLabel(row.type) }} · {{ questionStatusLabel(row.status || "") }}</span>
                  </li>
                </ul>
                <p class="panel-subtitle">本类目试卷</p>
                <p v-if="!selectedCategoryPapers.length" class="status">该类目暂无已加载试卷。</p>
                <ul v-else class="mini-list">
                  <li v-for="row in selectedCategoryPapers.slice(0, 8)" :key="row.paperId">
                    <button type="button" class="text-btn" :disabled="busy" @click="openPaperFromList(row); go('admin-papers')">
                      {{ row.title }}
                    </button>
                    <span class="tree-meta">{{ paperStatusLabel(row.status || "") }} · {{ row.questionCount || 0 }}题</span>
                  </li>
                </ul>
              </div>
              <label>
                新增用的父级 ID（默认=当前选中，空=一级）
                <input v-model="parentId" autocomplete="off" />
              </label>
              <label>
                名称
                <input v-model="nodeName" autocomplete="off" />
              </label>
              <label>
                排序
                <input v-model.number="nodeSort" type="number" />
              </label>
              <div class="actions">
                <button type="button" :disabled="busy" @click="createNode">新增</button>
                <button type="button" :disabled="busy" @click="updateNode({ name: nodeName })">改名</button>
                <button type="button" :disabled="busy" @click="updateNode({ sort: nodeSort })">改排序</button>
                <button type="button" :disabled="busy" @click="updateNode({ enabled: true })">启用</button>
                <button type="button" class="danger-btn" :disabled="busy" @click="updateNode({ enabled: false })">停用</button>
                <button type="button" class="danger-btn" :disabled="busy" @click="deleteNode">删除无占用</button>
              </div>
              <div class="actions">
                <button type="button" class="ghost" :disabled="busy" @click="tryFourth">尝试第四级</button>
                <button type="button" class="ghost" :disabled="busy" @click="tryDuplicate">尝试同级重名</button>
                <button type="button" class="ghost" :disabled="busy" @click="tryMoveParent">尝试改父级（应被拒）</button>
                <button type="button" class="ghost" @click="copyEvidence">复制脱敏证据</button>
              </div>
              <p v-if="lastError" class="status error">最近错误码 {{ lastError }}</p>
            </div>
          </div>
          <div class="card form-block">
            <h2 class="panel-subtitle">MW18 类目迁移与安全删除</h2>
            <p class="page-desc">仅 super。请只用本轮专用测试子树，不要把种子十类当可删除对象。过期预览需重新预览。</p>
            <p class="status">{{ changeStatusText }}</p>
            <label>
              目标父级 ID（空=升到一级；删除时填迁题迁卷目标）
              <input v-model="changeTargetParentId" autocomplete="off" />
            </label>
            <label>
              原因
              <input v-model="changeReason" autocomplete="off" />
            </label>
            <div class="actions">
              <button type="button" :disabled="busy" @click="previewCategoryMove">预览移动选中节点</button>
              <button type="button" :disabled="busy" @click="previewCategoryDelete">预览迁出后删除</button>
              <button type="button" :disabled="busy" @click="commitCategoryChangeAction">确认提交维护任务</button>
              <button type="button" class="ghost" :disabled="busy" @click="refreshChangeStatus">读取迁移进度</button>
              <button type="button" class="ghost" :disabled="busy" @click="resumeChangeJob">恢复失败任务</button>
            </div>
            <pre data-testid="category-change-view">{{ changeView }}</pre>
          </div>
          <pre data-testid="category-evidence">{{ evidence }}</pre>
        </section>

        <section class="page" :class="{ 'is-active': currentPage === 'admin-questions' }" data-page="admin-questions">
          <p class="breadcrumb">{{ PAGES["admin-questions"].group }} / {{ PAGES["admin-questions"].title }}</p>
          <div class="page-head">
            <div>
              <h1 class="page-title">{{ PAGES["admin-questions"].title }}</h1>
              <p class="page-desc">{{ PAGES["admin-questions"].desc }}</p>
            </div>
          </div>
          <p class="message">
            同一票据重放不用手点：选图上传成功后，页面会立刻用同一张票再传一次。状态出现「重放已拒绝」、证据里
            <code>mw-upload.replay</code> 的 <code>TICKET_REPLAY</code> 即算完成。
          </p>
          <div class="card">
            <div class="list-head">
              <h2 class="panel-subtitle">题库列表</h2>
              <button type="button" class="ghost" :disabled="busy" @click="refreshQuestionList()">刷新列表</button>
            </div>
            <div class="list-toolbar">
              <label>
                按类目
                <select v-model="questionListCategory">
                  <option value="">全部类目</option>
                  <option v-for="row in nodes" :key="nodeId(row)" :value="nodeId(row)">
                    {{ indent(row.depth) }}{{ row.name }}
                  </option>
                </select>
              </label>
              <label>
                状态
                <select v-model="questionListStatusFilter">
                  <option value="">全部</option>
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                </select>
              </label>
            </div>
            <p class="status">{{ questionListStatus }} · 当前筛选 {{ displayedQuestions.length }} 题</p>
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>题干</th>
                    <th>题型</th>
                    <th>类目</th>
                    <th>难度</th>
                    <th>状态</th>
                    <th>分值</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="!displayedQuestions.length">
                    <td colspan="7" class="empty-cell">暂无题目。可先在本页保存，或点「刷新列表」。</td>
                  </tr>
                  <tr
                    v-for="row in displayedQuestions"
                    :key="row.questionId"
                    :class="{ selected: row.questionId === qQuestionId }"
                    @click="openQuestionFromList(row)"
                  >
                    <td>{{ stemPreview(row.stem?.text || "") }}</td>
                    <td>{{ questionTypeLabel(row.type) }}</td>
                    <td>{{ categoryLabel(row.categoryId) }}</td>
                    <td>{{ difficultyLabel(row.difficulty || "") }}</td>
                    <td>
                      <span class="badge" :class="row.status === 'disabled' ? 'disabled' : 'published'">
                        {{ questionStatusLabel(row.status || "") }}
                      </span>
                    </td>
                    <td>{{ row.defaultPoints || 0 }}</td>
                    <td>
                      <button type="button" class="text-btn" :disabled="busy" @click.stop="addQuestionFromList(row)">加入试卷</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="card">
            <label>
              类目
              <select v-model="qCategoryId">
                <option value="">请选择类目</option>
                <option v-for="row in nodes" :key="nodeId(row)" :value="nodeId(row)">
                  {{ indent(row.depth) }}{{ row.name }}
                </option>
              </select>
            </label>
            <p class="detail-meta">类目 ID {{ qCategoryId || "—" }}</p>
            <label>
              题目 ID（从上方列表点选，或粘贴后点「读取并重载」）
              <input v-model="qQuestionId" autocomplete="off" placeholder="从列表点选或保存后自动填入" />
            </label>
            <label>
              题型
              <select v-model="qType">
                <option value="single">单选</option>
                <option value="multiple">多选</option>
                <option value="trueFalse">判断</option>
              </select>
            </label>
            <label>
              题干
              <textarea v-model="qStem" rows="3"></textarea>
            </label>
            <label v-if="qType !== 'trueFalse'">
              选项（每行一项）
              <textarea v-model="qOptions" rows="4"></textarea>
            </label>
            <label>
              正确答案（单选 A；多选 A|C；判断 TRUE/FALSE）
              <input v-model="qAnswers" autocomplete="off" />
            </label>
            <label>
              解析
              <textarea v-model="qAnalysis" rows="3"></textarea>
            </label>
            <label>
              默认分值
              <input v-model.number="qPoints" type="number" min="1" />
            </label>
            <label>
              难度
              <select v-model="qDifficulty">
                <option value="beginner">入门</option>
                <option value="intermediate">进阶</option>
                <option value="challenge">挑战</option>
              </select>
            </label>
            <label>
              题干图
              <input type="file" accept="image/jpeg,image/png,image/webp" @change="uploadPicked(($event.target as HTMLInputElement).files?.[0], 'prompt')" />
            </label>
            <label>
              解析图
              <input type="file" accept="image/jpeg,image/png,image/webp" @change="uploadPicked(($event.target as HTMLInputElement).files?.[0], 'analysis')" />
            </label>
            <p v-if="!qComplete || previewFailed" class="status error">缺图或加载失败，本题不能当作完整题显示。</p>
            <div v-if="previewUrl" class="preview">
              <button type="button" class="ghost" @click="openPreview">预览 / 放大 {{ previewKind }}</button>
              <img :src="previewUrl" alt="题目图片预览" @error="previewFailed = true" />
            </div>
            <div v-if="previewOpen" class="zoom" @click="previewOpen = false">
              <img :src="previewUrl" alt="放大预览" />
            </div>
            <div class="actions">
              <button type="button" :disabled="busy" @click="saveQuestion">保存题目</button>
              <button type="button" class="ghost" :disabled="busy" @click="startNewQuestion">新建下一题</button>
              <button type="button" class="ghost" :disabled="busy" @click="loadQuestion">读取并重载</button>
              <button type="button" class="ghost" :disabled="busy" @click="disableCurrent">停用当前题</button>
              <button type="button" class="ghost" @click="copyQuestionEvidence">复制题库脱敏证据</button>
            </div>
            <p class="status">question revision={{ qRevision }} · status={{ qStatus }} · ticketOnce={{ lastTicketOnce }}</p>
          </div>
          <pre data-testid="question-evidence">{{ qEvidence }}</pre>
        </section>

        <section class="page" :class="{ 'is-active': currentPage === 'admin-papers' }" data-page="admin-papers">
          <p class="breadcrumb">{{ PAGES["admin-papers"].group }} / {{ PAGES["admin-papers"].title }}</p>
          <div class="page-head">
            <div>
              <h1 class="page-title">{{ PAGES["admin-papers"].title }}</h1>
              <p class="page-desc">{{ PAGES["admin-papers"].desc }} 解析图不得进公开包。</p>
            </div>
          </div>
          <div class="card">
            <div class="list-head">
              <h2 class="panel-subtitle">试卷列表</h2>
              <div class="actions">
                <button type="button" class="ghost" :disabled="busy" @click="refreshPaperList()">刷新列表</button>
                <button type="button" class="ghost" :disabled="busy || !paperListCursor" @click="refreshPaperList({ loadMore: true })">加载更多</button>
              </div>
            </div>
            <div class="list-toolbar">
              <label>
                按类目
                <select v-model="paperListCategory">
                  <option value="">全部类目</option>
                  <option v-for="row in nodes" :key="nodeId(row)" :value="nodeId(row)">
                    {{ indent(row.depth) }}{{ row.name }}
                  </option>
                </select>
              </label>
              <label>
                状态
                <select v-model="paperListStatusFilter">
                  <option value="">全部</option>
                  <option value="draft">草稿</option>
                  <option value="published">已发布</option>
                  <option value="unpublished">已下架</option>
                  <option value="withdrawn">已撤回</option>
                </select>
              </label>
              <label>
                权限
                <select v-model="paperListAccessFilter">
                  <option value="">全部</option>
                  <option value="free">免费</option>
                  <option value="vip">VIP</option>
                </select>
              </label>
            </div>
            <p class="status">{{ paperListStatus }} · 当前筛选 {{ displayedPapers.length }} 份</p>
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>标题</th>
                    <th>类目</th>
                    <th>状态</th>
                    <th>权限</th>
                    <th>难度</th>
                    <th>题数</th>
                    <th>满分</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="!displayedPapers.length">
                    <td colspan="7" class="empty-cell">暂无试卷。可先保存草稿，或点「刷新列表」。</td>
                  </tr>
                  <tr
                    v-for="row in displayedPapers"
                    :key="row.paperId"
                    :class="{ selected: row.paperId === pPaperId }"
                    @click="openPaperFromList(row)"
                  >
                    <td>{{ row.title }}</td>
                    <td>{{ categoryLabel(row.categoryId) }}</td>
                    <td>
                      <span class="badge" :class="row.status || 'draft'">{{ paperStatusLabel(row.status || "") }}</span>
                    </td>
                    <td>{{ accessLabel(row.access || "") }}</td>
                    <td>{{ difficultyLabel(row.difficulty || "") }}</td>
                    <td>{{ row.questionCount || 0 }}</td>
                    <td>{{ row.maxScore || 0 }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="card">
            <label>
              试卷 ID（从上方列表点选，或粘贴后点「按 ID 读取试卷」）
              <input v-model="pPaperId" autocomplete="off" placeholder="从列表点选或保存后自动填入" />
            </label>
            <div class="actions">
              <button type="button" class="ghost" :disabled="busy" @click="loadPaperById">按 ID 读取试卷</button>
              <button type="button" class="ghost" :disabled="busy" @click="startNewPaper">新建试卷</button>
            </div>
            <label>
              类目
              <select v-model="qCategoryId">
                <option value="">请选择类目</option>
                <option v-for="row in nodes" :key="nodeId(row)" :value="nodeId(row)">
                  {{ indent(row.depth) }}{{ row.name }}
                </option>
              </select>
            </label>
            <label>
              标题
              <input v-model="pTitle" autocomplete="off" />
            </label>
            <label>
              简介
              <input v-model="pSummary" autocomplete="off" />
            </label>
            <label>
              练习目标
              <input v-model="pGoal" autocomplete="off" />
            </label>
            <label>
              权限
              <select v-model="pAccess">
                <option value="free">免费</option>
                <option value="vip">VIP</option>
              </select>
            </label>
            <label>
              难度
              <select v-model="pDifficulty">
                <option value="beginner">入门</option>
                <option value="intermediate">进阶</option>
                <option value="challenge">挑战</option>
              </select>
            </label>
            <label>
              排序
              <input v-model.number="pSort" type="number" />
            </label>
            <p class="status">
              当前题库题：{{ qQuestionId || "还没有。请先在题库页点「保存题目」" }} · 类目：{{ qCategoryId || selectedId || "未选" }}
            </p>
            <p class="status">{{ pLocalStatus }}</p>
            <label>
              题目（每行 questionId:分值。用「加入当前题」从题库带入）
              <textarea v-model="pItemText" rows="6" placeholder="从题库列表点「加入试卷」，或先保存题再点加入当前题"></textarea>
            </label>
            <div class="actions">
              <button type="button" class="ghost" :disabled="busy" @click="addCurrentQuestion">加入当前题</button>
              <button type="button" :disabled="busy" @click="savePaperDraft">保存草稿</button>
              <button type="button" :disabled="busy" @click="previewPaper">整卷预览</button>
              <button type="button" :disabled="busy" @click="publishPaper()">发布</button>
              <button type="button" class="ghost" :disabled="busy" @click="publishPaper('missingChunk')">故意缺块发布（应拒绝）</button>
              <button type="button" class="ghost" :disabled="busy" @click="publishPaper('badManifest')">故意坏摘要发布（应拒绝）</button>
              <button type="button" class="ghost" :disabled="busy" @click="readPublishedSnapshot">读取已发布快照</button>
              <button type="button" :disabled="busy" @click="unpublishPaper">普通下架</button>
            </div>
            <label>
              紧急撤回原因
              <input v-model="pWithdrawReason" autocomplete="off" />
            </label>
            <div class="actions">
              <button type="button" class="danger-btn" :disabled="busy" @click="withdrawPaper">紧急撤回</button>
              <button type="button" class="ghost" @click="copyPaperEvidence">复制试卷 knownIds</button>
            </div>
            <p class="status">
              paper revision={{ pRevision }} · status={{ pStatus }} · 题数={{ pQuestionCount }} · 满分={{ pMaxScore }}
            </p>
          </div>
          <div class="card form-block">
            <h2 class="panel-subtitle">MW19 题目纠错与历史重评分</h2>
            <p class="page-desc">仅 super。先紧急撤回，再发布同结构修订版，预览影响后确认。题数/分值结构变化会拒绝，当作新卷。</p>
            <p class="status">{{ corrStatusText }}</p>
            <label>
              fromVersionId（撤回前、答错过的版本）
              <input v-model="pFromVersionId" autocomplete="off" />
            </label>
            <label>
              toVersionId（修订后版本）
              <input v-model="pToVersionId" autocomplete="off" />
            </label>
            <label>
              原因
              <input v-model="corrReason" autocomplete="off" />
            </label>
            <div class="actions">
              <button type="button" :disabled="busy" @click="previewCorrectionAction">预览重评影响</button>
              <button type="button" :disabled="busy" @click="commitCorrectionAction">确认提交重评任务</button>
              <button type="button" class="ghost" :disabled="busy" @click="refreshCorrectionStatus">读取重评进度</button>
              <button type="button" class="ghost" :disabled="busy" @click="resumeCorrectionJob">恢复失败任务</button>
            </div>
            <pre data-testid="correction-view">{{ corrView }}</pre>
          </div>
          <pre data-testid="paper-preview">{{ pPreview }}</pre>
          <pre data-testid="paper-evidence">{{ pEvidence }}</pre>
        </section>

        <section class="page" :class="{ 'is-active': currentPage === 'admin-import-questions' }" data-page="admin-import-questions">
          <p class="breadcrumb">{{ PAGES["admin-import-questions"].group }} / {{ PAGES["admin-import-questions"].title }}</p>
          <div class="page-head">
            <div>
              <h1 class="page-title">{{ PAGES["admin-import-questions"].title }}</h1>
              <p class="page-desc">
                UTF-8 CSV，单文件 ≤5 MB、最多 1000 个数据行。字段：导入来源键、类目标识、题型、题干、选项 A—H、正确答案、解析、默认分值、难度、可选图片素材标识。多选答案 A|C；判断 TRUE/FALSE。阻断错误整批拒绝。
              </p>
            </div>
          </div>
          <div class="card">
            <div class="actions">
              <button type="button" class="ghost" @click="iKind = 'question'; downloadQuestionTemplate()">下载题库模板</button>
              <button type="button" class="ghost" @click="downloadFilledSamples">用当前类目生成虚构样例</button>
            </div>
            <label>
              上传虚构题库 CSV
              <input type="file" accept=".csv,text/csv,text/plain" @change="iKind = 'question'; uploadImportFile(($event.target as HTMLInputElement).files?.[0])" />
            </label>
          </div>
        </section>

        <section class="page" :class="{ 'is-active': currentPage === 'admin-import-papers' }" data-page="admin-import-papers">
          <p class="breadcrumb">{{ PAGES["admin-import-papers"].group }} / {{ PAGES["admin-import-papers"].title }}</p>
          <div class="page-head">
            <div>
              <h1 class="page-title">{{ PAGES["admin-import-papers"].title }}</h1>
              <p class="page-desc">{{ PAGES["admin-import-papers"].desc }} 只能引用已存在且可用的题目来源键。</p>
            </div>
          </div>
          <div class="card">
            <div class="actions">
              <button type="button" class="ghost" @click="iKind = 'paper'; downloadPaperTemplate()">下载试卷模板</button>
            </div>
            <label>
              上传虚构试卷 CSV
              <input type="file" accept=".csv,text/csv,text/plain" @change="iKind = 'paper'; uploadImportFile(($event.target as HTMLInputElement).files?.[0])" />
            </label>
          </div>
        </section>

        <section class="page" :class="{ 'is-active': currentPage === 'admin-import' }" data-page="admin-import">
          <p class="breadcrumb">{{ PAGES["admin-import"].group }} / {{ PAGES["admin-import"].title }}</p>
          <div class="page-head">
            <div>
              <h1 class="page-title">导入预览、提交与批次</h1>
              <p class="page-desc">{{ PAGES["admin-import"].desc }}</p>
            </div>
          </div>
          <div class="card">
            <p class="status">{{ iStatus }}</p>
            <p class="status">kind={{ iKind }} · batchState={{ iBatchState }} · 来源键 {{ iSampleKeys.length }}</p>
            <div class="actions">
              <button type="button" :disabled="busy" @click="previewImportBatch">预览当前批次</button>
              <button type="button" :disabled="busy" @click="commitImportBatch">确认提交</button>
              <button type="button" class="ghost" :disabled="busy" @click="readImportStatus">刷新批次状态</button>
              <button type="button" class="ghost" :disabled="busy" @click="readImportedDrafts">按 ID 读本批草稿</button>
              <button type="button" class="ghost" @click="copyImportEvidence">复制 knownIds</button>
            </div>
            <pre data-testid="import-preview">{{ iPreview }}</pre>
            <pre data-testid="import-evidence">{{ iEvidence }}</pre>
          </div>
        </section>

        <section class="page" :class="{ 'is-active': currentPage === 'admin-growth' }" data-page="admin-growth">
          <p class="breadcrumb">{{ PAGES["admin-growth"].group }} / {{ PAGES["admin-growth"].title }}</p>
          <div class="page-head">
            <div>
              <h1 class="page-title">{{ PAGES["admin-growth"].title }}</h1>
              <p class="page-desc">
                门槛必须从 0 起严格递增，名称与勋章不可缺失。发布会产生新配置版本、按现有总分重算等级并补发新达到的勋章，
                <strong>不删除既得勋章</strong>。上线门槛在 MW28 才冻结，本页只做可配置与预览发布。
              </p>
            </div>
          </div>
          <div class="card">
            <p class="status">
              configVersion={{ gConfigVersion ?? "未读取" }} · 来源={{ gConfigSource || "未读取" }} · 发布需要 super 角色，预览任意后台角色可看
            </p>
            <div class="actions">
              <button type="button" :disabled="busy" @click="loadGrowthConfig">读取当前等级配置</button>
            </div>
            <p class="status">
              顺序：读取 →（可选）快速填充 → 预览影响（不写库）→ 发布门槛并重算。发布以云端回读版本为准，预览不改版本。
            </p>
            <div class="actions">
              <button type="button" class="ghost" :disabled="busy" @click="fillLevels('crossLevel')">填入跨级门槛 L2=5/L3=8</button>
              <button type="button" class="ghost" :disabled="busy" @click="fillLevels('raise')">填入提高门槛（建议 100 起）</button>
              <button type="button" class="ghost" :disabled="busy" @click="fillLevels('invalidFirst')">填入非法门槛（首级非 0）</button>
              <button type="button" class="ghost" :disabled="busy" @click="fillLevels('missingMedal')">填入缺勋章名</button>
            </div>
            <label>
              等级门槛 JSON（levelId / name / minScore / medalId / medalName）
              <textarea v-model="gLevelsText" data-testid="growth-levels" rows="12"></textarea>
            </label>
            <label>
              发布原因（写审计）
              <input v-model="gReason" autocomplete="off" />
            </label>
            <div class="actions">
              <button type="button" class="ghost" :disabled="busy" @click="previewGrowth">预览影响（不写库）</button>
              <button type="button" :disabled="busy" @click="publishGrowth">发布门槛并重算</button>
            </div>
            <label>
              重算目标会员（可空；空=按扫描批量重算）
              <input v-model="gMemberId" autocomplete="off" />
            </label>
            <div class="actions">
              <button type="button" class="ghost" :disabled="busy" @click="recomputeGrowthLevels">按当前门槛重算等级</button>
              <button type="button" class="ghost" @click="copyGrowthEvidence">复制等级配置证据</button>
            </div>
            <p class="status">{{ gStatus }}</p>
            <pre data-testid="growth-impact">{{ gImpact }}</pre>
            <pre data-testid="growth-evidence">{{ gEvidence }}</pre>
          </div>
        </section>

        <section class="page" :class="{ 'is-active': currentPage === 'admin-vip' }" data-page="admin-vip">
          <p class="breadcrumb">{{ PAGES["admin-vip"].group }} / {{ PAGES["admin-vip"].title }}</p>
          <div class="page-head">
            <div>
              <h1 class="page-title">{{ PAGES["admin-vip"].title }}</h1>
              <p class="page-desc">
                人工赠送来源固定为 <strong>gift</strong>，必须填写原因，不写订单、不冒充付款。
                撤销只扣该赠送来源的未用时长。秒边界测试可填 durationSeconds。
              </p>
            </div>
          </div>
          <div class="card">
            <label>
              会员 ID
              <input v-model="vMemberId" autocomplete="off" data-testid="vip-member-id" />
            </label>
            <label>
              赠送原因（必填）
              <input v-model="vReason" autocomplete="off" data-testid="vip-reason" />
            </label>
            <label>
              天数（默认 1 天 = 86400 秒）
              <input v-model="vDurationDays" autocomplete="off" />
            </label>
            <label>
              秒数（可选；填写则优先，用于恰好到期手点）
              <input v-model="vDurationSeconds" autocomplete="off" data-testid="vip-seconds" />
            </label>
            <label>
              来源 sourceId（可空；空则用幂等键。撤销必须填）
              <input v-model="vSourceId" autocomplete="off" data-testid="vip-source-id" />
            </label>
            <div class="actions">
              <button type="button" :disabled="busy" @click="grantVip">赠送 VIP（super）</button>
              <button type="button" class="ghost" :disabled="busy" @click="revokeVip">撤销未用赠送</button>
              <button type="button" class="ghost" @click="copyVipLeftover">复制本轮 VIP leftover</button>
            </div>
            <p class="status">{{ vStatus }}</p>
            <pre data-testid="vip-evidence">{{ vEvidence }}</pre>
          </div>
        </section>

        <section class="page" :class="{ 'is-active': currentPage === 'admin-plans' }" data-page="admin-plans">
          <p class="breadcrumb">{{ PAGES["admin-plans"].group }} / {{ PAGES["admin-plans"].title }}</p>
          <div class="page-head">
            <div>
              <h1 class="page-title">{{ PAGES["admin-plans"].title }}</h1>
              <p class="page-desc">只发布标注测试价的测试商品。改价或改天必须新 planVersion。content 角色会被拒。</p>
            </div>
          </div>
          <div class="card">
            <label>planId<input v-model="planId" autocomplete="off" /></label>
            <label>planVersion<input v-model="planVersion" autocomplete="off" /></label>
            <label>名称<input v-model="planTitle" autocomplete="off" /></label>
            <label>天数（30/90/365）<input v-model="planDays" autocomplete="off" /></label>
            <label>价格（分，测试价）<input v-model="planPriceFen" autocomplete="off" /></label>
            <label>Android 测试商品 ID<input v-model="planProductAndroid" autocomplete="off" /></label>
            <label>原因<input v-model="planReason" autocomplete="off" /></label>
            <div class="actions">
              <button type="button" :disabled="busy" @click="publishTestPlan">发布测试套餐（super）</button>
              <button type="button" class="ghost" :disabled="busy" @click="listPlans">读取套餐</button>
              <button type="button" class="ghost" @click="copyPlanLeftover">复制本轮套餐 leftover</button>
            </div>
            <p class="status">{{ planStatus }}</p>
            <pre>{{ planEvidence }}</pre>
          </div>
        </section>

        <section class="page" :class="{ 'is-active': currentPage === 'admin-orders' }" data-page="admin-orders">
          <p class="breadcrumb">{{ PAGES["admin-orders"].group }} / {{ PAGES["admin-orders"].title }}</p>
          <div class="page-head">
            <div>
              <h1 class="page-title">{{ PAGES["admin-orders"].title }}</h1>
              <p class="page-desc">同订单查单后履约。已付未开通可补偿，不能重复延长。不修改金额。日账差异只列任务。</p>
            </div>
          </div>
          <div class="card">
            <label>会员 ID<input v-model="orderMemberId" autocomplete="off" /></label>
            <label>订单 ID<input v-model="orderId" autocomplete="off" /></label>
            <div class="actions">
              <button type="button" :disabled="busy" @click="listMemberOrders">查询订单</button>
              <button type="button" :disabled="busy" @click="reconcileOrder">同订单核对</button>
              <button type="button" class="ghost" @click="copyOrderLeftover">复制本轮订单 leftover</button>
            </div>
            <p class="status">{{ orderStatus }}</p>
            <pre>{{ orderEvidence }}</pre>
          </div>
        </section>

        <section class="page" :class="{ 'is-active': currentPage === 'admin-refunds' }" data-page="admin-refunds">
          <p class="breadcrumb">{{ PAGES["admin-refunds"].group }} / {{ PAGES["admin-refunds"].title }}</p>
          <div class="page-head">
            <div>
              <h1 class="page-title">{{ PAGES["admin-refunds"].title }}</h1>
              <p class="page-desc">
                content 不能审核或执行。operations 只能 review。super 整笔执行后须等渠道最终成功才撤该 order 未用时长。
                Apple 订单不出现「商户直接退款」按钮。部分退款转人工，不自动削天数。不真实退款。
              </p>
            </div>
          </div>
          <div class="card">
            <label>会员 ID（测试夹具）<input v-model="refundMemberId" autocomplete="off" /></label>
            <label>订单 ID<input v-model="refundOrderId" autocomplete="off" /></label>
            <label>原因<input v-model="refundReason" autocomplete="off" /></label>
            <label>审核建议（operations）<input v-model="refundAdvice" autocomplete="off" /></label>
            <label>绑定金额（分）<input v-model="refundAmountFen" autocomplete="off" /></label>
            <label>渠道最终结果
              <select v-model="refundOutcome">
                <option value="succeeded">succeeded</option>
                <option value="failed">failed</option>
                <option value="processing">processing</option>
                <option value="accepted">accepted</option>
              </select>
            </label>
            <div class="actions">
              <button type="button" :disabled="busy" @click="prepareRefundFixture">构造测试夹具（super，非正式售价）</button>
              <button type="button" :disabled="busy" @click="listRefunds">读取退款申请</button>
              <button type="button" :disabled="busy" @click="reviewRefund">审核建议（operations）</button>
              <button type="button" :disabled="busy" @click="executeRefund">整笔执行（super，非 Apple）</button>
              <button type="button" :disabled="busy" @click="recordRefundChannel">录入渠道最终结果（测试夹具）</button>
              <button type="button" class="ghost" :disabled="busy" @click="listReconcileDiffs">查看日账差异</button>
              <button type="button" class="ghost" @click="copyRefundLeftover">复制本轮退款 leftover</button>
            </div>
            <p class="status">{{ refundStatus }}</p>
            <pre>{{ refundView }}</pre>
            <pre>{{ refundEvidence }}</pre>
          </div>
        </section>

        <section class="page" :class="{ 'is-active': currentPage === 'admin-ranking' }" data-page="admin-ranking">
          <p class="breadcrumb">{{ PAGES["admin-ranking"].group }} / {{ PAGES["admin-ranking"].title }}</p>
          <div class="page-head">
            <div>
              <h1 class="page-title">榜单治理（四维排行榜快照）</h1>
              <p class="page-desc">
                总分、分类、周进步、月进步四个榜单由服务端快照提供。重建会先写齐该代全部名次行，再切换板块头；
                失败时继续提供上一完整代并显示「更新延迟」。免费卷与 VIP 卷统一计入，<strong>没有费用筛选</strong>。
                历史累计总分与可追溯榜值的差异只做显式说明，<strong>不补记历史事件</strong>。
              </p>
            </div>
          </div>
          <div class="card">
            <p class="status">读取状态任意已启用后台角色可看；重建并发布需要 super 角色，且必须填写原因（写审计）。</p>
            <label>
              重建原因（写审计）
              <input v-model="rReason" autocomplete="off" />
            </label>
            <div class="actions">
              <button type="button" :disabled="busy" @click="loadRankingStatus">读取榜单快照状态</button>
              <button type="button" :disabled="busy" @click="rebuildRankingSnapshot()">重建并发布榜单快照</button>
              <button type="button" class="ghost" :disabled="busy" @click="rebuildRankingSnapshot(['category'])">只重建分类榜</button>
              <button type="button" class="ghost" @click="copyRankingEvidence">复制榜单治理证据</button>
            </div>
            <p class="status">{{ rStatus }}</p>
            <pre data-testid="ranking-status">{{ rView }}</pre>
            <pre data-testid="ranking-evidence">{{ rEvidence }}</pre>
          </div>
        </section>

        <section class="page" :class="{ 'is-active': currentPage === 'admin-members' }" data-page="admin-members">
          <p class="breadcrumb">{{ PAGES["admin-members"].group }} / {{ PAGES["admin-members"].title }}</p>
          <div class="page-head">
            <div>
              <h1 class="page-title">{{ PAGES["admin-members"].title }}</h1>
              <p class="page-desc">{{ PAGES["admin-members"].desc }}</p>
            </div>
          </div>
          <div class="card">
            <label>昵称筛选<input v-model="memberQuery" autocomplete="off" /></label>
            <label>会员 ID<input v-model="memberIdInput" autocomplete="off" /></label>
            <label>原因（停用/禁榜/恢复必填）<input v-model="memberReason" autocomplete="off" /></label>
            <div class="actions">
              <button type="button" :disabled="busy" @click="listAdminMembersPage">列出会员</button>
              <button type="button" :disabled="busy" @click="getAdminMemberPage">读取详情</button>
              <button type="button" :disabled="busy" @click="setMemberDisabled(true)">停用（super）</button>
              <button type="button" :disabled="busy" @click="setMemberDisabled(false)">恢复写权限</button>
              <button type="button" :disabled="busy" @click="setRankingBanned(true)">禁榜（super）</button>
              <button type="button" :disabled="busy" @click="setRankingBanned(false)">解除禁榜</button>
            </div>
            <p class="muted">注销状态只读。停用走 disable，不是注销。content 仍无订单明细。响应不含 OPENID。</p>
            <p class="status">{{ memberStatus }}</p>
            <pre>{{ memberView }}</pre>
            <pre>{{ memberEvidence }}</pre>
          </div>
        </section>

        <section class="page" :class="{ 'is-active': currentPage === 'admin-ops' }" data-page="admin-ops">
          <p class="breadcrumb">{{ PAGES["admin-ops"].group }} / {{ PAGES["admin-ops"].title }}</p>
          <div class="page-head">
            <div>
              <h1 class="page-title">{{ PAGES["admin-ops"].title }}</h1>
              <p class="page-desc">{{ PAGES["admin-ops"].desc }}</p>
            </div>
          </div>
          <div class="card">
            <h2 class="page-title">基础统计</h2>
            <p class="muted">
              平均分按全部有效已交卷记录计算。重复练习计入次数。已确认收款是流水，不是净利润。金额用分，时间用 ISO。有效 VIP 与 MW20 同一判权：now &lt; expiresAt。content 看不到收款金额。
            </p>
            <div class="actions">
              <button type="button" :disabled="busy" @click="loadOpsStats(false)">读取统计</button>
              <button type="button" class="ghost" :disabled="busy" @click="loadOpsStats(true)">写入本轮统计夹具快照</button>
              <button type="button" class="ghost" @click="copyOpsLeftover">复制本轮统计 leftover</button>
            </div>
            <p class="status">{{ opsStatus }}</p>
            <p
              v-if="opsStats"
              class="scan-truncated-banner"
              :class="{ 'is-truncated': opsStats.scanTruncated === true }"
              data-testid="ops-scan-truncated"
              role="status"
            >
              {{ opsScanNotice }}
            </p>
            <div v-if="opsStats" class="stats-grid">
              <div><strong>注册会员数</strong><span>{{ opsStats.registeredMembers }}</span></div>
              <div><strong>当日完成记录</strong><span>{{ opsStats.completedRecordsToday }}</span></div>
              <div><strong>累计完成记录</strong><span>{{ opsStats.completedRecordsTotal }}</span></div>
              <div><strong>独立答题人数</strong><span>{{ opsStats.uniqueAnswerers }}</span></div>
              <div><strong>有效 VIP</strong><span>{{ opsStats.activeVipCount }}</span></div>
              <div><strong>付款订单数</strong><span>{{ opsStats.paidOrderCount }}</span></div>
              <div><strong>已确认收款</strong><span>{{ opsFen(opsStats.confirmedReceiptFen) }}（流水，不是利润）</span></div>
              <div><strong>退款金额</strong><span>{{ opsFen(opsStats.refundedFen) }}</span></div>
              <div><strong>异常开通订单</strong><span>{{ opsStats.abnormalGrantOrderCount }}</span></div>
              <div class="stat-scan" :class="{ 'is-truncated': opsStats.scanTruncated === true }">
                <strong>scanTruncated</strong>
                <span>{{ opsStats.scanTruncated === true ? "true：未扫全，数字不是全集" : "false：本轮扫描未截断" }}</span>
              </div>
            </div>
            <p class="muted">当日窗口 {{ String(opsStats?.dayKey || "未读取") }}。生成时间 {{ String(opsStats?.generatedAt || "—") }}。{{ opsStats ? opsScanNotice : "" }}</p>
            <table v-if="Array.isArray(opsStats?.papers) && (opsStats.papers as unknown[]).length" class="stats-table">
              <thead>
                <tr>
                  <th>试卷</th>
                  <th>完成次数（含重复练习）</th>
                  <th>平均得分（全部有效已交卷）</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in (opsStats.papers as Array<{ paperId: string; paperTitle: string; completedCount: number; averageScore: number }>)" :key="row.paperId">
                  <td>{{ row.paperTitle || row.paperId }}</td>
                  <td>{{ row.completedCount }}</td>
                  <td>{{ row.averageScore }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="card">
            <h2 class="page-title">异常入口</h2>
            <p class="muted">接到已有能力，不另造工单。</p>
            <div class="actions">
              <button
                v-for="row in opsExceptions"
                :key="row.kind"
                type="button"
                @click="openOpsPage(row.page)"
              >
                {{ row.kind }}（{{ row.count }}）→ {{ row.action }}
              </button>
              <button type="button" @click="openOpsPage('admin-orders')">对账差异 / 异常开通</button>
              <button type="button" @click="openOpsPage('admin-refunds')">待处理退款</button>
            </div>
            <p v-for="row in opsExceptions" :key="`${row.kind}-note`" class="muted">{{ row.note }}</p>
          </div>
          <div class="card">
            <h2 class="page-title">逐步操作教程</h2>
            <p class="muted">每步打开现有页 / 现有命令。不能用假按钮代替。MW12 仍是部分完成。</p>
            <ol class="tutorial-list">
              <li v-for="step in opsTutorial" :key="step.id">
                <div class="actions">
                  <button type="button" @click="openOpsPage(step.page)">{{ step.step }}. {{ step.title }}</button>
                </div>
                <p class="muted">action：{{ step.actions.join(" / ") }}。执行角色 {{ step.executeRole }}。{{ step.note }}</p>
              </li>
            </ol>
          </div>
          <div class="card">
            <label>处理说明<input v-model="feedbackNote" autocomplete="off" /></label>
            <div class="actions">
              <button type="button" :disabled="busy" @click="listFeedbacksPage">列出开放反馈</button>
              <button type="button" :disabled="busy" @click="resolveFeedbackPage">处理最近一条</button>
              <button type="button" class="ghost" @click="copyFeedbackLeftover">复制本轮反馈 leftover</button>
            </div>
            <p class="status">{{ feedbackStatus }}</p>
            <pre>{{ feedbackView }}</pre>
            <pre>{{ feedbackEvidence }}</pre>
            <pre>{{ opsView }}</pre>
            <pre>{{ opsEvidence }}</pre>
          </div>
        </section>

        <section class="page" :class="{ 'is-active': currentPage === 'admin-jobs' }" data-page="admin-jobs">
          <p class="breadcrumb">{{ PAGES["admin-jobs"].group }} / {{ PAGES["admin-jobs"].title }}</p>
          <div class="page-head">
            <div>
              <h2 class="page-title">任务查询与恢复</h2>
              <p class="page-desc">{{ PAGES["admin-jobs"].desc }}</p>
            </div>
          </div>
          <div class="card">
            <label>
              任务 ID
              <input v-model="jobId" autocomplete="off" />
            </label>
            <label>
              恢复原因
              <input v-model="resumeReason" autocomplete="off" />
            </label>
            <div class="actions">
              <button type="button" :disabled="busy || !jobId" @click="runJob('job.get')">已登录 job.get</button>
              <button type="button" :disabled="busy || !jobId" @click="runJob('job.resume')">已登录 job.resume</button>
            </div>
            <pre v-if="jobResult" data-testid="job-result">{{ jobResult }}</pre>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

