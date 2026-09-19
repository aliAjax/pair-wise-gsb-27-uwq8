<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { DraftForm } from "../lib/store";
import { previewMatch, saveDraft, sendFromForm, useDeskStore } from "../lib/store";
import { calcBaseFreight, calcFuel, formatMoney, formatPercent, round2 } from "../lib/pricing";

const emit = defineEmits<{
  sent: [quoteNo: string];
  blocked: [reason: string];
  drafted: [quoteNo: string];
}>();

const { customers, rates } = useDeskStore();

const routeOptions = computed(() => [...new Set(rates.value.map((rate) => rate.route))]);

const form = reactive<DraftForm>({
  customerId: "",
  route: "",
  service: "",
  chargeableWeight: null,
  remark: "",
});

const formError = ref("");

const selectedGrade = computed(
  () => customers.value.find((customer) => customer.id === form.customerId)?.grade ?? null
);

const preview = computed(() => previewMatch(form));

const matchedRate = computed(() => (preview.value.match.ok ? preview.value.match.version! : null));

const previewTotals = computed(() => {
  const rate = matchedRate.value;
  const weight = Number(form.chargeableWeight) || 0;
  if (!rate || weight <= 0) return null;
  const base = calcBaseFreight(weight, rate.unitPrice, rate.baseFee);
  const fuel = calcFuel(base, rate.fuelRate);
  return { base, fuel, total: round2(base + fuel) };
});

const failureText: Record<string, string> = {
  未选择: "请完整选择客户、线路、服务类型并填写计费重",
  无该组合运价: "该客户等级 + 线路 + 服务类型没有任何运价版本,已阻止发送",
  重量超出重段: "计费重超出该运价约定的全部重段,已阻止发送",
  当前不在有效期内: "当前日期不在任何适用版本的有效期内,已阻止发送",
  运价版本已撤销: "唯一适用的运价版本已撤销且无替代版本,已阻止发送",
};

function reset() {
  form.customerId = "";
  form.route = "";
  form.service = "";
  form.chargeableWeight = null;
  form.remark = "";
}

function handleSend() {
  formError.value = "";
  const result = sendFromForm({ ...form });
  if (!result.ok) {
    emit("blocked", failureText[result.reason ?? "未选择"] ?? "无适用运价版本,已阻止发送");
    return;
  }
  const quote = useDeskStore().quotes.value.find((item) => item.id === result.quoteId);
  emit("sent", quote?.quoteNo ?? "");
  reset();
}

function handleDraft() {
  formError.value = "";
  if (!form.customerId || !form.route || !form.service || !form.chargeableWeight) {
    formError.value = "保存草稿也需要先填齐客户、线路、服务和计费重。";
    return;
  }
  const id = saveDraft({ ...form });
  const quote = useDeskStore().quotes.value.find((item) => item.id === id);
  emit("drafted", quote?.quoteNo ?? "");
  reset();
}
</script>

<template>
  <form class="panel quote-form" @submit.prevent="handleSend">
    <h2>新建报价</h2>
    <p class="panel-hint">发送时冻结单价、燃油附加费、总额与有效期;无生效运价版本将被阻止。</p>

    <div class="form-grid">
      <label>
        客户
        <select v-model="form.customerId" required>
          <option value="">请选择客户</option>
          <option v-for="customer in customers" :key="customer.id" :value="customer.id">
            {{ customer.name }}（{{ customer.grade }}）
          </option>
        </select>
      </label>

      <label>
        运输线路
        <input
          v-model="form.route"
          list="route-options"
          placeholder="如 上海-南京"
          required
        />
        <datalist id="route-options">
          <option v-for="route in routeOptions" :key="route" :value="route" />
        </datalist>
      </label>

      <div class="two-col">
        <label>
          服务类型
          <select v-model="form.service" required>
            <option value="">请选择</option>
            <option>标准达</option>
            <option>次日达</option>
            <option>冷链</option>
          </select>
        </label>
        <label>
          计费重 kg
          <input v-model.number="form.chargeableWeight" type="number" min="0.1" step="0.1" required />
        </label>
      </div>

      <label>
        报价备注
        <textarea v-model="form.remark" placeholder="结算方式、温区、时效要求等"></textarea>
      </label>
    </div>

    <div class="preview" :class="{ ok: !!matchedRate, bad: !matchedRate && form.customerId && form.route && form.service && form.chargeableWeight }">
      <template v-if="matchedRate && previewTotals">
        <div class="preview-head">
          <span class="badge b-active">匹配生效版本</span>
          <span class="mono">{{ matchedRate.id }}</span>
          <span v-if="selectedGrade" class="grade" :class="`g-${selectedGrade}`">{{ selectedGrade }}</span>
        </div>
        <div class="preview-grid">
          <span>单价：{{ formatMoney(matchedRate.unitPrice) }}/kg</span>
          <span>起步价：{{ formatMoney(matchedRate.baseFee) }}</span>
          <span>燃油附加：{{ formatPercent(matchedRate.fuelRate) }}</span>
          <span>重段：{{ matchedRate.weightMin }}–{{ matchedRate.weightMax ?? "∞" }}kg</span>
        </div>
        <div class="preview-total">
          <span>基础运费 {{ formatMoney(previewTotals.base) }} ＋ 燃油 {{ formatMoney(previewTotals.fuel) }}</span>
          <strong>合计 {{ formatMoney(previewTotals.total) }}</strong>
        </div>
        <p class="validity">报价有效期：{{ matchedRate.validFrom }} 至 {{ matchedRate.validTo }}（发送时冻结）</p>
      </template>
      <template v-else-if="form.customerId && form.route && form.service && form.chargeableWeight">
        <div class="preview-head">
          <span class="badge b-blocked">无法报价 · 已阻止发送</span>
        </div>
        <p class="block-reason">{{ failureText[preview.match.reason ?? '未选择'] }}</p>
        <p v-if="preview.match.version" class="block-hint">
          相关版本 {{ preview.match.version.id }}
          （{{ preview.match.version.validFrom }} ~ {{ preview.match.version.validTo }}，{{ preview.match.version.status }}）
        </p>
      </template>
      <p v-else class="preview-placeholder">填写客户、线路、服务与计费重后实时匹配生效运价。</p>
    </div>

    <p v-if="formError" class="field-error">{{ formError }}</p>

    <div class="form-actions">
      <button type="button" class="secondary" @click="handleDraft">保存草稿</button>
      <button type="submit" :disabled="!matchedRate">冻结并发送</button>
    </div>
  </form>
</template>
