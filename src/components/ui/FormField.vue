<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string
    help?: string
    inputId?: string
  }>(),
  { help: '', inputId: '' },
)
</script>

<template>
  <div class="field">
    <label v-if="inputId" :for="inputId">{{ label }}</label>
    <span v-else class="field-label">{{ label }}</span>
    <slot />
    <p v-if="help" class="field-help text-xs text-subtle">{{ help }}</p>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.field-label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-muted);
}

.field-help {
  line-height: 1.45;
}
</style>
