<script setup lang="ts">
import { computed, ref } from "vue";
import type { Quote, QuoteRevision } from "../types";
import {
  checkSnapshot,
  deleteQuote,
  reviseQuote,
  sendDraft,
  useDeskStore,
} from "../lib/store";
import { formatMoney, formatPercent, type ReconcileResult } from "../lib/pricing";
import AppModal from "./AppModal.vue";

const emit = defineEmits<{
  notice: [text: string, kind: "ok" | "error"];
}>();

const { quotes, rates } = useDeskStore();

const statusFilter = ref<"全部" | "已发送" | "草稿">("全部");
const serviceFilter = ref("全部服务");

const filtered = computed(() =>
  [...quotes.value]
    .filter((quote) => statusFilter.value === "全部" || quote.status === statusFilter.value)
    .filter((quote) => serviceFilter.value === "全部服务" || quote.service === serviceFilter.value)
    .sort((a, b) => (b.sentAt ?? b.createdAt).localeCompare(a.sentAt ?? a.createdAt))
);

function latest(quote: Quote): QuoteRevision | null {
  return quote.revisions.length ? quote.revisions[quote.revisions.length - 1] : null;
}

function first(quote: Quote): QuoteRevision | null {
  return quote.revisions.length ? quote.revisions[0] : null;
}

/* ---------------- 发送草稿 ---------------- */

function handleSendDraft(quote: Quote) {
  const result = sendDraft(quote.id);
  if (!result.ok) {
    const text: Record<string, string> = {
      无该组合运价: "该客户等级 + 线路 + 服务没有生效运价版本",
      重量超出重段: "计费重超出全部约定重段",
      当前不在有效期内: "当前日期不在运价有效期内",
      运价版本已撤销: "适用运价版本已撤销且无替代版本",
      未选择: "报价信息不完整",
    };
    emit("notice", `报价 ${quote.quoteNo} 发送被阻止:${text[result.reason ?? "未选择"]}`, "error");
    return;
  }
  emit("notice", `报价 ${quote.quoteNo} 已冻结并发送`, "ok");
}

function handleDelete(quote: Quote) {
  if (deleteQuote(quote.id)) emit("notice", `草稿 ${quote.quoteNo} 已删除`, "ok");
}

/* ---------------- 修订 ---------------- */

const reviseTarget = ref<Quote | null>(null);
const reviseWeight = ref<number>(0);
const reviseReason = ref("");
const reviseError = ref("");
const revisePreview = computed(() => {
  if (!reviseTarget.value) return null;
  return (() => {
    const quote = reviseTarget.value!;
    const rate = rates.value.find((item) => {
      if (
        item.status !== "生效中" ||
        item.grade !== quote.grade ||
        item.route !== quote.route ||
        item.service !== quote.service
      )
        return false;
      const weight = Number(reviseWeight.value) || 0;
      return weight >= item.weightMin && (item.weightMax === null || weight <= item.weightMax);
    });
    if (!rate) return null;
    const today = new Date().toISOString().slice(0, 10);
    if (today < rate.validFrom || today > rate.validTo) return null;
    const base = Math.max(rate.baseFee, Number(reviseWeight.value) * rate.unitPrice);
    return { rate, total: Math.round((base * (1 + rate.fuelRate) + Number.EPSILON) * 100) / 100 };
  })();
});

function openRevise(quote: Quote) {
  reviseTarget.value = quote;
  reviseWeight.value = quote.chargeableWeight;
  reviseReason.value = "";
  reviseError.value = "";
}

function confirmRevise() {
  if (!reviseReason.value.trim()) {
    reviseError.value = "修订必须填写原因,该原因会写入修订链留痕。";
    return;
  }
  const result = reviseQuote(
    reviseTarget.value!.id,
    Number(reviseWeight.value),
    reviseReason.value.trim()
  );
  if (!result.ok) {
    const text: Record<string, string> = {
      无该组合运价: "无适用运价版本,无法修订",
      重量超出重段: "计费重超出全部约定重段,无法修订",
      当前不在有效期内: "当前不在运价有效期内,无法修订",
      运价版本已撤销: "适用运价版本已撤销且无替代版本,无法修订",
      未选择: "请填写有效的计费重",
    };
    reviseError.value = text[result.reason ?? "未选择"];
    return;
  }
  emit("notice", `报价 ${reviseTarget.value.quoteNo} 已追加第 ${latest(reviseTarget.value)?.revisionNo} 版修订,原报价保留`, "ok");
  reviseTarget.value = null;
}

/* ---------------- 快照核对 ---------------- */

const checkTarget = ref<Quote | null>(null);
const checkResults = ref<{ revision: QuoteRevision; result: ReconcileResult }[]>([]);

function openCheck(quote: Quote) {
  checkTarget.value = quote;
  checkResults.value = quote.revisions.map((revision) => ({
    revision,
    result: checkSnapshot(revision.snapshot),
  }));
}

const verdictClass: Record<ReconcileResult["verdict"], string> = {
  一致: "v-ok",
  版本已撤销: "v-revoked",
  运价已调整: "v-changed",
  快照被篡改: "v-tampered",
};
</script>

