<script setup lang="ts">
import { computed } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useConnectionStore } from '@/stores/connection'

const settings = useSettingsStore()
const connection = useConnectionStore()

const statusMeta = computed(() => {
  switch (connection.status) {
    case 'connected':
      return { label: 'Connected', cls: 'badge-success' }
    case 'connecting':
      return { label: 'Connecting…', cls: 'badge-info' }
    case 'closing':
      return { label: 'Closing…', cls: 'badge-warning' }
    case 'error':
      return { label: 'Error', cls: 'badge-danger' }
    case 'closed':
      return { label: 'Disconnected', cls: 'badge-warning' }
    default:
      return { label: 'Idle', cls: '' }
  }
})
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="brand">
        <img src="/icon.svg" alt="" class="brand-logo" width="36" height="36" />
        <div>
          <h1 class="brand-title">Realtime Audio Studio</h1>
          <p class="brand-subtitle text-sm text-muted">
            Azure AI Foundry · Azure OpenAI · GitHub Models
          </p>
        </div>
      </div>
      <div class="header-actions">
        <span class="badge" :class="statusMeta.cls">
          <span class="badge-dot" aria-hidden="true" />
          {{ statusMeta.label }}
        </span>
        <label class="theme-picker">
          <span class="visually-hidden">Theme</span>
          <select v-model="settings.theme" aria-label="Theme">
            <option value="system">System theme</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </div>
    </header>

    <main class="app-main">
      <section class="card privacy-note" aria-labelledby="privacy-heading">
        <h2 id="privacy-heading" class="privacy-title">Your credentials stay on your device</h2>
        <p class="text-sm text-muted">
          The endpoint and API key you enter are held in memory only for this browser session.
          They are <strong>never stored, logged, or transmitted anywhere</strong> except directly
          to the Azure AI Foundry / Azure OpenAI endpoint you specify, solely to establish the
          realtime connection.
        </p>
      </section>

      <section class="summary-grid">
        <div class="card summary-item">
          <span class="text-xs text-subtle">Provider</span>
          <strong>{{ settings.providerDescriptor.label }}</strong>
        </div>
        <div class="card summary-item">
          <span class="text-xs text-subtle">Model preset</span>
          <strong>{{ settings.modelPreset.label }}</strong>
        </div>
        <div class="card summary-item">
          <span class="text-xs text-subtle">Realtime audio</span>
          <strong>{{ settings.supportsRealtimeAudio ? 'Supported' : 'Unavailable' }}</strong>
        </div>
      </section>

      <p class="scaffold-note text-sm text-muted">
        The connection form, session parameter controls, tools panel, event log, and audio device
        pickers are being assembled. This shell verifies the design system, stores, and theme
        handling are wired correctly.
      </p>
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
}

.app-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-6);
  background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--border);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.brand-logo {
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}

.brand-title {
  font-size: var(--text-xl);
}

.brand-subtitle {
  margin-top: 2px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.theme-picker select {
  width: auto;
}

.app-main {
  width: min(1100px, 100%);
  margin: 0 auto;
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.privacy-note {
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  border-left: 4px solid var(--accent);
}

.privacy-title {
  font-size: var(--text-lg);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-4);
}

.summary-item {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.scaffold-note {
  padding: var(--space-4);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
}
</style>
