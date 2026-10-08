<script setup lang="ts">
import { handleIsolatedAction } from "@mw/api";
import { ref } from "vue";

const paperId = ref("paper_fict_logic_l3");
const output = ref("尚未调用");

function loadPaper(): void {
  const res = handleIsolatedAction({
    apiVersion: "1",
    action: "paper.detail",
    requestId: `req_admin_${Date.now()}`,
    data: { paperId: paperId.value }
  });
  output.value = JSON.stringify(res, null, 2);
}
</script>

<template>
  <main>
    <h1>思维工坊后台最小页</h1>
    <p>隔离模拟接口 paper.detail，未连接 CloudBase。</p>
    <label>
      paperId
      <input v-model="paperId" />
    </label>
    <button type="button" @click="loadPaper">读取试卷详情</button>
    <pre>{{ output }}</pre>
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
</style>
