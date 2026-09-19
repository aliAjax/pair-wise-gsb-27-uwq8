<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { storeToRefs } from "pinia";
import { useDeskStore, type RateDraft } from "../store";
import { GRADES, SERVICES, todayStr } from "../pricing";
import type { RateStatus } from "../types";

const store = useDeskStore();
const { rates } = storeToRefs(store);

const blank = (): RateDraft => ({
  grade: "战略客户",
  route: "",
  service: "标准达",
  minWeight: 0,
  maxWeight: null,
  unitPrice: 6,
  fuelRate: 0.09,
  minCharge: 100,
  effectiveFrom: todayStr(),
  effectiveTo: null,
  quoteValidDays: 7,
  note: "",
});

const form = reactive<RateDraft>(blank());
const message = ref("");
const messageType = ref<"ok" | "err">("ok");
const statusFilter = ref<"全部" | RateStatus>("全部");

const filtered = computed(() =>
  [...rates.value]
    .filter((r) => statusFilter.value === "全部" || r.status === statusFilter.value)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
);

function submit() {
  message.value = "";
  try {
    const v = store.addRate({ ...form });
    messageType.value = "ok";
    message.value = `运价版本 ${v.code} 已生效；与同维度重叠的旧版本有效期已截断并记录顶替关系。`;
    Object.assign(form, blank(), { grade: form.grade, service: form.service, route: form.route });
  } catch (e) {
    messageType.value = "err";
    message.value = (e as Error).message;
  }
}

function revoke(id: string, code: string) {
  const reason = window.prompt(`撤销运价版本 ${code} 的原因（必填）：\n撤销后新报价不可再匹配此版本，历史报价仍按快照核对。`);
  if (reason === null) return;
  try {
    store.revokeRate(id, reason);
  } catch (e) {
    window.alert((e as Error).message);
  }
}

function remove(id: string, code: string) {
  if (!window.confirm(`确认删除运价版本 ${code}？仅未被任何报价引用的版本可删除。`)) return;
  try {
    store.deleteRate(id);
  } catch (e) {
    window.alert((e as Error).message);
  }
}

const activeCount = computed(() => rates.value.filter((r) => r.status === "生效中").length);
</script>

<template>
  <section class="rate-manager">
    <form class="panel" @submit.prevent="submit">
      <h2>运价版本建档</h2>
      <p class="hint">同等级 / 线路 / 服务，且重量区间与生效区间重叠的旧版本会被新版本顶替。</p>
      <div class="form-grid">
        <label>客户等级
          <select v-model="form.grade">
            <option v-for="g in GRADES" :key="g" :value="g">{{ g }}</option>
          </select>
        </label>
        <label>运输线路
          <input v-model="form.route" placeholder="如 上海-南京" required />
        </label>
        <label>服务类型
          <select v-model="form.service">
            <option v-for="s in SERVICES" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>
        <label>重量下限 kg
          <input v-model.number="form.minWeight" type="number" min="0" step="0.01" required />
        </label>
        <label>重量上限 kg（空为不限）
          <input
            :value="form.maxWeight ?? ''"
            type="number" min="0" step="0.01"
            placeholder="不限"
            @input="form.maxWeight = ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value)"
          />
        </label>
        <label>单价 元/kg
          <input v-model.number="form.unitPrice" type="number" min="0.01" step="0.01" required />
        </label>
        <label>燃油费率
          <input v-model.number="form.fuelRate" type="number" min="0" max="0.99" step="0.005" required />
        </label>
        <label>最低收费 元
          <input v-model.number="form.minCharge" type="number" min="0" step="1" required />
        </label>
        <label>生效日期
          <input v-model="form.effectiveFrom" type="date" required />
        </label>
        <label>失效日期（空为长期）
          <input :value="form.effectiveTo ?? ''" type="date" @input="form.effectiveTo = ($event.target as HTMLInputElement).value || null" />
        </label>
        <label>报价默认有效期（天）
          <input v-model.number="form.quoteValidDays" type="number" min="1" step="1" required />
        </label>
        <label class="full">备注
          <textarea v-model="form.note" placeholder="合同条款、换版说明等" />
        </label>
      </div>
      <div class="form-actions">
        <button type="submit">建档并生效</button>
      </div>
      <p v-if="message" :class="messageType === 'ok' ? 'match-ok' : 'blocked'">{{ message }}</p>
    </form>

    <section class="panel rate-list">
      <div class="toolbar">
        <h2>运价版本（{{ rates.length }}，生效中 {{ activeCount }}）</h2>
        <select v-model="statusFilter">
          <option value="全部">全部状态</option>
          <option value="生效中">生效中</option>
          <option value="已撤销">已撤销</option>
        </select>
      </div>

      <div class="rate-rows">
        <article v-for="r in filtered" :key="r.id" class="rate-row" :class="{ revoked: r.status === '已撤销' }">
          <header class="rate-head">
            <div>
              <strong>{{ r.code }}</strong>
              <span class="status-badge" :class="r.status === '生效中' ? 'st-sent' : 'st-closed'">
                {{ r.status }}
              </span>
            </div>
            <span class="rate-dim">{{ r.grade }} · {{ r.route }} · {{ r.service }}</span>
          </header>
          <div class="rate-grid">
            <span>重量区间：{{ r.minWeight }} ~ {{ r.maxWeight ?? "∞" }}kg</span>
            <span>单价：¥{{ r.unitPrice.toFixed(2) }}/kg</span>
            <span>燃油：{{ (r.fuelRate * 100).toFixed(1) }}%</span>
            <span>最低收费：¥{{ r.minCharge.toFixed(2) }}</span>
            <span>生效：{{ r.effectiveFrom }} ~ {{ r.effectiveTo ?? "长期" }}</span>
            <span>报价有效期：{{ r.quoteValidDays }} 天</span>
          </div>
          <p v-if="r.supersedesId" class="sup-link">
            顶替上一版本：{{ store.rateById(r.supersedesId)?.code ?? r.supersedesId }}
          </p>
          <p v-if="r.revokeReason" class="rev-reason">撤销原因：{{ r.revokeReason }}（{{ r.revokedAt?.slice(0, 10) }}）</p>
          <p v-else-if="r.note" class="note-line">备注：{{ r.note }}</p>
          <div class="rate-actions">
            <button v-if="r.status === '生效中'" type="button" class="danger ghost" @click="revoke(r.id, r.code)">
              撤销版本
            </button>
            <button type="button" class="secondary" @click="remove(r.id, r.code)">删除</button>
          </div>
        </article>
      </div>
    </section>
  </section>
</template>
