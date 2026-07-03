<script setup lang="ts">
import { computed } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useConnectionStore } from '@/stores/connection'
import PrivacyNotice from '@/components/PrivacyNotice.vue'
import SessionControlBar from '@/components/SessionControlBar.vue'
import ConnectionPanel from '@/components/ConnectionPanel.vue'
import AudioDevicesPanel from '@/components/AudioDevicesPanel.vue'
import SessionParametersPanel from '@/components/SessionParametersPanel.vue'
import EventLogPanel from '@/components/EventLogPanel.vue'
import ToolsPanel from '@/components/ToolsPanel.vue'

const settings = useSettingsStore()
const connection = useConnectionStore()

// Base-aware so the logo resolves under the GitHub Pages sub-path deploy.
const brandLogoUrl = `${import.meta.env.BASE_URL}icon.svg`

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
        <img :src="brandLogoUrl" alt="" class="brand-logo" width="36" height="36" />
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
          <select id="theme-select" v-model="settings.theme" name="theme" aria-label="Theme">
            <option value="system">System theme</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </div>
    </header>

    <main class="app-main">
      <PrivacyNotice />

      <SessionControlBar />

      <div class="layout">
        <div class="column">
          <ConnectionPanel />
          <AudioDevicesPanel />
          <SessionParametersPanel />
        </div>
        <div class="column">
          <EventLogPanel />
          <ToolsPanel />
        </div>
      </div>

      <footer class="app-footer text-xs text-subtle">
        <span>
          Model audio streams as PCM16 @ 24&nbsp;kHz. Tools are stubs only — no code or external
          service is ever executed.
        </span>
      </footer>
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
  width: min(1280px, 100%);
  margin: 0 auto;
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-5);
  align-items: start;
}

.column {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  min-width: 0;
}

.app-footer {
  padding-top: var(--space-2);
  text-align: center;
}

@media (max-width: 980px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
