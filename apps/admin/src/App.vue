<script setup lang="ts">
import { computed, ref } from "vue";
import {
  paperIdForSourceKey,
  paperTemplateCsv,
  questionIdForSourceKey,
  questionTemplateCsv
} from "@mw/shared";
import {
  callAdminCategory,
  callAdminGrowth,
  callAdminJob,
  callAdminQuestion,
  callAdminPaper,
  callAdminImport,
  callAdminRanking,
  completeAdminUpload,
  createAdminApp,
  loginAndReadAdmin,
  signOutAdmin,
  type AdminCallResult,
  type AdminGrowthAction,
  type AdminRankingAction,
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
const pItemText = ref("");
const pPreview = ref("");
const pEvidence = ref("");
const pLocalStatus = ref("先在上方题库保存至少 1 道虚构题，再点「加入上方当前题」。不要手填 111、222 这种假号。");
const knownPapers = ref<string[]>([]);
const knownPaperVersions = ref<string[]>([]);
const knownChunks = ref<string[]>([]);
const knownAnswers = ref<string[]>([]);
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
/** MW17 榜单治理：快照状态、真实更新时间与更新延迟都由服务端返回，本页不伪造。 */
const rReason = ref("MW17 重建四维榜单快照");
const rStatus = ref("先点「读取榜单快照状态」，再按需「重建并发布榜单快照」。重建需要 super 角色。");
const rView = ref("");
const rEvidence = ref("");
/** 与产品说明书一致的初始建议门槛：用于「填入提高门槛」时整体抬高且保持严格递增。 */
const RECOMMENDED_MIN_SCORES = [0, 100, 300, 800, 1500, 3000];

function rememberId(list: { value: string[] }, id: string): void {
  if (id && !list.value.includes(id)) list.value = [...list.value, id];
}

const selected = computed(() => nodes.value.find((row) => (row.categoryId || row.id) === selectedId.value));

function nodeId(row: CategoryNode): string {
  return row.categoryId || row.id;
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
    status.value = result.ok ? "已更新" : `更新失败：${result.error?.code}`;
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
    } else {
      status.value = `保存失败：${result.error?.code}`;
    }
  } finally {
    busy.value = false;
  }
}

