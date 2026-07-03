/**
 * Realtime protocol event contracts.
 *
 * The realtime API is a bidirectional JSON event stream over WebSocket. This
 * module defines the client event names we emit, the server event names we
 * recognise, and — crucially — normalisation helpers that collapse the two
 * naming variants the service uses for audio and transcript deltas
 * (`response.audio.delta` vs `response.output_audio.delta`, etc.) into a single
 * canonical value the rest of the app can switch on.
 */

// ---------------------------------------------------------------------------
// Client -> server event names
// ---------------------------------------------------------------------------

export const ClientEventType = {
  SessionUpdate: 'session.update',
  InputAudioBufferAppend: 'input_audio_buffer.append',
  InputAudioBufferCommit: 'input_audio_buffer.commit',
  InputAudioBufferClear: 'input_audio_buffer.clear',
  ConversationItemCreate: 'conversation.item.create',
  ConversationItemTruncate: 'conversation.item.truncate',
  ConversationItemDelete: 'conversation.item.delete',
  ResponseCreate: 'response.create',
  ResponseCancel: 'response.cancel',
} as const
export type ClientEventType = (typeof ClientEventType)[keyof typeof ClientEventType]

// ---------------------------------------------------------------------------
// Server -> client event names (canonical + variants)
// ---------------------------------------------------------------------------

export const AUDIO_DELTA_EVENTS = ['response.audio.delta', 'response.output_audio.delta'] as const
export const AUDIO_DONE_EVENTS = ['response.audio.done', 'response.output_audio.done'] as const
export const AUDIO_TRANSCRIPT_DELTA_EVENTS = [
  'response.audio_transcript.delta',
  'response.output_audio_transcript.delta',
] as const
export const AUDIO_TRANSCRIPT_DONE_EVENTS = [
  'response.audio_transcript.done',
  'response.output_audio_transcript.done',
] as const

export const ServerEventType = {
  Error: 'error',
  SessionCreated: 'session.created',
  SessionUpdated: 'session.updated',
  InputAudioBufferSpeechStarted: 'input_audio_buffer.speech_started',
  InputAudioBufferSpeechStopped: 'input_audio_buffer.speech_stopped',
  InputAudioBufferCommitted: 'input_audio_buffer.committed',
  InputAudioBufferCleared: 'input_audio_buffer.cleared',
  ConversationItemCreated: 'conversation.item.created',
  InputAudioTranscriptionCompleted: 'conversation.item.input_audio_transcription.completed',
  InputAudioTranscriptionDelta: 'conversation.item.input_audio_transcription.delta',
  InputAudioTranscriptionFailed: 'conversation.item.input_audio_transcription.failed',
  ResponseCreated: 'response.created',
  ResponseDone: 'response.done',
  ResponseOutputItemAdded: 'response.output_item.added',
  ResponseOutputItemDone: 'response.output_item.done',
  ResponseContentPartAdded: 'response.content_part.added',
  ResponseContentPartDone: 'response.content_part.done',
  ResponseTextDelta: 'response.text.delta',
  ResponseTextDone: 'response.text.done',
  FunctionCallArgumentsDelta: 'response.function_call_arguments.delta',
  FunctionCallArgumentsDone: 'response.function_call_arguments.done',
  RateLimitsUpdated: 'rate_limits.updated',
} as const
export type ServerEventType = (typeof ServerEventType)[keyof typeof ServerEventType]

/**
 * Canonical semantic categories the app cares about, independent of which
 * naming variant the server used.
 */
export const CanonicalServerEvent = {
  Error: 'error',
  SessionCreated: 'session.created',
  SessionUpdated: 'session.updated',
  SpeechStarted: 'speech.started',
  SpeechStopped: 'speech.stopped',
  AudioDelta: 'audio.delta',
  AudioDone: 'audio.done',
  AudioTranscriptDelta: 'audio.transcript.delta',
  AudioTranscriptDone: 'audio.transcript.done',
  InputTranscriptionCompleted: 'input.transcription.completed',
  TextDelta: 'text.delta',
  TextDone: 'text.done',
  FunctionCallArgumentsDone: 'function_call.arguments.done',
  ResponseCreated: 'response.created',
  ResponseDone: 'response.done',
  RateLimitsUpdated: 'rate_limits.updated',
  Other: 'other',
} as const
export type CanonicalServerEvent = (typeof CanonicalServerEvent)[keyof typeof CanonicalServerEvent]

