import { computed, reactive, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  type ModelCapabilityProfile,
  type RealtimeModelPreset,
  DEFAULT_MODEL_ID,
  MODEL_PRESETS,
  getModelPreset,
  getModelProfile,
} from '@/models/catalog'
import {
  type ProviderDescriptor,
  type ProviderId,
  DEFAULT_PROVIDER_ID,
  getProviderDescriptor,
} from '@/providers/types'
import { parseAzureRealtimeEndpoint } from '@/providers/azure'
import {
  type ProviderConnectionConfig,
  type SessionSettings,
  createDefaultSessionSettings,
} from '@/types/settings'
import { isInputAudioFormat } from '@/types/audio'
import { loadJson, saveJson } from '@/utils/storage'

export type ThemePreference = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'realtime-studio:settings:v1'

interface PersistedSettings {
  providerId: ProviderId
  modelPresetId: string
  apiVersion: string
  theme: ThemePreference
  session: SessionSettings
}

/**
 * Central configuration store. This is the integration hub that the UI, audio
 * engine, and realtime engine all read from.
 *
 * SECURITY: `endpoint`, `deployment`, and `apiKey` live only in this in-memory
 * store and are deliberately excluded from the persisted payload.
 */
export const useSettingsStore = defineStore('settings', () => {
  const initialPreset = getModelPreset(DEFAULT_MODEL_ID)

  const providerId = ref<ProviderId>(DEFAULT_PROVIDER_ID)
  const modelPresetId = ref<string>(DEFAULT_MODEL_ID)
  const theme = ref<ThemePreference>('system')

  // Connection secrets — never persisted.
  const endpoint = ref('')
  const deployment = ref('')
  const apiKey = ref('')
  const apiVersion = ref(initialPreset.recommendedApiVersion ?? '')

  const session = reactive<SessionSettings>(createDefaultSessionSettings(initialPreset.profile))

  // -- Derived state ---------------------------------------------------------

  const providerDescriptor = computed<ProviderDescriptor>(() =>
    getProviderDescriptor(providerId.value),
  )
  const modelPreset = computed<RealtimeModelPreset>(() => getModelPreset(modelPresetId.value))
  const profile = computed<ModelCapabilityProfile>(() => getModelProfile(modelPresetId.value))

  const supportsRealtimeAudio = computed(
    () => providerDescriptor.value.supportsRealtimeAudio && profile.value.supportsRealtimeAudio,
  )

  const hasCredentials = computed(
    () => endpoint.value.trim().length > 0 && apiKey.value.trim().length > 0,
  )

  const connectionConfig = computed<ProviderConnectionConfig>(() => ({
    providerId: providerId.value,
    endpoint: endpoint.value.trim(),
    deployment: deployment.value.trim() || modelPresetId.value,
    apiKey: apiKey.value,
    apiVersion: apiVersion.value.trim(),
    modelPresetId: modelPresetId.value,
  }))

  // -- Reconciliation --------------------------------------------------------

  /** Ensures the active session settings remain valid for the selected profile. */
  function reconcileSession(target: ModelCapabilityProfile): void {
    if (!target.voices.includes(session.audio.voice)) {
      session.audio.voice = target.defaultVoice
    }
    if (!target.transcriptionModels.includes(session.transcription.model)) {
      session.transcription.model = target.defaultTranscriptionModel
    }
    if (!target.turnDetection.includes(session.turnDetection.type)) {
      session.turnDetection.type = target.turnDetection[0] ?? 'none'
    }
    if (!target.supportsNoiseReduction) {
      session.audio.noiseReduction = 'none'
    }
    if (!target.supportsSpeed) {
      session.audio.speed = 1.0
    }
    session.temperature = clamp(session.temperature, target.temperature.min, target.temperature.max)
    const validModalities = session.outputModalities
      .filter(
        (modality, index, modalities) =>
          target.outputModalities.supported.includes(modality) &&
          modalities.indexOf(modality) === index,
      )
      .slice(0, target.outputModalities.maxSelected)
    session.outputModalities =
      validModalities.length > 0 ? validModalities : [...target.outputModalities.default]
  }

  // -- Actions ---------------------------------------------------------------

  function setProvider(id: ProviderId): void {
    providerId.value = id
  }

  function setModelPreset(id: string): void {
    const previousPresetId = modelPresetId.value
    const next = getModelPreset(id)
    modelPresetId.value = next.id
    // Suggest the preset id as the deployment name when the field is empty or
    // still matches the previously-selected preset id.
    if (deployment.value.trim() === '' || deployment.value.trim() === previousPresetId) {
      deployment.value = next.id
    }
    apiVersion.value = next.recommendedApiVersion ?? ''
    reconcileSession(next.profile)
  }

  function applyEndpointInput(value = endpoint.value): void {
    const parsed = parseAzureRealtimeEndpoint(value)
    endpoint.value = parsed.endpoint

    const inferredDeployment = parsed.model ?? parsed.deployment
    if (inferredDeployment) {
      if (isKnownPreset(inferredDeployment)) {
        setModelPreset(inferredDeployment)
      }
      deployment.value = inferredDeployment
    }
    if (parsed.apiVersion) {
      apiVersion.value = parsed.apiVersion
    }
  }

  function resetCredentials(): void {
    endpoint.value = ''
    deployment.value = ''
    apiKey.value = ''
  }

  function resetSessionToDefaults(): void {
    Object.assign(session, createDefaultSessionSettings(profile.value))
  }

  // -- Persistence -----------------------------------------------------------

  function hydrate(): void {
    const persisted = loadJson<Partial<PersistedSettings> | null>(STORAGE_KEY, null)
    if (!persisted) {
      return
    }
    if (persisted.providerId && isProviderId(persisted.providerId)) {
      providerId.value = persisted.providerId
    }
    if (typeof persisted.modelPresetId === 'string' && isKnownPreset(persisted.modelPresetId)) {
      modelPresetId.value = persisted.modelPresetId
    }
    if (persisted.theme === 'system' || persisted.theme === 'light' || persisted.theme === 'dark') {
      theme.value = persisted.theme
    }
    if (typeof persisted.apiVersion === 'string') {
      apiVersion.value = persisted.apiVersion
    }
    const activeProfile = getModelProfile(modelPresetId.value)
    Object.assign(session, mergeSession(activeProfile, persisted.session))
    reconcileSession(activeProfile)
  }

  hydrate()

  watch(
    [providerId, modelPresetId, theme, apiVersion, () => structuredSession(session)],
    () => {
      const payload: PersistedSettings = {
        providerId: providerId.value,
        modelPresetId: modelPresetId.value,
        apiVersion: apiVersion.value,
        theme: theme.value,
        session: structuredSession(session),
      }
      saveJson(STORAGE_KEY, payload)
    },
    { deep: true },
  )

  return {
    providerId,
    modelPresetId,
    theme,
    endpoint,
    deployment,
    apiKey,
    apiVersion,
    session,
    providerDescriptor,
    modelPreset,
    profile,
    supportsRealtimeAudio,
    hasCredentials,
    connectionConfig,
    presets: MODEL_PRESETS,
    setProvider,
    setModelPreset,
    applyEndpointInput,
    resetCredentials,
    resetSessionToDefaults,
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function isProviderId(value: string): value is ProviderId {
  return value === 'azure-foundry' || value === 'azure-openai' || value === 'github-models'
}

function isKnownPreset(value: string): boolean {
  return MODEL_PRESETS.some((preset) => preset.id === value)
}

/** Returns a plain, structured-clone-safe copy of the session settings. */
function structuredSession(session: SessionSettings): SessionSettings {
  return {
    instructions: session.instructions,
    outputModalities: [...session.outputModalities],
    temperature: session.temperature,
    maxOutputTokens: session.maxOutputTokens,
    toolChoice: session.toolChoice,
    turnDetection: { ...session.turnDetection },
    transcription: { ...session.transcription },
    audio: { ...session.audio },
  }
}

/** Deep-merges a persisted (possibly partial/stale) session over profile defaults. */
function mergeSession(
  profile: ModelCapabilityProfile,
  persisted: SessionSettings | undefined,
): SessionSettings {
  const defaults = createDefaultSessionSettings(profile)
  if (!persisted || typeof persisted !== 'object') {
    return defaults
  }
  return {
    instructions:
      typeof persisted.instructions === 'string' ? persisted.instructions : defaults.instructions,
    outputModalities: Array.isArray(persisted.outputModalities)
      ? persisted.outputModalities
      : defaults.outputModalities,
    temperature:
      typeof persisted.temperature === 'number' ? persisted.temperature : defaults.temperature,
    maxOutputTokens:
      persisted.maxOutputTokens === 'inf' || typeof persisted.maxOutputTokens === 'number'
        ? persisted.maxOutputTokens
        : defaults.maxOutputTokens,
    toolChoice: persisted.toolChoice ?? defaults.toolChoice,
    turnDetection: { ...defaults.turnDetection, ...persisted.turnDetection },
    transcription: { ...defaults.transcription, ...persisted.transcription },
    audio: {
      inputFormat: isInputAudioFormat(persisted.audio?.inputFormat)
        ? persisted.audio.inputFormat
        : defaults.audio.inputFormat,
      voice:
        typeof persisted.audio?.voice === 'string' ? persisted.audio.voice : defaults.audio.voice,
      speed:
        typeof persisted.audio?.speed === 'number' ? persisted.audio.speed : defaults.audio.speed,
      noiseReduction: persisted.audio?.noiseReduction ?? defaults.audio.noiseReduction,
    },
  }
}