<template>
  <section class="panel chain">
    <div class="toolbar">
      <div>
        <h2>报价链</h2>
        <p class="panel-hint">已发送报价不可覆盖,只能追加带原因修订;点击「核对快照」按冻结记录追溯。</p>
      </div>
      <div class="filters">
        <select v-model="statusFilter">
          <option>全部</option>
          <option>已发送</option>
          <option>草稿</option>
        </select>
        <select v-model="serviceFilter">
          <option>全部服务</option>
          <option>标准达</option>
          <option>次日达</option>
          <option>冷链</option>
        </select>
      </div>
    </div>

    <div v-if="filtered.length === 0" class="empty">暂无匹配报价</div>

    <div class="quote-list">
      <article v-for="quote in filtered" :key="quote.id" class="quote-card">
        <header class="quote-head">
          <div class="quote-id">
            <span class="mono strong">{{ quote.quoteNo }}</span>
            <span class="badge" :class="quote.status === '已发送' ? 'b-active' : 'b-draft'">{{ quote.status }}</span>
            <span v-if="quote.revisions.length > 1" class="rev-count">
              {{ quote.revisions.length }} 版（含 {{ quote.revisions.length - 1 }} 次修订）
            </span>
          </div>
          <div class="quote-people">
            <strong>{{ quote.customerName }}</strong>
            <span class="grade" :class="`g-${quote.grade}`">{{ quote.grade }}</span>
          </div>
        </header>

        <div class="quote-line">
          <span>{{ quote.route }}</span>
          <span>{{ quote.service }}</span>
          <span>计费重 {{ quote.chargeableWeight }}kg</span>
        </div>

        <!-- 已发送: 只展示冻结快照, 不提供编辑 -->
        <div v-if="latest(quote)" class="snapshot-box">
          <div class="snapshot-row">
            <span class="mono dim">版本 {{ latest(quote)!.snapshot.rateVersionId }}</span>
            <span class="dim">冻结于 {{ latest(quote)!.snapshot.frozenAt.slice(0, 10) }}</span>
          </div>
          <div class="snapshot-figures">
            <span>单价 <strong>{{ formatMoney(latest(quote)!.snapshot.unitPrice) }}/kg</strong></span>
            <span>燃油 <strong>{{ formatPercent(latest(quote)!.snapshot.fuelRate) }}</strong></span>
            <span class="total">总额 <strong>{{ formatMoney(latest(quote)!.snapshot.totalAmount) }}</strong></span>
            <span class="dim">有效期至 {{ latest(quote)!.snapshot.validTo }}</span>
          </div>
        </div>

        <p class="quote-remark">{{ quote.remark || "无备注" }}</p>

        <footer class="quote-actions">
          <template v-if="quote.status === '草稿'">
            <button type="button" class="small" @click="handleSendDraft(quote)">匹配并发送</button>
            <button type="button" class="secondary small" @click="handleDelete(quote)">删除草稿</button>
          </template>
          <template v-else>
            <button type="button" class="small" @click="openRevise(quote)">新建修订</button>
            <button type="button" class="secondary small" @click="openCheck(quote)">
              核对快照<span v-if="quote.revisions.length"> ({{ quote.revisions.length }})</span>
            </button>
          </template>
        </footer>
      </article>
    </div>

    <!-- 修订弹窗 -->
    <AppModal v-if="reviseTarget" title="新建带原因的修订" width="500px" @close="reviseTarget = null">
      <p class="revise-note">
        原报价 {{ reviseTarget.quoteNo }} 及其全部快照保留不变,本次修订将作为新版本追加到报价链。
      </p>
      <label>
        修订后计费重 kg
        <input v-model.number="reviseWeight" type="number" min="0.1" step="0.1" />
      </label>
      <div v-if="revisePreview" class="revise-preview">
        将匹配现行版本 <span class="mono">{{ revisePreview.rate.id }}</span
        >，冻结总额 <strong>{{ formatMoney(revisePreview.total) }}</strong>
      </div>
      <div v-else class="revise-preview bad">当前重量下无生效运价版本,该修订将被阻止。</div>
      <label>
        修订原因 <span class="req">*</span>
        <textarea v-model="reviseReason" placeholder="例如:客户变更货物重量 / 换签新版合同 / 温区升级"></textarea>
      </label>
      <p v-if="reviseError" class="field-error">{{ reviseError }}</p>
      <div class="modal-actions">
        <button type="button" class="secondary" @click="reviseTarget = null">取消</button>
        <button type="button" :disabled="!revisePreview" @click="confirmRevise">冻结修订并发送</button>
      </div>
    </AppModal>

    <!-- 快照核对弹窗 -->
    <AppModal v-if="checkTarget" :title="`快照核对 · ${checkTarget.quoteNo}`" width="620px" @close="checkTarget = null">
      <div class="check-list">
        <div v-for="item in checkResults" :key="item.revision.revisionNo" class="check-item">
          <header>
            <span class="rev-tag">
              {{ item.revision.revisionNo === 0 ? "首发版 V0" : `修订 V${item.revision.revisionNo}` }}
            </span>
            <span class="badge" :class="verdictClass[item.result.verdict]">{{ item.result.verdict }}</span>
            <span class="mono dim">{{ item.revision.snapshot.rateVersionId }}</span>
          </header>
          <div class="check-figures">
            <span>单价 {{ formatMoney(item.revision.snapshot.unitPrice) }}/kg</span>
            <span>燃油 {{ formatPercent(item.revision.snapshot.fuelRate) }}</span>
            <span>冻结总额 {{ formatMoney(item.revision.snapshot.totalAmount) }}</span>
            <span v-if="item.result.currentTotal !== undefined && item.result.verdict !== '一致'" class="dim">
              台账现算 {{ formatMoney(item.result.currentTotal) }}
            </span>
          </div>
          <p class="check-reason">{{ item.revision.reason }}</p>
          <p class="check-detail">{{ item.result.detail }}</p>
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="secondary" @click="checkTarget = null">关闭</button>
      </div>
    </AppModal>
  </section>
</template>
