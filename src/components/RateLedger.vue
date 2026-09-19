<script setup lang="ts">
import { computed, ref } from "vue";
import type { RateVersion } from "../types";
import { revokeRate, useDeskStore } from "../lib/store";
import { formatMoney, formatPercent } from "../lib/pricing";
import AppModal from "./AppModal.vue";

const { rates } = useDeskStore();

const gradeFilter = ref<"全部" | RateVersion["grade"]>("全部");
const routeFilter = ref("全部线路");
const statusFilter = ref<"全部状态" | "生效中" | "已撤销">("全部状态");

const routeOptions = computed(() => [...new Set(rates.value.map((rate) => rate.route))]);

const filtered = computed(() =>
  rates.value.filter(
    (rate) =>
      (gradeFilter.value === "全部" || rate.grade === gradeFilter.value) &&
      (routeFilter.value === "全部线路" || rate.route === routeFilter.value) &&
      (statusFilter.value === "全部状态" || rate.status === statusFilter.value)
  )
);

function bracket(rate: RateVersion): string {
  return rate.weightMax === null
    ? `≥${rate.weightMin}kg`
    : `${rate.weightMin}–${rate.weightMax}kg`;
}

const revokeTarget = ref<RateVersion | null>(null);
const revokeReason = ref("");
const revokeError = ref("");

function openRevoke(rate: RateVersion) {
  revokeTarget.value = rate;
  revokeReason.value = "";
  revokeError.value = "";
}

function confirmRevoke() {
  if (!revokeReason.value.trim()) {
    revokeError.value = "撤销必须填写原因,该原因会随版本留痕。";
    return;
  }
  revokeRate(revokeTarget.value!.id, revokeReason.value.trim());
  revokeTarget.value = null;
}
</script>

<template>
  <section class="panel ledger">
    <div class="toolbar">
      <div>
        <h2>运价版本台账</h2>
        <p class="panel-hint">报价按「客户等级 + 线路 + 计费重段 + 服务类型 + 有效期」匹配,撤销后不再参与新发报价。</p>
      </div>
      <div class="filters">
        <select v-model="gradeFilter">
          <option>全部</option>
          <option>VIP</option>
          <option>合约</option>
          <option>标准</option>
        </select>
        <select v-model="routeFilter">
          <option>全部线路</option>
          <option v-for="route in routeOptions" :key="route">{{ route }}</option>
        </select>
        <select v-model="statusFilter">
          <option>全部状态</option>
          <option>生效中</option>
          <option>已撤销</option>
        </select>
      </div>
    </div>

    <div class="table-wrap">
      <table class="rate-table">
        <thead>
          <tr>
            <th>版本号</th>
            <th>客户等级</th>
            <th>线路</th>
            <th>服务</th>
            <th>计费重段</th>
            <th class="num">单价</th>
            <th class="num">起步价</th>
            <th class="num">燃油附加</th>
            <th>有效期</th>
            <th>状态</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="rate in filtered" :key="rate.id" :class="{ revoked: rate.status === '已撤销' }">
            <td class="mono">{{ rate.id }}</td>
            <td><span class="grade" :class="`g-${rate.grade}`">{{ rate.grade }}</span></td>
            <td>{{ rate.route }}</td>
            <td>{{ rate.service }}</td>
            <td>{{ bracket(rate) }}</td>
            <td class="num">{{ formatMoney(rate.unitPrice) }}/kg</td>
            <td class="num">{{ formatMoney(rate.baseFee) }}</td>
            <td class="num">{{ formatPercent(rate.fuelRate) }}</td>
            <td class="date">{{ rate.validFrom }} ~ {{ rate.validTo }}</td>
            <td>
              <span class="badge" :class="rate.status === '生效中' ? 'b-active' : 'b-revoked'">
                {{ rate.status }}
              </span>
              <p v-if="rate.revokedAt" class="revoke-meta">
                {{ rate.revokedAt.slice(0, 10) }} · {{ rate.revokeReason }}
              </p>
            </td>
            <td>
              <button
                v-if="rate.status === '生效中'"
                type="button"
                class="secondary small"
                @click="openRevoke(rate)"
              >
                撤销
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="filtered.length === 0" class="empty">暂无匹配的运价版本</div>
    </div>

    <AppModal v-if="revokeTarget" title="撤销运价版本" @close="revokeTarget = null">
      <p class="revoke-warn">
        撤销后该版本将不再用于新报价匹配;已按该版本冻结的历史报价不受影响,仍以快照核对。
      </p>
      <div class="revoke-info">
        <span class="mono">{{ revokeTarget.id }}</span>
        <span>{{ revokeTarget.grade }} · {{ revokeTarget.route }} · {{ revokeTarget.service }}</span>
        <span>{{ bracket(revokeTarget) }} · 单价 {{ formatMoney(revokeTarget.unitPrice) }}/kg · 燃油 {{ formatPercent(revokeTarget.fuelRate) }}</span>
      </div>
      <label>
        撤销原因 <span class="req">*</span>
        <textarea v-model="revokeReason" placeholder="例如:承运合同终止 / 客户换签新版协议 / 定价差错"></textarea>
      </label>
      <p v-if="revokeError" class="field-error">{{ revokeError }}</p>
      <div class="modal-actions">
        <button type="button" class="secondary" @click="revokeTarget = null">取消</button>
        <button type="button" class="danger" @click="confirmRevoke">确认撤销</button>
      </div>
    </AppModal>
  </section>
</template>
