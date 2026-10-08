<script setup lang="ts">
import { ref } from "vue";
import { callAdminJob, createAdminApp, loginAndReadAdmin, signOutAdmin, type AdminSession } from "./cloudbase-web";

const username = ref("");
const password = ref("");
const status = ref("尚未登录。请在本页输入用户名和密码，不要把密码发给对话。");
const session = ref<AdminSession | null>(null);
const busy = ref(false);
const jobId = ref(new URLSearchParams(window.location.search).get("jobId") || "");
const resumeReason = ref("human resume after needsReview");
const jobResult = ref("");

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
  } catch (error) {
    password.value = "";
    session.value = { loggedIn: false, uidPresent: false, roles: [], error: "登录失败" };
    status.value = error instanceof Error ? error.message : "登录失败";
  } finally {
    busy.value = false;
  }
}

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
    <h1>思维工坊后台登录</h1>
    <p>使用 CloudBase 用户名密码。密码只在浏览器本次提交，不写入记录。</p>
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
</style>
