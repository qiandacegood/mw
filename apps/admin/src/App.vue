<script setup lang="ts">
import { computed, ref } from "vue";
import {
  callAdminCategory,
  callAdminJob,
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
</style>
