import type { ModelCapabilityProfile } from '@/models/catalog'
import { ClientEventType } from './events'
import { PCM16_SAMPLE_RATE_HZ, type InputAudioFormat } from '@/types/audio'
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
  options: { readonly includeSpeed?: boolean; readonly includeVoice?: boolean } = {},
): Record<string, unknown> {
  const includeSpeed = options.includeSpeed ?? true
  const includeVoice = options.includeVoice ?? true
  return {
    type: ClientEventType.SessionUpdate,
    session:
      profile.schema === 'ga'
        ? buildGaSession(settings, profile, toolSpecs, includeSpeed, includeVoice)
        : buildLegacySession(settings, profile, toolSpecs, includeVoice),
  }
}

function buildGaSession(
  settings: SessionSettings,
  profile: ModelCapabilityProfile,
  toolSpecs: readonly RealtimeToolSpec[],
  includeSpeed: boolean,
  includeVoice: boolean,
): Record<string, unknown> {
  const outputModalities = resolveOutputModalities(settings, profile)
  const session: Record<string, unknown> = {
    type: 'realtime',
    instructions: settings.instructions,
    output_modalities: outputModalities,
    audio: {
      input: {
        format: mapGaInputAudioFormat(settings.audio.inputFormat),
        transcription: buildGaTranscription(settings),
        turn_detection: mapTurnDetection(settings.turnDetection),
        noise_reduction:
          settings.audio.noiseReduction === 'none' ? null : { type: settings.audio.noiseReduction },
      },
      ...(outputModalities.includes('audio')
        ? {
            output: {
              ...(includeVoice ? { voice: settings.audio.voice } : {}),
              format: { type: 'audio/pcm', rate: PCM16_SAMPLE_RATE_HZ },
              ...(includeSpeed ? { speed: settings.audio.speed } : {}),
            },
          }
        : {}),
    },
    tools: [...toolSpecs],
    tool_choice: settings.toolChoice,
    max_output_tokens: settings.maxOutputTokens,
  }

  if (profile.temperature.supported && profile.temperature.scope === 'session') {
    session.temperature = settings.temperature
  }

  return session
}

function mapGaInputAudioFormat(format: InputAudioFormat): Record<string, unknown> {
  switch (format) {
    case 'pcm16':
      return { type: 'audio/pcm', rate: PCM16_SAMPLE_RATE_HZ }
    case 'g711_ulaw':
      return { type: 'audio/pcmu' }
    case 'g711_alaw':
      return { type: 'audio/pcma' }
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
  profile: ModelCapabilityProfile,
  toolSpecs: readonly RealtimeToolSpec[],
  includeVoice: boolean,
): Record<string, unknown> {
  return {
    modalities: resolveOutputModalities(settings, profile),
    instructions: settings.instructions,
    ...(includeVoice ? { voice: settings.audio.voice } : {}),
    input_audio_format: settings.audio.inputFormat,
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

export function resolveOutputModalities(
  settings: SessionSettings,
  profile: ModelCapabilityProfile,
): ('audio' | 'text')[] {
  const valid = settings.outputModalities
    .filter(
      (modality, index, modalities) =>
        profile.outputModalities.supported.includes(modality) &&
        modalities.indexOf(modality) === index,
    )
    .slice(0, profile.outputModalities.maxSelected)
  return valid.length > 0 ? valid : [...profile.outputModalities.default]
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
