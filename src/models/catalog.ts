/**
 * Realtime model catalog and capability profiles.
 *
 * This module is the single source of truth for the vocabulary of the realtime
 * protocol (schemas, turn-detection modes, voices, transcription models, etc.)
 * and for which parameters each model preset actually supports. The UI reads
 * these profiles to decide which controls to render, and the session-config
 * mapper (realtime engine) reads the `schema` to decide how to shape the
 * `session.update` payload.
 *
 * Verified against Microsoft Learn Azure OpenAI realtime audio reference (2026-07).
 */

// ---------------------------------------------------------------------------
// Protocol vocabulary
// ---------------------------------------------------------------------------

/**
 * Two distinct `session.update` shapes exist:
 * - `legacy`: flat schema used by `gpt-4o-realtime-preview` style deployments.
 * - `ga`: nested schema (`session.type: "realtime"`, `audio.input`/`audio.output`)
 *   used by `gpt-realtime` and newer.
 */
export const REALTIME_SCHEMAS = ['ga', 'legacy'] as const
export type RealtimeSchema = (typeof REALTIME_SCHEMAS)[number]

export const TURN_DETECTION_TYPES = ['server_vad', 'semantic_vad', 'none'] as const
export type TurnDetectionType = (typeof TURN_DETECTION_TYPES)[number]

export const SEMANTIC_VAD_EAGERNESS = ['auto', 'low', 'medium', 'high'] as const
export type SemanticVadEagerness = (typeof SEMANTIC_VAD_EAGERNESS)[number]

export const NOISE_REDUCTION_TYPES = ['none', 'near_field', 'far_field'] as const
export type NoiseReductionType = (typeof NOISE_REDUCTION_TYPES)[number]

export const OUTPUT_MODALITIES = ['audio', 'text'] as const
export type OutputModality = (typeof OUTPUT_MODALITIES)[number]

export const TOOL_CHOICE_MODES = ['auto', 'none', 'required'] as const
export type ToolChoiceMode = (typeof TOOL_CHOICE_MODES)[number]

/** Where a sampling temperature is applied for a given model family. */
export const TEMPERATURE_SCOPES = ['session', 'response', 'none'] as const
export type TemperatureScope = (typeof TEMPERATURE_SCOPES)[number]

export const REALTIME_SAMPLE_RATE_HZ = 24_000

// ---------------------------------------------------------------------------
// Capability profile
// ---------------------------------------------------------------------------

export interface TemperatureCapability {
  readonly supported: boolean
  /** In the GA schema temperature is supplied on `response.create`, not the session. */
  readonly scope: TemperatureScope
  readonly min: number
  readonly max: number
  readonly default: number
}

export interface TokenCapability {
  readonly cap: number
  readonly default: number
}

export interface ModelCapabilityProfile {
  readonly schema: RealtimeSchema
  readonly supportsRealtimeAudio: boolean
  readonly voices: readonly string[]
  readonly defaultVoice: string
  readonly transcriptionModels: readonly string[]
  readonly defaultTranscriptionModel: string
  readonly turnDetection: readonly TurnDetectionType[]
  readonly supportsSemanticVad: boolean
  readonly supportsNoiseReduction: boolean
  /** GA `audio.output.speed` playback-rate control. */
  readonly supportsSpeed: boolean
  /** GA `output_modalities` (audio and/or text). */
  readonly supportsOutputModalities: boolean
  readonly temperature: TemperatureCapability
  readonly maxOutputTokens: TokenCapability
}

export interface RealtimeModelPreset {
  /** Internal preset id; also the default deployment/model name suggestion. */
  readonly id: string
  /** Human-friendly label shown in the UI. */
  readonly label: string
  readonly family: 'gpt-realtime' | 'gpt-4o-realtime'
  readonly releaseTag?: string
  readonly description: string
  /** API version used for the legacy preview WebSocket path. */
  readonly recommendedApiVersion?: string
  /** True for forward-compatibility presets that may not be generally available yet. */
  readonly preview?: boolean
  readonly profile: ModelCapabilityProfile
}

// ---------------------------------------------------------------------------
// Shared voice / transcription option sets
// ---------------------------------------------------------------------------

const GA_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
] as const

const LEGACY_VOICES = ['alloy', 'echo', 'shimmer', 'ash', 'ballad', 'coral', 'sage', 'verse'] as const

