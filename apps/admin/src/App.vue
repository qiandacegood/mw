<script setup lang="ts">
import { computed, ref } from "vue";
import {
  callAdminCategory,
  callAdminJob,
  callAdminQuestion,
  callAdminPaper,
  completeAdminUpload,
  createAdminApp,
  loginAndReadAdmin,
  signOutAdmin,
  type AdminCallResult,
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
