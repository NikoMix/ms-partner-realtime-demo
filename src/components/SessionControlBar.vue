<script setup lang="ts">
import { computed } from 'vue'
import { useRealtimeSession } from '@/composables/useRealtimeSession'
import { useConnectionStore } from '@/stores/connection'
import { useSettingsStore } from '@/stores/settings'

const session = useRealtimeSession()
const connection = useConnectionStore()
const settings = useSettingsStore()

const isRecording = computed(() => session.micState.value === 'recording')
const isManualTurn = computed(() => settings.session.turnDetection.type === 'none')
const micDisabled = computed(() => !connection.isConnected && !isRecording.value)
const volumePercent = computed(() => Math.round(session.volume.value * 100))

function onToggleMic(): void {
  void session.toggleMic()
}

function onCommit(): void {
  session.commitAndRespond()
}

function onVolume(event: Event): void {
  session.setVolume(Number((event.target as HTMLInputElement).value))
}
</script>

<template>
  <div class="card cockpit">
    <button
      type="button"
      class="mic-button"
      :class="{ 'mic-on': isRecording }"
      :disabled="micDisabled"
      :aria-pressed="isRecording"
      @click="onToggleMic"
    >
      <svg
        v-if="!isRecording"
        viewBox="0 0 24 24"
        width="26"
        height="26"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
      <svg v-else viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="currentColor">
        <rect x="6" y="6" width="12" height="12" rx="2" />
      </svg>
      <span class="mic-label">{{ isRecording ? 'Stop' : 'Talk' }}</span>
    </button>

    <div class="cockpit-main">
      <div class="status-chips">
        <span class="chip-status" :class="{ active: isRecording }">
          <span class="dot" aria-hidden="true" /> Microphone
        </span>
        <span class="chip-status" :class="{ active: connection.userSpeaking }">
          <span class="dot" aria-hidden="true" /> Speech detected
        </span>
        <span class="chip-status" :class="{ active: connection.responseInProgress }">
          <span class="dot" aria-hidden="true" /> Model responding
        </span>
      </div>

      <div class="controls">
        <button
          v-if="isManualTurn"
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="micDisabled"
          @click="onCommit"
        >
          Commit &amp; respond
        </button>

        <label class="volume">
          <span class="volume-label text-sm text-muted">Volume {{ volumePercent }}%</span>
          <input
            id="playback-volume"
            name="playback-volume"
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="session.volume.value"
            aria-label="Playback volume"
            @input="onVolume"
          />
        </label>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cockpit {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  padding: var(--space-5);
}

.mic-button {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 84px;
  height: 84px;
  border-radius: 50%;
  border: 2px solid var(--border-strong);
  background: var(--surface-2);
  color: var(--text);
  cursor: pointer;
  flex-shrink: 0;
  font-weight: 700;
  transition:
    background var(--transition),
    border-color var(--transition),
    transform var(--transition);
}

.mic-button:hover:not(:disabled) {
  border-color: var(--accent);
}

.mic-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.mic-on {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
  animation: pulse 1.6s ease-out infinite;
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--danger) 55%, transparent);
  }
  70% {
    box-shadow: 0 0 0 14px transparent;
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}

.mic-label {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.cockpit-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.status-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.chip-status {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-subtle);
}

.chip-status .dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--border-strong);
  transition: background var(--transition);
}

.chip-status.active {
  color: var(--text);
}

.chip-status.active .dot {
  background: var(--success);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--success) 25%, transparent);
}

.controls {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  flex-wrap: wrap;
}

.volume {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  flex: 1;
  min-width: 180px;
}

.volume-label {
  font-weight: 600;
}

@media (max-width: 560px) {
  .cockpit {
    flex-direction: column;
    align-items: stretch;
    text-align: center;
  }

  .mic-button {
    align-self: center;
  }
}
</style>