// ---------------------------------------------------------------------------
// Event envelope types
// ---------------------------------------------------------------------------

/** Base shape common to all realtime events. Extra fields kept as `unknown`. */
export interface RealtimeEventBase {
  readonly type: string
  readonly event_id?: string
  readonly [key: string]: unknown
}

export interface AudioDeltaEvent extends RealtimeEventBase {
  /** Base64-encoded PCM16 audio chunk. */
  readonly delta: string
  readonly response_id?: string
  readonly item_id?: string
}

export interface TranscriptDeltaEvent extends RealtimeEventBase {
  readonly delta: string
}

export interface FunctionCallArgumentsDoneEvent extends RealtimeEventBase {
  readonly type: 'response.function_call_arguments.done'
  readonly call_id: string
  readonly name?: string
  readonly arguments: string
  readonly response_id?: string
}

export interface RealtimeErrorEvent extends RealtimeEventBase {
  readonly type: 'error'
  readonly error: {
    readonly type?: string
    readonly code?: string
    readonly message?: string
    readonly param?: string | null
  }
}

// ---------------------------------------------------------------------------
// Type guards & normalisation
// ---------------------------------------------------------------------------

function includes(list: readonly string[], value: string): boolean {
  return list.includes(value)
}

export function isAudioDeltaEvent(type: string): boolean {
  return includes(AUDIO_DELTA_EVENTS, type)
}

export function isAudioDoneEvent(type: string): boolean {
  return includes(AUDIO_DONE_EVENTS, type)
}

export function isAudioTranscriptDeltaEvent(type: string): boolean {
  return includes(AUDIO_TRANSCRIPT_DELTA_EVENTS, type)
}

export function isAudioTranscriptDoneEvent(type: string): boolean {
  return includes(AUDIO_TRANSCRIPT_DONE_EVENTS, type)
}

export function isFunctionCallArgumentsDone(
  event: RealtimeEventBase,
): event is FunctionCallArgumentsDoneEvent {
  return event.type === ServerEventType.FunctionCallArgumentsDone
}

export function isErrorEvent(event: RealtimeEventBase): event is RealtimeErrorEvent {
  return event.type === ServerEventType.Error
}

/** Collapses server event-name variants into a single canonical category. */
export function normalizeServerEvent(type: string): CanonicalServerEvent {
  if (isAudioDeltaEvent(type)) {
    return CanonicalServerEvent.AudioDelta
  }
  if (isAudioDoneEvent(type)) {
    return CanonicalServerEvent.AudioDone
  }
  if (isAudioTranscriptDeltaEvent(type)) {
    return CanonicalServerEvent.AudioTranscriptDelta
  }
  if (isAudioTranscriptDoneEvent(type)) {
    return CanonicalServerEvent.AudioTranscriptDone
  }
  switch (type) {
    case ServerEventType.Error:
      return CanonicalServerEvent.Error
    case ServerEventType.SessionCreated:
      return CanonicalServerEvent.SessionCreated
    case ServerEventType.SessionUpdated:
      return CanonicalServerEvent.SessionUpdated
    case ServerEventType.InputAudioBufferSpeechStarted:
      return CanonicalServerEvent.SpeechStarted
    case ServerEventType.InputAudioBufferSpeechStopped:
      return CanonicalServerEvent.SpeechStopped
    case ServerEventType.InputAudioTranscriptionCompleted:
      return CanonicalServerEvent.InputTranscriptionCompleted
    case ServerEventType.ResponseTextDelta:
      return CanonicalServerEvent.TextDelta
    case ServerEventType.ResponseTextDone:
      return CanonicalServerEvent.TextDone
    case ServerEventType.FunctionCallArgumentsDone:
      return CanonicalServerEvent.FunctionCallArgumentsDone
    case ServerEventType.ResponseCreated:
      return CanonicalServerEvent.ResponseCreated
    case ServerEventType.ResponseDone:
      return CanonicalServerEvent.ResponseDone
    case ServerEventType.RateLimitsUpdated:
      return CanonicalServerEvent.RateLimitsUpdated
    default:
      return CanonicalServerEvent.Other
  }
}

/** Safely parses a raw WebSocket text frame into a realtime event envelope. */
export function parseServerEvent(raw: string): RealtimeEventBase | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && 'type' in parsed) {
      const typeValue: unknown = parsed.type
      if (typeof typeValue === 'string') {
        return parsed as RealtimeEventBase
      }
    }
    return null
  } catch {
    return null
  }
}
