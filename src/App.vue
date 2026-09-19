<script setup lang="ts">
import { computed, ref } from "vue";
import QuoteForm from "./components/QuoteForm.vue";
import QuoteChain from "./components/QuoteChain.vue";
import RateLedger from "./components/RateLedger.vue";
import { resetToSeed, useDeskStore } from "./lib/store";

const { state } = useDeskStore();

const metrics = computed(() => {
  const sent = state.quotes.filter((quote) => quote.status === "已发送");
  const snapshotCount = sent.reduce((acc, quote) => acc + quote.revisions.length, 0);
  return [
    { label: "已发送报价", value: sent.length },
    { label: "冻结快照 / 修订", value: snapshotCount },
    { label: "生效运价版本", value: state.rates.filter((rate) => rate.status === "生效中").length },
    { label: "已撤销运价版本", value: state.rates.filter((rate) => rate.status === "已撤销").length },
  ];
});

/* ---------------- Toast ---------------- */

interface Toast {
  id: number;
  text: string;
  kind: "ok" | "error";
}

const toasts = ref<Toast[]>([]);
let toastSeq = 0;

function pushToast(text: string, kind: "ok" | "error") {
  const id = ++toastSeq;
  toasts.value.push({ id, text, kind });
  setTimeout(() => {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  }, 4200);
}

function handleReset() {
  if (window.confirm("确定恢复演示数据?当前本地修改将被清除。")) {
    resetToSeed();
    pushToast("已恢复演示运价与报价数据", "ok");
  }
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">合同物流 · 可追溯报价闭环</p>
          <h1>合同运价报价台</h1>
          <p class="subtitle">
            报价按客户等级、线路、计费重与服务类型匹配生效运价版本,无适用版本即阻止发送;
            发送时冻结单价、燃油附加费、总额与有效期。已发送报价只允许新建带原因的修订,
            原始快照永不覆盖;版本撤销后历史报价仍按快照核对。
          </p>
        </div>
        <div class="head-side">
          <div class="stack">
            <span class="tag">Vue3</span>
            <span class="tag">TypeScript</span>
            <span class="tag">快照指纹</span>
            <span class="tag">localStorage 留痕</span>
          </div>
          <button type="button" class="secondary reset-btn" @click="handleReset">恢复演示数据</button>
        </div>
      </header>

      <section class="metrics four">
        <article v-for="metric in metrics" :key="metric.label" class="metric">
          <span>{{ metric.label }}</span>
          <strong>{{ metric.value }}</strong>
        </article>
      </section>

      <section class="workspace">
        <QuoteForm
          @sent="(no) => pushToast(`报价 ${no} 已冻结并发送`, 'ok')"
          @drafted="(no) => pushToast(`草稿 ${no} 已保存,发送时才会匹配运价并冻结`, 'ok')"
          @blocked="(text) => pushToast(text, 'error')"
        />
        <QuoteChain @notice="pushToast" />
      </section>

      <RateLedger class="ledger-block" />
    </div>

    <div class="toast-stack">
      <TransitionGroup name="toast">
        <div v-for="toast in toasts" :key="toast.id" class="toast" :class="toast.kind">
          {{ toast.text }}
        </div>
      </TransitionGroup>
    </div>
  </main>
</template>