async function loadQuestion(): Promise<void> {
  if (!qQuestionId.value) {
    status.value = "没有 questionId";
    return;
  }
  busy.value = true;
  previewFailed.value = false;
  try {
    const result = await runQuestion("question.get", { questionId: qQuestionId.value });
    if (!result.ok) {
      status.value = `读取失败：${result.error?.code}`;
      return;
    }
    const question = (result.data?.question || {}) as Record<string, unknown>;
    qRevision.value = Number(question.revision || 0);
    qVersionId.value = String(question.versionId || result.data?.question && (result.data.question as { versionId?: string }).versionId || "");
    qStatus.value = String(question.status || "");
    qComplete.value = result.data?.complete === true;
    const missing = Array.isArray((question as { missingAssets?: unknown[] }).missingAssets)
      ? (question as { missingAssets: Array<{ assetId: string; kind: string }> }).missingAssets
      : [];
    qMissing.value = missing.map((item) => `${item.kind}:${item.assetId.slice(0, 8)}`).join(",");
    const assets = Array.isArray(result.data?.assets) ? (result.data?.assets as Array<Record<string, unknown>>) : [];
    const prompt = assets.find((item) => item.kind === "prompt");
    const analysis = assets.find((item) => item.kind === "analysis");
    previewUrl.value = typeof prompt?.readUrl === "string" ? prompt.readUrl : "";
    previewKind.value = previewUrl.value ? "prompt" : "";
    if (!qComplete.value || missing.length) {
      previewFailed.value = true;
      status.value = "缺图，题目未完整，可重载";
    } else {
      status.value = "已读取题目";
    }
    void analysis;
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
    if (result.ok) qStatus.value = "disabled";
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
    setPaperStatus("请先滚到上方「题库」，保存一道虚构题。保存成功后这里才会出现 questionId，再点本按钮。");
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
  setPaperStatus(`已加入当前题 ${qQuestionId.value.slice(0, 12)}…，共 ${lines.length} 题。不要手填 111/222。`);
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
  rememberId(knownPapers, pPaperId.value);
  if (pActiveVersionId.value) rememberId(knownPaperVersions, pActiveVersionId.value);
}

async function savePaperDraft(): Promise<void> {
  if (!qCategoryId.value && selectedId.value) qCategoryId.value = selectedId.value;
  const items = paperItems();
  if (!items.length) {
    setPaperStatus("题目栏是空的。请先在上方题库保存题目，再点「加入上方当前题」。");
    return;
  }
  if (items.some((item) => looksLikeFakeQuestionId(item.questionId))) {
    setPaperStatus("题目栏里的 111/222/333 是假号，云端没有这些题。请清空，用「加入上方当前题」填入真实 questionId。");
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
      setPaperStatus(`发布成功 version=${pActiveVersionId.value}`);
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
    if (result.ok) applyPaperView(result.data || {});
    setPaperStatus(result.ok ? "已普通下架，只阻止新开始" : `下架失败：${result.error?.code}`);
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
    if (result.ok) applyPaperView(result.data || {});
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

async function rebuildRankingSnapshot(): Promise<void> {
  busy.value = true;
  try {
    const reason = rReason.value.trim();
    if (!reason) {
      rStatus.value = "重建被拒：请填写重建原因（写审计）。";
      return;
    }
    const result = await runRanking("ranking.rebuild", { reason });
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

async function logout(): Promise<void> {
  try {
    const app = await createAdminApp();
    await signOutAdmin(app);
  } catch {
    /* still clear local view */
  }
  session.value = null;
  status.value = "已退出";
}
</script>

<template>
  <main>
    <h1>思维工坊后台</h1>
    <p>使用 CloudBase 用户名密码。密码只在浏览器本次提交，不要把密码发给对话。</p>
    <label>
      用户名
      <input v-model="username" autocomplete="username" />
    </label>
    <label>
      密码
      <input v-model="password" type="password" autocomplete="current-password" />
    </label>
    <button type="button" :disabled="busy" @click="login">登录并读取 admin.me</button>
    <button type="button" class="ghost" :disabled="busy" @click="logout">退出</button>
    <p class="status">{{ status }}</p>
    <pre v-if="session">{{ JSON.stringify(session, null, 2) }}</pre>
    <section v-if="session?.loggedIn" data-page="admin-categories">
      <h2>类目</h2>
      <p>最多三级，一至三级都可挂卷。改父级必须走预览，本页不提交改父级成功路径。</p>
      <p>treeVersion={{ treeVersion }} · 写并发字段 expectedTreeVersion</p>
      <button type="button" :disabled="busy" @click="seedRoots">确保初始十类</button>
      <button type="button" class="ghost" :disabled="busy" @click="refreshTree">刷新树</button>
      <ul class="tree">
        <li v-for="row in nodes" :key="nodeId(row)">
          <button type="button" class="ghost" @click="pick(row)">
            {{ indent(row.depth) }}{{ row.name }} · d{{ row.depth }} · sort {{ row.sort }} ·
            {{ row.enabled ? "启用" : "停用" }}
          </button>
        </li>
      </ul>
      <label>
        父级 ID（空=一级）
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
      <button type="button" :disabled="busy" @click="createNode">新增</button>
      <button type="button" :disabled="busy" @click="updateNode({ name: nodeName })">改名</button>
      <button type="button" :disabled="busy" @click="updateNode({ sort: nodeSort })">改排序</button>
      <button type="button" :disabled="busy" @click="updateNode({ enabled: false })">停用</button>
      <button type="button" :disabled="busy" @click="updateNode({ enabled: true })">启用</button>
      <button type="button" :disabled="busy" @click="deleteNode">删除无占用</button>
      <button type="button" class="ghost" :disabled="busy" @click="tryFourth">尝试第四级</button>
      <button type="button" class="ghost" :disabled="busy" @click="tryDuplicate">尝试同级重名</button>
      <button type="button" class="ghost" :disabled="busy" @click="tryMoveParent">尝试改父级（应被拒）</button>
      <p v-if="lastError" class="status">最近错误码 {{ lastError }}</p>
      <button type="button" class="ghost" @click="copyEvidence">复制脱敏证据</button>
      <pre data-testid="category-evidence">{{ evidence }}</pre>
    </section>
    <section v-if="session?.loggedIn" data-page="admin-questions">
      <h1>题库</h1>
      <p>单选 / 多选 / 判断。解析必填。图片 ≤2MB，JPG/PNG/WebP。解析图不进公开或会员接口。</p>
      <p class="status">
        同一票据重放不用手点：选图上传成功后，页面会立刻用同一张票再传一次。状态出现「重放已拒绝」、证据里
        <code>mw-upload.replay</code> 的 <code>TICKET_REPLAY</code> 即算完成。
      </p>
      <label>
        类目 ID
        <input v-model="qCategoryId" autocomplete="off" />
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
      <p v-if="!qComplete || previewFailed" class="status">缺图或加载失败，本题不能当作完整题显示。</p>
      <div v-if="previewUrl" class="preview">
        <button type="button" class="ghost" @click="openPreview">预览 / 放大 {{ previewKind }}</button>
        <img :src="previewUrl" alt="题目图片预览" @error="previewFailed = true" />
      </div>
      <div v-if="previewOpen" class="zoom" @click="previewOpen = false">
        <img :src="previewUrl" alt="放大预览" />
      </div>
      <button type="button" :disabled="busy" @click="saveQuestion">保存题目</button>
      <button type="button" class="ghost" :disabled="busy" @click="startNewQuestion">新建下一题</button>
      <button type="button" class="ghost" :disabled="busy" @click="loadQuestion">读取并重载</button>
      <button type="button" class="ghost" :disabled="busy" @click="disableCurrent">停用当前题</button>
      <button type="button" class="ghost" @click="copyQuestionEvidence">复制题库脱敏证据</button>
      <p class="status">question revision={{ qRevision }} · status={{ qStatus }} · ticketOnce={{ lastTicketOnce }}</p>
      <pre data-testid="question-evidence">{{ qEvidence }}</pre>
    </section>
    <section v-if="session?.loggedIn" data-page="admin-papers">
      <h1>试卷编排与发布</h1>
      <p>
        组卷、整卷预览、发布、普通下架、紧急撤回。发布不等于公众上线，也不等于 MW13 首页选卷。解析图不得进公开包。
      </p>
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
        当前题库题：{{ qQuestionId || "还没有。请先在上方题库点「保存题目」" }} · 类目：{{ qCategoryId || selectedId || "未选" }}
      </p>
      <p class="status">{{ pLocalStatus }}</p>
      <label>
        题目（不要手填 111/222。用「加入上方当前题」带入真实 questionId）
        <textarea v-model="pItemText" rows="6" placeholder="先保存题库题，再点加入"></textarea>
      </label>
      <button type="button" class="ghost" :disabled="busy" @click="addCurrentQuestion">加入上方当前题</button>
      <button type="button" :disabled="busy" @click="savePaperDraft">保存草稿</button>
      <button type="button" :disabled="busy" @click="previewPaper">整卷预览</button>
      <button type="button" :disabled="busy" @click="publishPaper()">发布</button>
      <button type="button" class="ghost" :disabled="busy" @click="publishPaper('missingChunk')">故意缺块发布（应拒绝）</button>
      <button type="button" class="ghost" :disabled="busy" @click="publishPaper('badManifest')">故意坏摘要发布（应拒绝）</button>
      <button type="button" class="ghost" :disabled="busy" @click="readPublishedSnapshot">读取已发布快照</button>
      <button type="button" :disabled="busy" @click="unpublishPaper">普通下架</button>
      <label>
        紧急撤回原因
        <input v-model="pWithdrawReason" autocomplete="off" />
      </label>
      <button type="button" :disabled="busy" @click="withdrawPaper">紧急撤回</button>
      <button type="button" class="ghost" @click="copyPaperEvidence">复制试卷 knownIds</button>
      <p class="status">
        paper revision={{ pRevision }} · status={{ pStatus }} · 题数={{ pQuestionCount }} · 满分={{ pMaxScore }}
      </p>
      <pre data-testid="paper-preview">{{ pPreview }}</pre>
      <pre data-testid="paper-evidence">{{ pEvidence }}</pre>
    </section>
    <section v-if="session?.loggedIn" data-page="admin-import-questions">
      <h1>题库导入</h1>
      <p>
        UTF-8 CSV，单文件 ≤5 MB、最多 1000 个数据行。字段：导入来源键、类目标识、题型、题干、选项 A—H、正确答案、解析、默认分值、难度、可选图片素材标识。多选答案 A|C；判断 TRUE/FALSE。阻断错误整批拒绝。
      </p>
      <button type="button" class="ghost" @click="iKind = 'question'; downloadQuestionTemplate()">下载题库模板</button>
      <button type="button" class="ghost" @click="downloadFilledSamples">用当前类目生成虚构样例</button>
      <label>
        上传虚构题库 CSV
        <input type="file" accept=".csv,text/csv,text/plain" @change="iKind = 'question'; uploadImportFile(($event.target as HTMLInputElement).files?.[0])" />
      </label>
    </section>
    <section v-if="session?.loggedIn" data-page="admin-import-papers">
      <h1>试卷导入</h1>
      <p>
        同一卷一题一行。卷级字段必须一致，题序必须连续。只能引用已存在且可用的题目来源键。未先导题库的试卷导入必须失败。
      </p>
      <button type="button" class="ghost" @click="iKind = 'paper'; downloadPaperTemplate()">下载试卷模板</button>
      <label>
        上传虚构试卷 CSV
        <input type="file" accept=".csv,text/csv,text/plain" @change="iKind = 'paper'; uploadImportFile(($event.target as HTMLInputElement).files?.[0])" />
      </label>
    </section>
    <section v-if="session?.loggedIn" data-page="admin-import">
      <h2>导入预览、提交与批次</h2>
      <p class="status">{{ iStatus }}</p>
      <p class="status">kind={{ iKind }} · batchState={{ iBatchState }} · 来源键 {{ iSampleKeys.length }}</p>
      <button type="button" :disabled="busy" @click="previewImportBatch">预览当前批次</button>
      <button type="button" :disabled="busy" @click="commitImportBatch">确认提交</button>
      <button type="button" class="ghost" :disabled="busy" @click="readImportStatus">刷新批次状态</button>
      <button type="button" class="ghost" :disabled="busy" @click="readImportedDrafts">按 ID 读本批草稿</button>
      <button type="button" class="ghost" @click="copyImportEvidence">复制 knownIds</button>
      <pre data-testid="import-preview">{{ iPreview }}</pre>
      <pre data-testid="import-evidence">{{ iEvidence }}</pre>
    </section>
    <section v-if="session?.loggedIn" data-page="admin-growth">
      <h1>成长等级与勋章配置</h1>
      <p>
        门槛必须从 0 起严格递增，名称与勋章不可缺失。发布前先预览影响人数；发布会产生新配置版本、按现有总分重算等级并补发新达到的勋章，
        <strong>不删除既得勋章</strong>。上线门槛在 MW28 才冻结，本页只做可配置与预览发布。VIP 购买或到期不参与加减分。
      </p>
      <p class="status">
        configVersion={{ gConfigVersion ?? "未读取" }} · 来源={{ gConfigSource || "未读取" }} · 发布需要 super 角色，预览任意后台角色可看
      </p>
      <button type="button" :disabled="busy" @click="loadGrowthConfig">读取当前等级配置</button>
      <p class="status">
        顺序：读取 →（可选）快速填充 → 预览影响（不写库）→ 发布门槛并重算。发布以云端回读版本为准，预览不改版本。
      </p>
      <button type="button" class="ghost" :disabled="busy" @click="fillLevels('crossLevel')">填入跨级门槛 L2=5/L3=8</button>
      <button type="button" class="ghost" :disabled="busy" @click="fillLevels('raise')">填入提高门槛（建议 100 起）</button>
      <button type="button" class="ghost" :disabled="busy" @click="fillLevels('invalidFirst')">填入非法门槛（首级非 0）</button>
      <button type="button" class="ghost" :disabled="busy" @click="fillLevels('missingMedal')">填入缺勋章名</button>
      <label>
        等级门槛 JSON（levelId / name / minScore / medalId / medalName）
        <textarea v-model="gLevelsText" data-testid="growth-levels" rows="12"></textarea>
      </label>
      <label>
        发布原因（写审计）
        <input v-model="gReason" autocomplete="off" />
      </label>
      <button type="button" class="ghost" :disabled="busy" @click="previewGrowth">预览影响（不写库）</button>
      <button type="button" :disabled="busy" @click="publishGrowth">发布门槛并重算</button>
      <label>
        重算目标会员（可空；空=按扫描批量重算）
        <input v-model="gMemberId" autocomplete="off" />
      </label>
      <button type="button" class="ghost" :disabled="busy" @click="recomputeGrowthLevels">按当前门槛重算等级</button>
      <p class="status">{{ gStatus }}</p>
      <pre data-testid="growth-impact">{{ gImpact }}</pre>
      <button type="button" class="ghost" @click="copyGrowthEvidence">复制等级配置证据</button>
      <pre data-testid="growth-evidence">{{ gEvidence }}</pre>
    </section>
    <section v-if="session?.loggedIn" data-page="admin-ranking">
      <h1>榜单治理（四维排行榜快照）</h1>
      <p>
        总分、分类、周进步、月进步四个榜单由服务端快照提供。重建会先写齐该代全部名次行，再切换板块头；
        失败时继续提供上一完整代并显示「更新延迟」。免费卷与 VIP 卷统一计入，<strong>没有费用筛选</strong>。
        历史累计总分与可追溯榜值的差异只做显式说明，<strong>不补记历史事件</strong>。
      </p>
      <p class="status">读取状态任意已启用后台角色可看；重建并发布需要 super 角色，且必须填写原因（写审计）。</p>
      <label>
        重建原因（写审计）
        <input v-model="rReason" autocomplete="off" />
      </label>
      <button type="button" :disabled="busy" @click="loadRankingStatus">读取榜单快照状态</button>
      <button type="button" :disabled="busy" @click="rebuildRankingSnapshot">重建并发布榜单快照</button>
      <p class="status">{{ rStatus }}</p>
      <pre data-testid="ranking-status">{{ rView }}</pre>
      <button type="button" class="ghost" @click="copyRankingEvidence">复制榜单治理证据</button>
      <pre data-testid="ranking-evidence">{{ rEvidence }}</pre>
    </section>
    <section v-if="session?.loggedIn">
      <h2>任务查询与恢复</h2>
      <label>
        任务 ID
        <input v-model="jobId" autocomplete="off" />
      </label>
      <label>
        恢复原因
        <input v-model="resumeReason" autocomplete="off" />
      </label>
      <button type="button" :disabled="busy || !jobId" @click="runJob('job.get')">已登录 job.get</button>
      <button type="button" :disabled="busy || !jobId" @click="runJob('job.resume')">已登录 job.resume</button>
      <pre v-if="jobResult" data-testid="job-result">{{ jobResult }}</pre>
    </section>
  </main>
</template>

<style>
main {
  font-family: system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  max-width: 720px;
  margin: 32px auto;
  color: #1a202c;
}
input,
button,
pre {
  display: block;
  margin: 12px 0;
  width: 100%;
}
pre {
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  padding: 12px;
  white-space: pre-wrap;
}
button {
  background: #2b6cb0;
  color: #fff;
  border: 0;
  padding: 10px;
  border-radius: 8px;
}
button.ghost {
  background: #edf2f7;
  color: #2d3748;
}
.status {
  color: #4a5568;
}
.tree {
  padding-left: 0;
  list-style: none;
}
select,
textarea {
  display: block;
  margin: 12px 0;
  width: 100%;
}
.preview img {
  max-width: 240px;
  border: 1px solid #e2e8f0;
}
.zoom {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
}
.zoom img {
  max-width: 92vw;
  max-height: 92vh;
}
</style>
