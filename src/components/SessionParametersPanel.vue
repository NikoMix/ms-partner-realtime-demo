<script setup lang="ts">
import { computed } from 'vue'
import PanelCard from '@/components/ui/PanelCard.vue'
import FormField from '@/components/ui/FormField.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { useSettingsStore } from '@/stores/settings'
import {
  NOISE_REDUCTION_TYPES,
  OUTPUT_MODALITIES,
  SEMANTIC_VAD_EAGERNESS,
  TOOL_CHOICE_MODES,
  type NoiseReductionType,
  type OutputModality,
  type TurnDetectionType,
} from '@/models/catalog'

const settings = useSettingsStore()
const profile = computed(() => settings.profile)

const TURN_LABELS: Record<TurnDetectionType, string> = {
  server_vad: 'Server VAD (automatic)',
  semantic_vad: 'Semantic VAD (automatic)',
  none: 'Manual — no automatic turns',
}

const NOISE_LABELS: Record<NoiseReductionType, string> = {
  none: 'None',
  near_field: 'Near field (headset / close mic)',
  far_field: 'Far field (room / laptop mic)',
}

const MODALITY_LABELS: Record<OutputModality, string> = {
  audio: 'Audio + transcript',
  text: 'Text only',
}

const temperatureNote = computed(() =>
  profile.value.temperature.scope === 'response'
    ? 'Sent on each response.create (GA schema).'
    : 'Applied at the session level.',
)

const isUnlimitedTokens = computed({
  get: () => settings.session.maxOutputTokens === 'inf',
  set: (value: boolean) => {
    settings.session.maxOutputTokens = value ? 'inf' : profile.value.maxOutputTokens.default
  },
})

const maxTokensValue = computed({
  get: () =>
    settings.session.maxOutputTokens === 'inf'
      ? profile.value.maxOutputTokens.default
      : settings.session.maxOutputTokens,
  set: (value: number) => {
    settings.session.maxOutputTokens = value
  },
})

/**
 * Audio and text output are mutually exclusive on the realtime wire (audio
 * responses already carry a transcript), so the selection is a single choice.
 */
const outputMode = computed<OutputModality>({
  get: () =>
    settings.session.outputModalities.includes('text') &&
    !settings.session.outputModalities.includes('audio')
      ? 'text'
      : 'audio',
  set: (mode: OutputModality) => {
    settings.session.outputModalities = mode === 'text' ? ['text'] : ['audio']
  },
})

function onSelectTurnType(event: Event): void {
  settings.session.turnDetection.type = (event.target as HTMLSelectElement)
    .value as TurnDetectionType
}
</script>

