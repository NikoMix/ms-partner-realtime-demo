<script setup lang="ts">
import { computed, ref } from 'vue'
import PanelCard from '@/components/ui/PanelCard.vue'
import FormField from '@/components/ui/FormField.vue'
import PrivacyNotice from '@/components/PrivacyNotice.vue'
import { useRealtimeSession } from '@/composables/useRealtimeSession'
import { useConnectionStore, type ConnectionStatus } from '@/stores/connection'
import { useSettingsStore } from '@/stores/settings'
import { PROVIDER_LIST, type ProviderId } from '@/providers/types'

const settings = useSettingsStore()
const connection = useConnectionStore()
const session = useRealtimeSession()

const showKey = ref(false)

const isLegacySchema = computed(() => settings.profile.schema === 'legacy')

const statusMeta = computed<{ label: string; cls: string }>(() => {
  const map: Record<ConnectionStatus, { label: string; cls: string }> = {
    idle: { label: 'Not connected', cls: 'badge' },
    connecting: { label: 'Connecting…', cls: 'badge badge-warning' },
    connected: { label: 'Connected', cls: 'badge badge-success' },
    closing: { label: 'Closing…', cls: 'badge badge-warning' },
    closed: { label: 'Closed', cls: 'badge' },
    error: { label: 'Error', cls: 'badge badge-danger' },
  }
  return map[connection.status]
})

const canConnect = computed(
  () => settings.hasCredentials && settings.supportsRealtimeAudio && !connection.isActive,
)

function onSelectProvider(event: Event): void {
  settings.setProvider((event.target as HTMLSelectElement).value as ProviderId)
}

function onSelectModel(event: Event): void {
  settings.setModelPreset((event.target as HTMLSelectElement).value)
}

function onConnect(): void {
  if (canConnect.value) {
    void session.connect()
  }
}

function onDisconnect(): void {
  session.disconnect()
}
</script>

<template>
  <PanelCard title="Connection" subtitle="Choose a provider and model, then enter your endpoint and key.">
    <template #actions>
      <span :class="statusMeta.cls">
        <span class="badge-dot" aria-hidden="true" />
        {{ statusMeta.label }}
      </span>
    </template>

    <form class="connection-form" autocomplete="off" @submit.prevent="onConnect">
      <FormField label="Inference provider" input-id="provider-select" :help="settings.providerDescriptor.description">
        <select id="provider-select" :value="settings.providerId" @change="onSelectProvider">
          <option v-for="p in PROVIDER_LIST" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
      </FormField>

      <FormField label="Model" input-id="model-select" :help="settings.modelPreset.description">
        <select id="model-select" :value="settings.modelPresetId" @change="onSelectModel">
          <option v-for="preset in settings.presets" :key="preset.id" :value="preset.id">
            {{ preset.label }}{{ preset.preview ? ' (preview)' : '' }}
          </option>
        </select>
      </FormField>

      <p v-if="!settings.supportsRealtimeAudio" class="notice notice-warning" role="status">
        <strong>{{ settings.providerDescriptor.label }}</strong> does not expose a realtime audio
        WebSocket. Select an Azure provider to stream microphone audio.
      </p>

      <FormField
        label="Endpoint"
        input-id="endpoint-input"
        :help="settings.providerDescriptor.endpointHelp"
      >
        <input
          id="endpoint-input"
          v-model="settings.endpoint"
          type="url"
          autocomplete="off"
          spellcheck="false"
          :placeholder="settings.providerDescriptor.endpointPlaceholder"
        />
      </FormField>

      <FormField
        label="Deployment name"
        input-id="deployment-input"
        help="The realtime deployment in your resource. Defaults to the selected model id when left blank."
      >
        <input
          id="deployment-input"
          v-model="settings.deployment"
          type="text"
          autocomplete="off"
          spellcheck="false"
          :placeholder="settings.modelPresetId"
        />
      </FormField>

      <FormField label="API key" input-id="key-input" :help="settings.providerDescriptor.keyHelp">
        <div class="key-row">
          <input
            id="key-input"
            v-model="settings.apiKey"
            :type="showKey ? 'text' : 'password'"
            autocomplete="off"
            spellcheck="false"
            placeholder="Your API key (kept in memory only)"
          />
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :aria-pressed="showKey"
            @click="showKey = !showKey"
          >
            {{ showKey ? 'Hide' : 'Show' }}
          </button>
        </div>
      </FormField>

      <FormField
        v-if="isLegacySchema"
        label="API version"
        input-id="api-version-input"
        help="Legacy preview API version used for the realtime WebSocket path."
      >
        <input
          id="api-version-input"
          v-model="settings.apiVersion"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="2025-04-01-preview"
        />
      </FormField>

      <PrivacyNotice compact />

      <p v-if="connection.currentUrlRedacted" class="text-xs text-subtle mono url-line">
        {{ connection.currentUrlRedacted }}
      </p>

      <p v-if="connection.errorMessage" class="notice notice-danger" role="alert">
        {{ connection.errorMessage }}
      </p>

      <div class="actions-row">
        <button type="submit" class="btn btn-primary" :disabled="!canConnect">Connect</button>
        <button
          type="button"
          class="btn btn-danger"
          :disabled="!connection.isActive"
          @click="onDisconnect"
        >
          Disconnect
        </button>
        <button
          type="button"
          class="btn btn-ghost"
          :disabled="connection.isActive"
          @click="settings.resetCredentials"
        >
          Clear credentials
        </button>
        <a
          class="btn btn-ghost btn-sm docs-link"
          :href="settings.providerDescriptor.docsUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          Docs ↗
        </a>
      </div>
    </form>
  </PanelCard>
</template>

<style scoped>
.connection-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.key-row {
  display: flex;
  gap: var(--space-2);
  align-items: stretch;
}

.key-row input {
  flex: 1;
}

.actions-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.docs-link {
  margin-left: auto;
  text-decoration: none;
}

.url-line {
  word-break: break-all;
}

.notice {
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  font-size: var(--text-sm);
  line-height: 1.5;
}

.notice-warning {
  border-color: var(--warning);
  background: color-mix(in srgb, var(--warning) 12%, var(--surface));
}

.notice-danger {
  border-color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, var(--surface));
}
</style>
