<script setup lang="ts">
import { computed } from "vue";
import { useDeskStore } from "../store";
import type { QuoteRecord } from "../types";
import SnapshotBox from "./SnapshotBox.vue";

const props = defineProps<{
  root: QuoteRecord;
}>();

const emit = defineEmits<{
  (e: "revise", parentId: string): void;
}>();

const store = useDeskStore();
const chain = computed(() => store.chainOf(props.root.rootId));
const customer = computed(() => store.customerById(props.root.customerId));

function fmtTime(iso: string | null) {
  return iso ? iso.replace("T", " ").slice(0, 16) : "—";
}

function closeWithReason(quote: QuoteRecord) {
  const reason = window.prompt(`关闭报价 ${quote.quoteNo} 的原因（必填）：`);
  if (reason === null) return;
  try {
    store.closeQuote(quote.id, reason);
  } catch (e) {
    window.alert((e as Error).message);
  }
}

function sendDraft(quote: QuoteRecord) {
  try {
    store.sendDraft(quote.id);
  } catch (e) {
    window.alert((e as Error).message);
  }
}

function removeDraft(quote: QuoteRecord) {
  try {
    store.removeQuote(quote.id);
  } catch (e) {
    window.alert((e as Error).message);
  }
}

function nextOf(quote: QuoteRecord) {
  return chain.value.find((q) => q.parentId === quote.id) ?? null;
}

const statusClass: Record<string, string> = {
  草稿: "st-draft",
  已发送: "st-sent",
  已修订: "st-revised",
  已关闭: "st-closed",
};
</script>

<template>
  <article class="chain-card">
    <header class="chain-head">
      <div>
        <p class="chain-title">
          {{ customer?.name ?? "未知客户" }}
          <span class="grade">{{ customer?.grade }}</span>
        </p>
        <p class="chain-sub">
          {{ root.quoteNo.split("-R")[0] }} · {{ root.route }} · {{ root.service }}
          · 共 {{ chain.length }} 版
        </p>
      </div>
    </header>

    <ol class="rev-list">
      <li v-for="quote in chain" :key="quote.id" class="rev-item">
        <div class="rev-line">
          <div class="rev-meta">
            <span class="rev-no">
              V{{ quote.revisionNo }}
              <template v-if="quote.revisionNo > 1">（修订）</template>
              <template v-else-if="quote.status === '草稿'">（草稿）</template>
            </span>
            <span class="quote-no">{{ quote.quoteNo }}</span>
            <span class="status-badge" :class="statusClass[quote.status]">
              {{ quote.status }}
            </span>
            <span v-if="store.check(quote).expired" class="expired-tag">已过有效期</span>
          </div>
          <div class="rev-attr">
            计费重 {{ quote.weight }}kg ·
            发送 {{ fmtTime(quote.sentAt) }}
          </div>
        </div>

        <p v-if="quote.revisionReason" class="rev-reason">
          <span>修订原因：</span>{{ quote.revisionReason }}
        </p>
        <p v-if="quote.closedReason" class="rev-reason close">
          <span>关闭原因：</span>{{ quote.closedReason }}
        </p>

        <div v-if="quote.snapshot" class="rev-body">
          <SnapshotBox :snapshot="quote.snapshot" compact />
          <div class="trace-col">
            <p class="validity-line">
              有效期：{{ quote.validFrom }} ~ {{ quote.validTo }}
            </p>
            <p
              class="verify"
              :class="{
                ok: store.check(quote).state === 'same',
                warn: store.check(quote).state === 'revoked' || store.check(quote).state === 'drift',
                bad: store.check(quote).state === 'missing',
              }"
            >
              <template v-if="store.check(quote).state === 'same'">✓ </template>
              <template v-else-if="store.check(quote).state === 'revoked'">⚠ </template>
              <template v-else-if="store.check(quote).state === 'drift'">⚠ </template>
              <template v-else>✕ </template>
              {{ store.check(quote).text }}
            </p>
            <p class="rate-link">
              快照运价：{{ quote.snapshot.rateCode }}
              <span v-if="store.rateById(quote.snapshot.rateVersionId)?.status === '已撤销'" class="revoked-mark">
                版本已撤销
              </span>
            </p>
            <p v-if="quote.note" class="note-line">备注：{{ quote.note }}</p>
          </div>
        </div>
        <div v-else class="draft-body">
          <p>草稿未冻结金额，发送时按当时生效运价生成快照。</p>
          <p v-if="quote.note" class="note-line">备注：{{ quote.note }}</p>
        </div>

        <p v-if="nextOf(quote)" class="superseded">
          已由 {{ nextOf(quote)!.quoteNo }} 接替，原版本保持只读
        </p>

        <div class="rev-actions">
          <template v-if="quote.status === '草稿'">
            <button type="button" @click="sendDraft(quote)">发送（冻结快照）</button>
            <button type="button" class="danger ghost" @click="removeDraft(quote)">删除草稿</button>
          </template>
          <template v-else-if="quote.status === '已发送'">
            <button type="button" @click="emit('revise', quote.id)">新建修订</button>
            <button type="button" class="secondary" @click="closeWithReason(quote)">关闭</button>
          </template>
        </div>
      </li>
    </ol>
  </article>
</template>