<template>
  <PanelCard
    title="Session parameters"
    subtitle="Controls adapt to the selected model's capabilities."
  >
    <template #actions>
      <button type="button" class="btn btn-ghost btn-sm" @click="settings.resetSessionToDefaults">
        Reset to defaults
      </button>
    </template>

    <FormField
      label="System instructions"
      input-id="instructions-input"
      help="Guidance sent to the model at the start of the session."
    >
      <textarea id="instructions-input" v-model="settings.session.instructions" rows="3" />
    </FormField>

    <FormField
      v-if="profile.supportsOutputModalities"
      label="Output modality"
      help="Audio replies include a transcript. Audio and text can't be combined."
    >
      <div class="chips" role="radiogroup" aria-label="Output modality">
        <label v-for="modality in OUTPUT_MODALITIES" :key="modality" class="chip">
          <input
            :id="`modality-${modality}`"
            v-model="outputMode"
            type="radio"
            class="chip-input"
            name="output-modality"
            :value="modality"
          />
          <span class="chip-label">{{ MODALITY_LABELS[modality] }}</span>
        </label>
      </div>
    </FormField>

    <div class="grid-2">
      <FormField label="Voice" input-id="voice-select">
        <select id="voice-select" v-model="settings.session.audio.voice">
          <option v-for="voice in profile.voices" :key="voice" :value="voice">{{ voice }}</option>
        </select>
      </FormField>

      <FormField label="Tool choice" input-id="tool-choice-select">
        <select id="tool-choice-select" v-model="settings.session.toolChoice">
          <option v-for="mode in TOOL_CHOICE_MODES" :key="mode" :value="mode">{{ mode }}</option>
        </select>
      </FormField>
    </div>

    <FormField
      v-if="profile.temperature.supported"
      label="Temperature"
      input-id="temperature-input"
      :help="`${settings.session.temperature.toFixed(2)} · range ${profile.temperature.min}–${profile.temperature.max}. ${temperatureNote}`"
    >
      <input
        id="temperature-input"
        v-model.number="settings.session.temperature"
        type="range"
        :min="profile.temperature.min"
        :max="profile.temperature.max"
        step="0.05"
      />
    </FormField>

    <FormField
      label="Max output tokens"
      input-id="max-tokens-input"
      :help="`Up to ${profile.maxOutputTokens.cap} tokens per response.`"
    >
      <div class="inline-row">
        <input
          id="max-tokens-input"
          v-model.number="maxTokensValue"
          type="number"
          min="1"
          :max="profile.maxOutputTokens.cap"
          :disabled="isUnlimitedTokens"
        />
        <ToggleSwitch v-model="isUnlimitedTokens" label="Unlimited" />
      </div>
    </FormField>

    <hr class="divider" />

    <FormField
      label="Turn detection"
      input-id="turn-type-select"
      help="How the service decides when your turn ends."
    >
      <select id="turn-type-select" :value="settings.session.turnDetection.type" @change="onSelectTurnType">
        <option v-for="type in profile.turnDetection" :key="type" :value="type">
          {{ TURN_LABELS[type] }}
        </option>
      </select>
    </FormField>

    <template v-if="settings.session.turnDetection.type === 'server_vad'">
      <div class="grid-2">
        <FormField
          label="VAD threshold"
          input-id="vad-threshold"
          :help="settings.session.turnDetection.threshold.toFixed(2)"
        >
          <input
            id="vad-threshold"
            v-model.number="settings.session.turnDetection.threshold"
            type="range"
            min="0"
            max="1"
            step="0.05"
          />
        </FormField>
        <FormField label="Prefix padding (ms)" input-id="vad-prefix">
          <input
            id="vad-prefix"
            v-model.number="settings.session.turnDetection.prefixPaddingMs"
            type="number"
            min="0"
            step="50"
          />
        </FormField>
      </div>
      <FormField label="Silence duration (ms)" input-id="vad-silence">
        <input
          id="vad-silence"
          v-model.number="settings.session.turnDetection.silenceDurationMs"
          type="number"
          min="0"
          step="50"
        />
      </FormField>
    </template>

    <FormField
      v-if="settings.session.turnDetection.type === 'semantic_vad' && profile.supportsSemanticVad"
      label="Eagerness"
      input-id="vad-eagerness"
      help="How proactively the model responds when using semantic VAD."
    >
      <select id="vad-eagerness" v-model="settings.session.turnDetection.eagerness">
        <option v-for="level in SEMANTIC_VAD_EAGERNESS" :key="level" :value="level">
          {{ level }}
        </option>
      </select>
    </FormField>

    <div v-if="settings.session.turnDetection.type !== 'none'" class="toggle-stack">
      <ToggleSwitch
        v-model="settings.session.turnDetection.createResponse"
        label="Auto-create response at end of turn"
      />
      <ToggleSwitch
        v-model="settings.session.turnDetection.interruptResponse"
        label="Interrupt response when I start speaking"
      />
    </div>

    <p v-else class="text-xs text-subtle">
      Manual mode: use “Commit &amp; respond” after speaking to request a reply.
    </p>

    <hr class="divider" />

    <ToggleSwitch v-model="settings.session.transcription.enabled" label="Input transcription" />

    <template v-if="settings.session.transcription.enabled">
      <div class="grid-2">
        <FormField label="Transcription model" input-id="transcription-model">
          <select id="transcription-model" v-model="settings.session.transcription.model">
            <option v-for="model in profile.transcriptionModels" :key="model" :value="model">
              {{ model }}
            </option>
          </select>
        </FormField>
        <FormField
          label="Language"
          input-id="transcription-language"
          help="ISO-639-1 code, or blank to auto-detect."
        >
          <input
            id="transcription-language"
            v-model="settings.session.transcription.language"
            type="text"
            placeholder="auto"
            spellcheck="false"
          />
        </FormField>
      </div>
      <FormField label="Transcription prompt" input-id="transcription-prompt">
        <input
          id="transcription-prompt"
          v-model="settings.session.transcription.prompt"
          type="text"
          placeholder="Optional hint to guide transcription"
        />
      </FormField>
    </template>

    <template v-if="profile.supportsNoiseReduction || profile.supportsSpeed">
      <hr class="divider" />
      <div class="grid-2">
        <FormField v-if="profile.supportsNoiseReduction" label="Noise reduction" input-id="noise-select">
          <select id="noise-select" v-model="settings.session.audio.noiseReduction">
            <option v-for="type in NOISE_REDUCTION_TYPES" :key="type" :value="type">
              {{ NOISE_LABELS[type] }}
            </option>
          </select>
        </FormField>
        <FormField
          v-if="profile.supportsSpeed"
          label="Playback speed"
          input-id="speed-input"
          :help="`${settings.session.audio.speed.toFixed(2)}×`"
        >
          <input
            id="speed-input"
            v-model.number="settings.session.audio.speed"
            type="range"
            min="0.25"
            max="1.5"
            step="0.05"
          />
        </FormField>
      </div>
    </template>
  </PanelCard>
</template>

<style scoped>
.grid-2 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-4);
}

.inline-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.inline-row input {
  max-width: 12rem;
}

.toggle-stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-pill);
  cursor: pointer;
  font-size: var(--text-sm);
  font-weight: 600;
}

.chip-input {
  width: auto;
  margin: 0;
  accent-color: var(--accent);
}

.chip-label {
  user-select: none;
}

.divider {
  border: none;
  border-top: 1px solid var(--border);
  margin: var(--space-1) 0;
  width: 100%;
}
</style>
