<script setup lang="ts">
import { useId } from 'vue'

withDefaults(
  defineProps<{
    modelValue: boolean
    label: string
    disabled?: boolean
  }>(),
  { disabled: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const inputId = useId()

function onChange(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).checked)
}
</script>

<template>
  <label class="switch" :class="{ 'switch-disabled': disabled }" :for="inputId">
    <input
      :id="inputId"
      type="checkbox"
      class="switch-input visually-hidden"
      :checked="modelValue"
      :disabled="disabled"
      @change="onChange"
    />
    <span class="switch-track" aria-hidden="true">
      <span class="switch-thumb" />
    </span>
    <span class="switch-label">{{ label }}</span>
  </label>
</template>

<style scoped>
.switch {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  cursor: pointer;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text);
}

.switch-disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.switch-track {
  position: relative;
  width: 40px;
  height: 22px;
  border-radius: var(--radius-pill);
  background: var(--border-strong);
  transition: background var(--transition);
  flex-shrink: 0;
}

.switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: var(--shadow-sm);
  transition: transform var(--transition);
}

.switch-input:checked + .switch-track {
  background: var(--accent);
}

.switch-input:checked + .switch-track .switch-thumb {
  transform: translateX(18px);
}

.switch-input:focus-visible + .switch-track {
  outline: 3px solid var(--ring);
  outline-offset: 2px;
}

.switch-label {
  user-select: none;
}
</style>
