<script setup lang="ts">
defineProps<{ title: string; width?: string }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal" :style="{ maxWidth: width || '460px' }">
      <header class="modal-head">
        <h3>{{ title }}</h3>
        <button type="button" class="icon-btn" @click="emit('close')" aria-label="关闭">×</button>
      </header>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(23, 32, 51, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 50;
}

.modal {
  width: 100%;
  background: #fff;
  border-radius: 12px;
  padding: 20px 22px;
  box-shadow: 0 24px 60px rgba(23, 32, 51, 0.25);
}

.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.modal-head h3 {
  margin: 0;
  font-size: 18px;
}

.icon-btn {
  background: transparent;
  color: #69758c;
  font-size: 22px;
  line-height: 1;
  padding: 2px 8px;
}

.icon-btn:hover {
  background: #eef2f7;
}
</style>
