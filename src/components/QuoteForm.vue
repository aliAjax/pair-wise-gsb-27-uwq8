<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useDeskStore } from "../store";
import { GRADES, SERVICES } from "../pricing";
import type { ServiceType } from "../types";
import SnapshotBox from "./SnapshotBox.vue";

const props = defineProps<{
  /** 修订模式：传入父报价 id */
  parentId?: string | null;
}>();

const emit = defineEmits<{
  (e: "done"): void;
}>();

const store = useDeskStore();
const { customers } = storeToRefs(store);

const form = reactive({
  customerId: "",
  route: "",
  weight: 0 as number,
  service: "标准达" as ServiceType,
});
const note = ref("");
const reason = ref("");
const error = ref("");

const parent = computed(() =>
  props.parentId ? store.quotes.find((q) => q.id === props.parentId) ?? null : null
);

function syncFromParent() {
  if (parent.value) {
    form.customerId = parent.value.customerId;
    form.route = parent.value.route;
    form.weight = parent.value.weight;
    form.service = parent.value.service;
    note.value = parent.value.note;
  }
}
watch(() => props.parentId, syncFromParent, { immediate: true });

const ready = computed(
  () => Boolean(form.customerId) && Boolean(form.route.trim()) && form.weight > 0
);

const trial = computed(() => {
  if (!ready.value) return null;
  try {
    return {
      ok: true as const,
      data: store.preview({
        customerId: form.customerId,
        route: form.route,
        weight: Number(form.weight),
        service: form.service,
      }),
    };
  } catch (e) {
    return { ok: false as const, message: (e as Error).message };
  }
});

const preview = computed(() => (trial.value?.ok ? trial.value.data : null));
const noMatchError = computed(() =>
  trial.value && !trial.value.ok ? trial.value.message : ""
);

watch(trial, () => {
  error.value = "";
});

function reset() {
  form.customerId = "";
  form.route = "";
  form.weight = 0;
  form.service = "标准达";
  note.value = "";
  reason.value = "";
  error.value = "";
}

function send() {
  error.value = "";
  try {
    if (parent.value) {
      store.reviseQuote(
        parent.value.id,
        {
          customerId: form.customerId,
          route: form.route,
          weight: Number(form.weight),
          service: form.service,
        },
        reason.value,
        note.value
      );
    } else {
      store.sendQuote(
        {
          customerId: form.customerId,
          route: form.route,
          weight: Number(form.weight),
          service: form.service,
        },
        note.value
      );
    }
    reset();
    emit("done");
  } catch (e) {
    error.value = (e as Error).message;
  }
}

function saveDraft() {
  error.value = "";
  try {
    store.saveDraft(
      {
        customerId: form.customerId,
        route: form.route,
        weight: Number(form.weight),
        service: form.service,
      },
      note.value
    );
    reset();
    emit("done");
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>

<template>
  <form class="panel quote-form" @submit.prevent="send">
    <div class="panel-head">
      <h2>{{ parent ? `修订报价（原单 ${parent.quoteNo}）` : "新建报价" }}</h2>
      <p v-if="parent" class="hint warn">
        原报价不可覆盖，本次将生成带原因的新版本；按今日重新匹配运价。
      </p>
    </div>

    <div class="form-grid">
      <label>
        客户（等级）
        <select v-model="form.customerId" required>
          <option value="">请选择客户</option>
          <option v-for="c in customers" :key="c.id" :value="c.id">
            {{ c.name }} · {{ c.grade }}
          </option>
        </select>
      </label>
      <label>
        运输线路
        <input v-model="form.route" placeholder="如 上海-南京" required />
      </label>
      <label>
        计费重 kg
        <input v-model.number="form.weight" type="number" min="0.01" step="0.01" required />
      </label>
      <label>
        服务类型
        <select v-model="form.service">
          <option v-for="s in SERVICES" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>
      <label class="full">
        备注
        <textarea v-model="note" placeholder="客户诉求、温区、结算说明等" />
      </label>
      <label v-if="parent" class="full">
        修订原因 <span class="req">*</span>
        <textarea
          v-model="reason"
          placeholder="例如：计费重调整 / 线路变更 / 客户重谈燃油费率"
        />
      </label>
    </div>

    <div v-if="ready" class="preview-box">
      <template v-if="preview">
        <p class="match-ok">
          ✓ 命中生效运价版本 <strong>{{ preview.rate.code }}</strong>
          （{{ preview.rate.effectiveFrom }} 起
          <template v-if="preview.rate.effectiveTo">至 {{ preview.rate.effectiveTo }}</template>
          <template v-else>长期有效</template>）
        </p>
        <SnapshotBox :snapshot="preview.snapshot" compact />
        <p class="validity">
          报价有效期（冻结）：{{ preview.validFrom }} 至 {{ preview.validTo }}
        </p>
      </template>
      <p v-else class="blocked">⛔ {{ noMatchError }}</p>
    </div>

    <div class="form-actions">
      <button type="submit" :disabled="!preview || (parent ? !reason.trim() : false)">
        {{ parent ? "发送修订版" : "发送报价" }}
      </button>
      <button v-if="!parent" type="button" class="secondary" @click="saveDraft">
        存草稿
      </button>
      <button v-if="parent" type="button" class="secondary" @click="emit('done')">
        取消修订
      </button>
    </div>
    <p v-if="noMatchError && !ready" class="blocked">⛔ {{ noMatchError }}</p>
    <p v-if="error" class="blocked">⛔ {{ error }}</p>
    <p class="rule-note">
      匹配规则：客户等级 + 线路 + 服务类型 + 计费重区间 + 今日在生效期内；
      无适用版本时发送被阻止。发送瞬间冻结单价、燃油附加费、总额与有效期。
    </p>
  </form>
</template>
