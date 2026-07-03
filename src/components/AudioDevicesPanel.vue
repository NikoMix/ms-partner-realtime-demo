<script setup lang="ts">
import { computed, onMounted } from 'vue'
import PanelCard from '@/components/ui/PanelCard.vue'
import FormField from '@/components/ui/FormField.vue'
import { useAudioDevicesStore } from '@/stores/audioDevices'
import type { MicPermissionState } from '@/types/audio'

const devices = useAudioDevicesStore()

const permissionMeta = computed<{ label: string; cls: string }>(() => {
  const map: Record<MicPermissionState, { label: string; cls: string }> = {
    unknown: { label: 'Permission unknown', cls: 'badge' },
    prompt: { label: 'Awaiting permission', cls: 'badge badge-warning' },
    granted: { label: 'Microphone ready', cls: 'badge badge-success' },
    denied: { label: 'Microphone blocked', cls: 'badge badge-danger' },
    unsupported: { label: 'Not supported', cls: 'badge badge-danger' },
  }
  return map[devices.permission]
})

async function enableMicrophone(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    devices.setPermission('unsupported')
    return
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    for (const track of stream.getTracks()) {
      track.stop()
    }
    devices.setPermission('granted')
    await devices.refreshDevices()
  } catch {
    devices.setPermission('denied')
  }
}

function onEnableMicrophone(): void {
  void enableMicrophone()
}

function onRefresh(): void {
  void devices.refreshDevices()
}

onMounted(() => {
  void devices.refreshDevices()
})
</script>

<template>
  <PanelCard title="Audio devices" subtitle="Pick your microphone and playback speaker.">
    <template #actions>
      <span :class="permissionMeta.cls">
        <span class="badge-dot" aria-hidden="true" />
        {{ permissionMeta.label }}
      </span>
    </template>

    <FormField
      label="Microphone"
      input-id="mic-select"
      help="Choose an input device, or use the system default."
    >
      <select id="mic-select" v-model="devices.selectedInputId">
        <option value="">System default</option>
        <option v-for="device in devices.inputs" :key="device.deviceId" :value="device.deviceId">
          {{ device.label }}
        </option>
      </select>
    </FormField>

    <FormField
      label="Speaker"
      input-id="speaker-select"
      :help="
        devices.supportsOutputSelection
          ? 'Route model audio to a specific output device.'
          : 'This browser cannot redirect audio output; the system default speaker is used.'
      "
    >
      <select
        id="speaker-select"
        v-model="devices.selectedOutputId"
        :disabled="!devices.supportsOutputSelection"
      >
        <option value="">System default</option>
        <option v-for="device in devices.outputs" :key="device.deviceId" :value="device.deviceId">
          {{ device.label }}
        </option>
      </select>
    </FormField>

    <p v-if="devices.error" class="notice notice-danger" role="alert">{{ devices.error }}</p>

    <div class="actions-row">
      <button type="button" class="btn" @click="onEnableMicrophone">Enable microphone</button>
      <button
        type="button"
        class="btn btn-ghost"
        :disabled="!devices.supportsDeviceEnumeration"
        @click="onRefresh"
      >
        Refresh devices
      </button>
    </div>

    <p class="text-xs text-subtle">
      Device labels appear after you grant microphone permission at least once.
    </p>
  </PanelCard>
</template>

<style scoped>
.actions-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.notice {
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, var(--surface));
  font-size: var(--text-sm);
}
</style>
