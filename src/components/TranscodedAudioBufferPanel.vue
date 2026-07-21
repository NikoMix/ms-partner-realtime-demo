<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import {
  TRANSCODED_AUDIO_BUFFER_MAX_DURATION_SECONDS,
  getRawAudioExtension,
} from '@/audio/transcoded-audio-buffer'
import PanelCard from '@/components/ui/PanelCard.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { useRealtimeSession } from '@/composables/useRealtimeSession'
import { useConnectionStore } from '@/stores/connection'
import { INPUT_AUDIO_FORMAT_LABELS } from '@/types/audio'

const session = useRealtimeSession()
const connection = useConnectionStore()
const audioElement = ref<HTMLAudioElement | null>(null)
const playbackMessage = ref('')

const info = computed(() => session.transcodedAudioBufferInfo.value)
const hasAudio = computed(() => info.value.byteLength > 0 && info.value.format !== null)
const captureBusy = computed(
  () =>
    session.micState.value === 'recording' ||
    session.micStopping.value ||
    session.micFormatLocked.value,
)
const playbackOrExportBusy = computed(() => captureBusy.value || connection.responseInProgress)
const formatLabel = computed(() =>
  info.value.format ? INPUT_AUDIO_FORMAT_LABELS[info.value.format] : 'None',
)
const rawExtension = computed(() =>
  info.value.format ? getRawAudioExtension(info.value.format) : 'raw',
)

function onBufferToggle(value: boolean): void {
  playbackMessage.value = ''
  session.setTranscodedAudioBufferEnabled(value)
}

async function onListen(): Promise<void> {
  playbackMessage.value = ''
  const url = session.prepareTranscodedAudioPlayback()
  if (!url) {
    return
  }

  await nextTick()
  try {
    await audioElement.value?.play()
  } catch {
    playbackMessage.value = 'Playback is ready. Use the audio controls to start it.'
  }
}

function onClear(): void {
  playbackMessage.value = ''
  session.clearTranscodedAudioBuffer()
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`
  }

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

function formatBytes(byteLength: number): string {
  if (byteLength < 1024) {
    return `${byteLength} B`
  }
  if (byteLength < 1024 * 1024) {
    return `${(byteLength / 1024).toFixed(1)} KiB`
  }
  return `${(byteLength / (1024 * 1024)).toFixed(1)} MiB`
}
</script>

<template>
  <PanelCard
    title="Transcoded input buffer"
    subtitle="Optionally retain the exact microphone bytes in memory without changing realtime delivery."
  >
    <template #actions>
      <ToggleSwitch
        :model-value="session.transcodedAudioBufferEnabled.value"
        label="Capture"
        :disabled="captureBusy"
        @update:model-value="onBufferToggle"
      />
    </template>

    <p class="text-sm text-muted">
      Realtime audio is sent first. When enabled, each microphone run starts a new rolling
      {{ TRANSCODED_AUDIO_BUFFER_MAX_DURATION_SECONDS / 60 }}-minute buffer. Audio is never
      persisted unless you download it.
    </p>

    <div v-if="hasAudio" class="buffer-summary">
      <div>
        <span class="metric-label text-xs text-subtle">Format</span>
        <strong>{{ formatLabel }}</strong>
      </div>
      <div>
        <span class="metric-label text-xs text-subtle">Duration</span>
        <strong>{{ formatDuration(info.durationSeconds) }}</strong>
      </div>
      <div>
        <span class="metric-label text-xs text-subtle">Encoded size</span>
        <strong>{{ formatBytes(info.byteLength) }}</strong>
      </div>
      <span v-if="info.truncated" class="badge badge-warning">Oldest audio discarded</span>
    </div>

    <p v-else class="empty text-sm text-muted">
      {{
        session.transcodedAudioBufferEnabled.value
          ? 'Start the microphone to capture encoded input audio.'
          : 'Enable capture before starting the microphone.'
      }}
    </p>

    <div class="actions-row">
      <button
        type="button"
        class="btn btn-primary"
        :disabled="!hasAudio || playbackOrExportBusy"
        @click="onListen"
      >
        Listen
      </button>
      <button
        type="button"
        class="btn"
        :disabled="!hasAudio || playbackOrExportBusy"
        @click="session.downloadTranscodedAudioWav"
      >
        Download playable WAV
      </button>
      <button
        type="button"
        class="btn"
        :disabled="!hasAudio || playbackOrExportBusy"
        @click="session.downloadTranscodedAudioRaw"
      >
        Download .{{ rawExtension }}
      </button>
      <button
        type="button"
        class="btn btn-ghost"
        :disabled="!hasAudio || captureBusy"
        @click="onClear"
      >
        Clear
      </button>
    </div>

    <audio
      v-if="session.transcodedAudioPlaybackUrl.value"
      ref="audioElement"
      class="playback"
      :src="session.transcodedAudioPlaybackUrl.value"
      controls
      preload="metadata"
    />
    <p v-if="playbackMessage" class="text-xs text-muted" role="status">{{ playbackMessage }}</p>

    <p v-if="hasAudio" class="text-xs text-subtle">
      Playback and WAV export decode G.711 to PCM16 on demand. The raw download contains the exact
      bytes sent to the realtime service.
    </p>
  </PanelCard>
</template>

<style scoped>
.buffer-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-2);
}

.buffer-summary > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 7rem;
}

.metric-label {
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.empty {
  padding: var(--space-3) 0;
}

.actions-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.playback {
  width: 100%;
}
</style>
