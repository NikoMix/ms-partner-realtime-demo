import { REALTIME_SAMPLE_RATE_HZ, type ModelCapabilityProfile } from '@/models/catalog'
import { ClientEventType } from './events'
import type { OutputModality } from '@/models/catalog'
import type { SessionSettings, TurnDetectionSettings } from '@/types/settings'
import type { RealtimeToolSpec } from '@/types/tools'

/**
 * Audio and text output are mutually exclusive on the wire: audio responses
 * already include a text transcript, and the realtime API rejects a request
 * for both at once. A selection is therefore treated as "text only" only when
 * text is chosen without audio.
 */
function isTextOnly(modalities: readonly OutputModality[]): boolean {
  return modalities.includes('text') && !modalities.includes('audio')
}

/** GA schema: a single-element `output_modalities` array (`audio` or `text`). */
function gaOutputModalities(settings: SessionSettings): string[] {
  return isTextOnly(settings.outputModalities) ? ['text'] : ['audio']
}

/** Legacy schema: audio mode returns audio plus a transcript; text disables audio. */
function legacyModalities(settings: SessionSettings): string[] {
  return isTextOnly(settings.outputModalities) ? ['text'] : ['text', 'audio']
}

export function mapTurnDetection(td: TurnDetectionSettings): Record<string, unknown> | null {
  switch (td.type) {
    case 'none':
      return null
    case 'server_vad':
      return {
        type: 'server_vad',
        threshold: td.threshold,
        prefix_padding_ms: td.prefixPaddingMs,
        silence_duration_ms: td.silenceDurationMs,
        create_response: td.createResponse,
        interrupt_response: td.interruptResponse,
      }
    case 'semantic_vad':
      return {
        type: 'semantic_vad',
        eagerness: td.eagerness,
        create_response: td.createResponse,
        interrupt_response: td.interruptResponse,
      }
  }

  const exhaustive: never = td.type
  return exhaustive
}

export function buildSessionUpdate(
  settings: SessionSettings,
  profile: ModelCapabilityProfile,
  toolSpecs: readonly RealtimeToolSpec[],
): Record<string, unknown> {
  return {
    type: ClientEventType.SessionUpdate,
    session:
      profile.schema === 'ga'
        ? buildGaSession(settings, toolSpecs)
        : buildLegacySession(settings, toolSpecs),
  }
}

function buildGaSession(
  settings: SessionSettings,
  toolSpecs: readonly RealtimeToolSpec[],
): Record<string, unknown> {
  return {
    type: 'realtime',
    instructions: settings.instructions,
    output_modalities: gaOutputModalities(settings),
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: REALTIME_SAMPLE_RATE_HZ },
        transcription: buildGaTranscription(settings),
        turn_detection: mapTurnDetection(settings.turnDetection),
        noise_reduction:
          settings.audio.noiseReduction === 'none' ? null : { type: settings.audio.noiseReduction },
      },
      output: {
        voice: settings.audio.voice,
        format: { type: 'audio/pcm', rate: REALTIME_SAMPLE_RATE_HZ },
        speed: settings.audio.speed,
      },
    },
    tools: [...toolSpecs],
    tool_choice: settings.toolChoice,
    max_output_tokens: settings.maxOutputTokens,
  }
}

function buildGaTranscription(settings: SessionSettings): Record<string, unknown> | null {
  if (!settings.transcription.enabled) {
    return null
  }

  return {
    model: settings.transcription.model,
    ...(settings.transcription.language ? { language: settings.transcription.language } : {}),
    ...(settings.transcription.prompt ? { prompt: settings.transcription.prompt } : {}),
  }
}

function buildLegacySession(
  settings: SessionSettings,
  toolSpecs: readonly RealtimeToolSpec[],
): Record<string, unknown> {
  return {
    modalities: legacyModalities(settings),
    instructions: settings.instructions,
    voice: settings.audio.voice,
    input_audio_format: 'pcm16',
    output_audio_format: 'pcm16',
    input_audio_transcription: settings.transcription.enabled
      ? { model: settings.transcription.model }
      : null,
    turn_detection: mapTurnDetection(settings.turnDetection),
    temperature: settings.temperature,
    max_response_output_tokens: settings.maxOutputTokens,
    tool_choice: settings.toolChoice,
    tools: [...toolSpecs],
  }
}

export function buildResponseCreate(
  settings: SessionSettings,
  profile: ModelCapabilityProfile,
): Record<string, unknown> {
  return {
    type: ClientEventType.ResponseCreate,
    response:
      profile.temperature.scope === 'response' && profile.temperature.supported
        ? { temperature: settings.temperature }
        : {},
  }
}

export function buildFunctionCallOutput(callId: string, output: string): Record<string, unknown> {
  return {
    type: ClientEventType.ConversationItemCreate,
    item: {
      type: 'function_call_output',
      call_id: callId,
      output,
    },
  }
}
