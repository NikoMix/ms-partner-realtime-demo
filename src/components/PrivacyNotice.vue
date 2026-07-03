<script setup lang="ts">
withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
</script>

<template>
  <div class="privacy" :class="{ 'privacy-compact': compact }">
    <svg
      class="privacy-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M12 3 4 6v6c0 5 3.5 7.5 8 9 4.5-1.5 8-4 8-9V6l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
    <div class="privacy-body">
      <p v-if="!compact" class="privacy-title">Your credentials stay on your device</p>
      <p class="text-sm text-muted">
        The endpoint, deployment name, and API key you enter are held in memory only for this
        browser session. They are
        <strong>never stored, logged, or transmitted anywhere</strong> except directly to the
        Azure endpoint you specify, solely to establish and authenticate the realtime connection.
        The API key is redacted everywhere in the event log below.
      </p>
    </div>
  </div>
</template>

<style scoped>
.privacy {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-left: 4px solid var(--accent);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));
}

.privacy-compact {
  padding: var(--space-3) var(--space-4);
}

.privacy-icon {
  color: var(--accent);
  flex-shrink: 0;
  margin-top: 2px;
}

.privacy-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.privacy-title {
  font-weight: 700;
}
</style>
