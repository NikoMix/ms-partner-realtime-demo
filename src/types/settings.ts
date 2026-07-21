import {
  type ModelCapabilityProfile,
  type NoiseReductionType,
  type OutputModality,
  type SemanticVadEagerness,
  type ToolChoiceMode,
  type TurnDetectionType,
} from '@/models/catalog'
import type { ProviderId } from '@/providers/types'
import type { InputAudioFormat } from '@/types/audio'

/**
 * User-facing session configuration. This is a superset of both the legacy and
 * GA schemas; the realtime engine's session-config mapper reads the active
 * model profile to project this into the correct wire shape.
 */

export interface TurnDetectionSettings {
  type: TurnDetectionType
  /** server_vad: activation threshold (0–1). */
  threshold: number
  /** server_vad: audio to include before speech is detected. */
  prefixPaddingMs: number
  /** server_vad: silence required before the turn is considered finished. */
  silenceDurationMs: number
  /** semantic_vad: how eagerly the model responds. */
  eagerness: SemanticVadEagerness
  /** Automatically create a response when a turn ends. */
  createResponse: boolean
  /** Interrupt an in-progress response when the user starts speaking. */
  interruptResponse: boolean
}

export interface TranscriptionSettings {
  enabled: boolean
  model: string
  /** Optional ISO-639-1 language hint; empty string means auto-detect. */
  language: string
  /** Optional prompt to guide the transcription model. */
  prompt: string
}

export interface AudioSettings {
  /** Microphone encoding sent to the realtime input audio buffer. */
  inputFormat: InputAudioFormat
  voice: string
  /** GA `audio.output.speed` playback rate (0.25–1.5). */
  speed: number
  /** GA input noise reduction mode. */
  noiseReduction: NoiseReductionType
}

export interface SessionSettings {
  instructions: string
  outputModalities: OutputModality[]
  temperature: number
  /** Max output tokens; `'inf'` maps to the API's unlimited sentinel. */
  maxOutputTokens: number | 'inf'
  toolChoice: ToolChoiceMode
  turnDetection: TurnDetectionSettings
  transcription: TranscriptionSettings
  audio: AudioSettings
}

/**
 * Connection configuration. SECURITY: `apiKey`, `endpoint`, and `deployment`
 * are held in memory only and are never persisted to storage or written to the
 * event log.
 */
export interface ProviderConnectionConfig {
  providerId: ProviderId
  endpoint: string
  deployment: string
  apiKey: string
  apiVersion: string
  modelPresetId: string
}

const DEFAULT_INSTRUCTIONS =
  'You are a helpful, concise realtime voice assistant. Respond naturally and keep spoken answers brief unless asked for detail.'

/** Builds a fully-populated default {@link SessionSettings} for a model profile. */
export function createDefaultSessionSettings(profile: ModelCapabilityProfile): SessionSettings {
  return {
    instructions: DEFAULT_INSTRUCTIONS,
    outputModalities: [...profile.outputModalities.default],
    temperature: profile.temperature.default,
    maxOutputTokens: profile.maxOutputTokens.default,
    toolChoice: 'auto',
    turnDetection: {
      type: profile.turnDetection.includes('server_vad') ? 'server_vad' : 'none',
      threshold: 0.5,
      prefixPaddingMs: 300,
      silenceDurationMs: 500,
      eagerness: 'auto',
      createResponse: true,
      interruptResponse: true,
    },
    transcription: {
      enabled: true,
      model: profile.defaultTranscriptionModel,
      language: '',
      prompt: '',
    },
    audio: {
      inputFormat: 'pcm16',
      voice: profile.defaultVoice,
      speed: 1.0,
      noiseReduction: profile.supportsNoiseReduction ? 'near_field' : 'none',
    },
  }
}