const GA_TRANSCRIPTION_MODELS = ['whisper-1', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe'] as const
const LEGACY_TRANSCRIPTION_MODELS = ['whisper-1', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe'] as const

// ---------------------------------------------------------------------------
// Capability profiles
// ---------------------------------------------------------------------------

const GA_PROFILE: ModelCapabilityProfile = {
  schema: 'ga',
  supportsRealtimeAudio: true,
  voices: GA_VOICES,
  defaultVoice: 'marin',
  transcriptionModels: GA_TRANSCRIPTION_MODELS,
  defaultTranscriptionModel: 'gpt-4o-transcribe',
  turnDetection: TURN_DETECTION_TYPES,
  supportsSemanticVad: true,
  supportsNoiseReduction: true,
  supportsSpeed: true,
  supportsOutputModalities: true,
  temperature: { supported: true, scope: 'response', min: 0.6, max: 1.2, default: 0.8 },
  maxOutputTokens: { cap: 4096, default: 4096 },
}

/**
 * GA models that no longer accept a sampling temperature (e.g. the next-gen
 * GPT-realtime 2 preset). Sending `temperature` on either `session.update` or
 * `response.create` is rejected by these deployments, so the parameter is
 * omitted entirely and its UI control is hidden.
 */
const GA_PROFILE_NO_TEMPERATURE: ModelCapabilityProfile = {
  ...GA_PROFILE,
  temperature: { supported: false, scope: 'none', min: 0.6, max: 1.2, default: 0.8 },
}

const LEGACY_PROFILE: ModelCapabilityProfile = {
  schema: 'legacy',
  supportsRealtimeAudio: true,
  voices: LEGACY_VOICES,
  defaultVoice: 'alloy',
  transcriptionModels: LEGACY_TRANSCRIPTION_MODELS,
  defaultTranscriptionModel: 'whisper-1',
  turnDetection: ['server_vad', 'semantic_vad', 'none'],
  supportsSemanticVad: true,
  supportsNoiseReduction: false,
  supportsSpeed: false,
  supportsOutputModalities: false,
  temperature: { supported: true, scope: 'session', min: 0.6, max: 1.2, default: 0.8 },
  maxOutputTokens: { cap: 4096, default: 4096 },
}

// ---------------------------------------------------------------------------
// Model presets
// ---------------------------------------------------------------------------

export const MODEL_PRESETS: readonly RealtimeModelPreset[] = [
  {
    id: 'gpt-realtime',
    label: 'GPT-realtime 1',
    family: 'gpt-realtime',
    releaseTag: '2025-08-28',
    description:
      'First generally available GPT realtime model. Nested GA session schema with full audio input/output, semantic VAD, noise reduction, and playback speed control.',
    profile: GA_PROFILE,
  },
  {
    id: 'gpt-realtime-1.5',
    label: 'GPT-realtime 1.5',
    family: 'gpt-realtime',
    releaseTag: '2026-02-23',
    description:
      'Iterative GPT realtime update with improved turn-taking and transcription. Uses the GA nested session schema.',
    profile: GA_PROFILE,
  },
  {
    id: 'gpt-realtime-2',
    label: 'GPT-realtime 2',
    family: 'gpt-realtime',
    description:
      'Next-generation GPT realtime preset (forward-compatible). Uses the GA nested session schema and does not accept a sampling temperature; may not be available in every region yet.',
    preview: true,
    profile: GA_PROFILE_NO_TEMPERATURE,
  },
  {
    id: 'gpt-realtime-mini',
    label: 'GPT-realtime mini',
    family: 'gpt-realtime',
    description:
      'Cost-efficient GPT realtime variant using the GA nested session schema. Ideal for lightweight voice experiences.',
    profile: GA_PROFILE,
  },
  {
    id: 'gpt-4o-realtime-preview',
    label: 'GPT-4o realtime (legacy preview)',
    family: 'gpt-4o-realtime',
    description:
      'Legacy preview model using the original flat session schema. Selectable for backward compatibility with older deployments.',
    recommendedApiVersion: '2025-04-01-preview',
    profile: LEGACY_PROFILE,
  },
  {
    id: 'gpt-4o-mini-realtime-preview',
    label: 'GPT-4o mini realtime (legacy preview)',
    family: 'gpt-4o-realtime',
    description:
      'Legacy cost-efficient preview model using the flat session schema.',
    recommendedApiVersion: '2025-04-01-preview',
    profile: LEGACY_PROFILE,
  },
]

export const DEFAULT_MODEL_ID = 'gpt-realtime'

const MODEL_PRESET_MAP: ReadonlyMap<string, RealtimeModelPreset> = new Map(
  MODEL_PRESETS.map((preset) => [preset.id, preset]),
)

/** Returns the preset for an id, falling back to the default preset. */
export function getModelPreset(id: string): RealtimeModelPreset {
  const preset = MODEL_PRESET_MAP.get(id)
  if (preset) {
    return preset
  }
  const fallback = MODEL_PRESET_MAP.get(DEFAULT_MODEL_ID)
  if (!fallback) {
    // MODEL_PRESETS always contains DEFAULT_MODEL_ID; this satisfies the type checker.
    throw new Error('Default model preset is missing from the catalog.')
  }
  return fallback
}

/** Returns the capability profile for a model id. */
export function getModelProfile(id: string): ModelCapabilityProfile {
  return getModelPreset(id).profile
}
