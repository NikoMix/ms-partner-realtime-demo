import { REALTIME_SAMPLE_RATE_HZ, type ModelCapabilityProfile } from '@/models/catalog'
import { ClientEventType } from './events'
import type { SessionSettings, TurnDetectionSettings } from '@/types/settings'
import type { RealtimeToolSpec } from '@/types/tools'

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
    output_modalities: [...settings.outputModalities],
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
    modalities: [...settings.outputModalities],
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
