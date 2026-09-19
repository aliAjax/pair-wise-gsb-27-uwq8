<script setup lang="ts">
import type { QuoteSnapshot } from "../types";

defineProps<{
  snapshot: QuoteSnapshot;
  compact?: boolean;
}>();
</script>

<template>
  <div class="snapshot" :class="{ compact }">
    <div class="snap-row">
      <span>冻结单价</span>
      <strong>¥{{ snapshot.unitPrice.toFixed(2) }}/kg</strong>
    </div>
    <div class="snap-row">
      <span>燃油附加费率</span>
      <strong>{{ (snapshot.fuelRate * 100).toFixed(1) }}%</strong>
    </div>
    <div class="snap-row">
      <span>最低收费</span>
      <strong>¥{{ snapshot.minCharge.toFixed(2) }}</strong>
    </div>
    <div class="snap-row">
      <span>基础运费</span>
      <strong>¥{{ snapshot.baseFreight.toFixed(2) }}</strong>
    </div>
    <div class="snap-row">
      <span>燃油附加费</span>
      <strong>¥{{ snapshot.fuelSurcharge.toFixed(2) }}</strong>
    </div>
    <div class="snap-row total">
      <span>总额（冻结）</span>
      <strong>¥{{ snapshot.totalAmount.toFixed(2) }}</strong>
    </div>
  </div>
</template>
