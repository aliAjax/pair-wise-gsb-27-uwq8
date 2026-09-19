<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import { useDeskStore } from "./store";
import { GRADES, SERVICES } from "./pricing";
import QuoteForm from "./components/QuoteForm.vue";
import QuoteChain from "./components/QuoteChain.vue";
import RateManager from "./components/RateManager.vue";
import type { CustomerGrade, ServiceType } from "./types";

const store = useDeskStore();
const { roots, customers } = storeToRefs(store);

const tab = ref<"quotes" | "rates">("quotes");
const serviceFilter = ref<"全部" | ServiceType>("全部");
const gradeFilter = ref<"全部" | CustomerGrade>("全部");
const revisingParentId = ref<string | null>(null);
const keyword = ref("");

const filteredRoots = computed(() =>
  roots.value.filter((root) => {
    const customer = store.customerById(root.customerId);
    if (serviceFilter.value !== "全部" && root.service !== serviceFilter.value) return false;
    if (gradeFilter.value !== "全部" && customer?.grade !== gradeFilter.value) return false;
    if (keyword.value.trim()) {
      const kw = keyword.value.trim();
      if (
        !root.route.includes(kw) &&
        !root.quoteNo.includes(kw) &&
        !(customer?.name.includes(kw))
      )
        return false;
    }
    return true;
  })
);

const metrics = computed(() => {
  const chains = roots.value.length;
  const revisions = store.quotes.filter((q) => q.revisionNo > 1).length;
  const activeRates = store.rates.filter((r) => r.status === "生效中").length;
  const revokedRefs = store.quotes.filter((q) => {
    if (!q.snapshot) return false;
    return store.rateById(q.snapshot.rateVersionId)?.status === "已撤销";
  }).length;
  return [
    { label: "报价链", value: chains },
    { label: "修订版本", value: revisions },
    { label: "生效运价版本", value: activeRates },
    { label: "引用已撤销版本的报价", value: revokedRefs },
  ];
});

function startRevise(parentId: string) {
  revisingParentId.value = parentId;
  tab.value = "quotes";
}

function resetDemo() {
  if (window.confirm("重置为演示数据？当前本地修改将被清除。")) {
    store.resetDemo();
    revisingParentId.value = null;
  }
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">合同物流 · 可追溯报价台</p>
          <h1>合同运价报价台</h1>
          <p class="subtitle">
            报价按客户等级、线路、计费重与服务类型匹配生效运价版本；无适用版本阻止发送。
            发送时冻结单价、燃油附加费、总额与有效期；发送后仅允许带原因的修订，原报价不可覆盖。
          </p>
        </div>
        <div class="stack">
          <span class="tag">版本化运价</span>
          <span class="tag">快照冻结</span>
          <span class="tag">修订链可追溯</span>
          <button type="button" class="secondary mini" @click="resetDemo">重置演示数据</button>
        </div>
      </header>

      <section class="metrics">
        <article v-for="m in metrics" :key="m.label" class="metric">
          <span>{{ m.label }}</span>
          <strong>{{ m.value }}</strong>
        </article>
      </section>

      <nav class="tabs">
        <button
          type="button"
          :class="{ active: tab === 'quotes' }"
          @click="tab = 'quotes'"
        >
          报价台
        </button>
        <button
          type="button"
          :class="{ active: tab === 'rates' }"
          @click="tab = 'rates'; revisingParentId = null"
        >
          运价版本管理
        </button>
      </nav>

      <section v-if="tab === 'quotes'" class="workspace">
        <div class="left-col">
          <QuoteForm :parent-id="revisingParentId" @done="revisingParentId = null" />

          <section class="panel customers">
            <h2>客户档案（等级驱动运价匹配）</h2>
            <ul>
              <li v-for="c in customers" :key="c.id">
                <span>{{ c.name }}</span>
                <span class="grade-tag">{{ c.grade }}</span>
              </li>
            </ul>
          </section>
        </div>

        <section class="list-panel">
          <div class="toolbar">
            <h2>报价链</h2>
            <div class="filters">
              <input v-model="keyword" placeholder="搜索单号 / 客户 / 线路" class="search" />
              <select v-model="gradeFilter">
                <option value="全部">全部等级</option>
                <option v-for="g in GRADES" :key="g" :value="g">{{ g }}</option>
              </select>
              <select v-model="serviceFilter">
                <option value="全部">全部服务</option>
                <option v-for="s in SERVICES" :key="s" :value="s">{{ s }}</option>
              </select>
            </div>
          </div>

          <div class="chain-grid">
            <div v-if="filteredRoots.length === 0" class="empty">暂无匹配报价链</div>
            <QuoteChain
              v-for="root in filteredRoots"
              :key="root.id"
              :root="root"
              @revise="startRevise"
            />
          </div>
        </section>
      </section>

      <RateManager v-else />

      <footer class="foot-note">
        数据保存在浏览器 localStorage。刷新页面后报价链、运价版本状态与快照核对结果保持一致；
        撤销运价不会改写任何历史报价，核对始终以发送时冻结的快照为准。
      </footer>
    </div>
  </main>
</template>
