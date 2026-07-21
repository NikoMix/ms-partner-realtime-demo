import {
  CanonicalServerEvent,
  ClientEventType,
  isAudioDeltaEvent,
  isErrorEvent,
  isFunctionCallArgumentsDone,
  normalizeServerEvent,
  parseServerEvent,
  type RealtimeEventBase,
} from './events'
import { getProvider } from '@/providers/registry'
import {
  buildFunctionCallOutput,
  buildResponseCreate,
  buildSessionUpdate,
  resolveOutputModalities,
} from './session-config'
import { useConnectionStore } from '@/stores/connection'
import { useEventLogStore } from '@/stores/eventlog'
import { useSettingsStore } from '@/stores/settings'
import { useToolsStore } from '@/stores/tools'
import { createId } from '@/utils/id'
import { safeStringify } from '@/utils/json'
import { redactSecrets } from '@/utils/redact'
import type { RealtimeConnectionParams } from '@/providers/types'
import type { RealtimeAudioSink } from './audio-sink'

const SOCKET_CONNECTING = 0
const SOCKET_OPEN = 1
const NORMAL_CLOSE_CODE = 1000
const SESSION_UPDATE_TIMEOUT_MS = 5_000
const MAX_FUNCTION_RESPONSE_RETRIES = 1

interface SessionUpdateWaiter {
  readonly generation: number
  readonly resolve: () => void
  readonly reject: (error: Error) => void
}

interface PendingSessionUpdate {
  readonly eventId: string
  readonly generation: number
  readonly includesVoice: boolean
  readonly speed: number | null
  readonly timeout: ReturnType<typeof setTimeout>
}

export interface RealtimeClientOptions {
  webSocketFactory?: (url: string, protocols?: string[]) => WebSocket
  audioSink?: RealtimeAudioSink
}

export class RealtimeClient {
  private socket: WebSocket | null = null
  private readonly webSocketFactory: (url: string, protocols?: string[]) => WebSocket
  private readonly audioSink?: RealtimeAudioSink
  private pendingFunctionResponse = false
  private pendingFunctionResponseRetryCount = 0
  private pendingResponseCreateEventId: string | null = null
  private sessionReady = false
  private voiceConfigured = false
  private appliedSpeed: number | null = null
  private requestedSessionUpdateGeneration = 0
  private settledSessionUpdateGeneration = 0
  private pendingSessionUpdate: PendingSessionUpdate | null = null
  private sessionUpdateWaiters: SessionUpdateWaiter[] = []

  constructor(options: RealtimeClientOptions = {}) {
    this.webSocketFactory =
      options.webSocketFactory ?? ((url, protocols) => new WebSocket(url, protocols))
    this.audioSink = options.audioSink
  }

  connect(): void {
    // Drop any prior socket + deferred follow-up before starting a fresh session.
    this.teardownSocket()
    this.pendingFunctionResponse = false
    this.sessionReady = false
    const settings = useSettingsStore()
    const connection = useConnectionStore()
    const events = useEventLogStore()
    const provider = getProvider(settings.connectionConfig.providerId)

    if (!provider.descriptor.supportsRealtimeAudio) {
      const message = `${provider.descriptor.label} does not support realtime audio streaming.`
      connection.setError(message)
      events.add({
        direction: 'system',
        severity: 'error',
        type: 'provider.unsupported',
        summary: message,
      })
      return
    }

    const params = this.buildConnectionParams(settings.connectionConfig, settings.profile.schema)

    try {
      const url = provider.buildRealtimeUrl(params)
      const redactedUrl = provider.redactUrl(url)
      connection.setConnecting(redactedUrl)
      events.add({
        direction: 'system',
        severity: 'info',
        type: 'websocket.connect',
        summary: `Connecting to ${provider.descriptor.label}`,
        detail: redactSecrets(redactedUrl, [params.apiKey]),
      })

      const socket = this.webSocketFactory(url, provider.realtimeSubprotocols(params))
      this.socket = socket
      socket.onopen = () => this.handleOpen()
      socket.onmessage = (event) => this.handleMessage(event)
      socket.onerror = () => this.handleError()
      socket.onclose = (event) => this.handleClose(event)
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : 'Failed to connect realtime WebSocket.'
      // Defense-in-depth: never surface a message that could echo the key-bearing URL.
      const message = redactSecrets(rawMessage, [params.apiKey])
      connection.setError(message)
      events.add({
        direction: 'system',
        severity: 'error',
        type: 'websocket.connect.error',
        summary: message,
      })
    }
  }

  sendAudioChunk(base64Audio: string): boolean {
    return this.sendRaw({ type: ClientEventType.InputAudioBufferAppend, audio: base64Audio })
  }

  commitInput(): void {
    this.sendEvent({ type: ClientEventType.InputAudioBufferCommit })
  }

  clearInput(): void {
    this.sendEvent({ type: ClientEventType.InputAudioBufferClear })
  }

  createResponse(): void {
    if (!useConnectionStore().responseInProgress && !this.pendingFunctionResponse) {
      this.sendResponseCreate()
    }
  }

  updateSession(): Promise<void> {
    if (!this.sessionReady) {
      return Promise.resolve()
    }

    const generation = ++this.requestedSessionUpdateGeneration
    const acknowledged = new Promise<void>((resolve, reject) => {
      this.sessionUpdateWaiters.push({ generation, resolve, reject })
    })
    this.pumpSessionUpdate()
    return acknowledged
  }

  disconnect(): void {
    const connection = useConnectionStore()
    const events = useEventLogStore()
    connection.setClosing()
    this.pendingFunctionResponse = false

    const hadSocket = this.socket !== null
    this.teardownSocket()
    if (!hadSocket) {
      connection.setClosed(null, '')
      return
    }
    connection.setClosed(NORMAL_CLOSE_CODE, 'Client disconnect')
    events.add({
      direction: 'system',
      severity: 'info',
      type: 'websocket.close',
      summary: 'Realtime WebSocket disconnected by client.',
    })
  }

  private buildConnectionParams(
    config: ReturnType<typeof useSettingsStore>['connectionConfig'],
    schema: RealtimeConnectionParams['schema'],
  ): RealtimeConnectionParams {
    return {
      endpoint: config.endpoint,
      deployment: config.deployment,
      apiKey: config.apiKey,
      apiVersion: config.apiVersion,
      schema,
    }
  }

  private handleOpen(): void {
    useEventLogStore().add({
      direction: 'system',
      severity: 'info',
      type: 'websocket.open',
      summary: 'Realtime WebSocket opened; waiting for session creation.',
    })
  }

  private handleMessage(messageEvent: MessageEvent): void {
    const data = messageEvent.data
    if (typeof data !== 'string') {
      this.logSystemWarning(
        'websocket.message.invalid',
        'Ignoring non-text realtime WebSocket frame.',
      )
      return
    }

    const event = parseServerEvent(data)
    if (!event) {
      this.logSystemWarning(
        'websocket.message.invalid',
        'Ignoring malformed realtime server event.',
      )
      return
    }

    this.logInboundEvent(event)
    this.handleServerEvent(event)
  }

  private handleServerEvent(event: RealtimeEventBase): void {
    const canonical = normalizeServerEvent(event.type)
    switch (canonical) {
      case CanonicalServerEvent.SessionCreated:
        this.handleSessionCreated(event)
        return
      case CanonicalServerEvent.SessionUpdated:
        this.handleSessionUpdated()
        return
      case CanonicalServerEvent.SpeechStarted:
        this.handleSpeechStarted()
        return
      case CanonicalServerEvent.SpeechStopped:
        useConnectionStore().userSpeaking = false
        return
      case CanonicalServerEvent.ResponseCreated:
        if (this.pendingResponseCreateEventId && this.pendingFunctionResponse) {
          this.pendingFunctionResponse = false
          this.pendingFunctionResponseRetryCount = 0
        }
        this.pendingResponseCreateEventId = null
        useConnectionStore().responseInProgress = true
        return
      case CanonicalServerEvent.ResponseDone:
        this.handleResponseDone()
        return
      case CanonicalServerEvent.AudioDelta:
        this.handleAudioDelta(event)
        return
      case CanonicalServerEvent.FunctionCallArgumentsDone:
        if (isFunctionCallArgumentsDone(event)) {
          this.handleFunctionCall(event)
        }
        return
      case CanonicalServerEvent.Error:
        if (isErrorEvent(event)) {
          this.handleRealtimeError(event)
        }
        return
      default:
        return
    }
  }

  private handleSessionCreated(event: RealtimeEventBase): void {
    const session = event.session
    const connection = useConnectionStore()
    if (isRecord(session)) {
      const id = session.id
      if (typeof id === 'string' && id.length > 0) {
        connection.setSessionId(id)
      }
    }
    this.sessionReady = true
    connection.setConnected()
    // Failures are surfaced by the realtime error/timeout handlers.
    void this.updateSession().catch(() => undefined)
  }

  private handleSessionUpdated(): void {
    const pending = this.pendingSessionUpdate
    if (!pending) {
      return
    }

    clearTimeout(pending.timeout)
    this.pendingSessionUpdate = null
    this.settledSessionUpdateGeneration = pending.generation
    if (pending.includesVoice) {
      this.voiceConfigured = true
    }
    if (pending.speed !== null) {
      this.appliedSpeed = pending.speed
    }

    const remaining: SessionUpdateWaiter[] = []
    for (const waiter of this.sessionUpdateWaiters) {
      if (waiter.generation <= pending.generation) {
        waiter.resolve()
      } else {
        remaining.push(waiter)
      }
    }
    this.sessionUpdateWaiters = remaining
    this.pumpSessionUpdate()
    this.flushPendingFunctionResponse()
  }

  private handleSpeechStarted(): void {
    const connection = useConnectionStore()
    const settings = useSettingsStore()
    connection.userSpeaking = true
    if (settings.session.turnDetection.interruptResponse) {
      this.audioSink?.clear()
      if (connection.responseInProgress) {
        this.sendEvent({ type: ClientEventType.ResponseCancel }, 'warning')
      }
    }
  }

  private handleAudioDelta(event: RealtimeEventBase): void {
    const delta = event.delta
    if (typeof delta === 'string') {
      this.audioSink?.enqueue(delta)
    }
  }

  private handleResponseDone(): void {
    const connection = useConnectionStore()
    this.pendingResponseCreateEventId = null
    connection.responseInProgress = false
    this.pumpSessionUpdate()
    this.flushPendingFunctionResponse()
  }

  private handleFunctionCall(event: RealtimeEventBase): void {
    const callId = readStringField(event, 'call_id')
    if (!callId) {
      this.logSystemWarning('tool.stub.invalid', 'Ignoring function call without a call_id.')
      return
    }

    const name = readStringField(event, 'name')
    const argumentsJson = readStringField(event, 'arguments') ?? ''
    const settings = useSettingsStore()
    const tools = useToolsStore()
    const tool = name ? tools.findByName(name) : undefined
    const output =
      tool?.stubResponseJson ?? JSON.stringify({ error: 'No stub tool registered', name })

    tools.recordInvocation({
      toolName: name ?? '(unknown)',
      callId,
      argumentsJson,
      responseJson: output,
      matchedDefinitionId: tool?.id ?? null,
    })
    useEventLogStore().add({
      direction: 'system',
      severity: 'info',
      type: 'tool.stub',
      summary: `Stubbed function call: ${name ?? '(unknown)'}`,
      detail: redactSecrets(safeStringify({ callId, name, arguments: argumentsJson, output }), [
        settings.apiKey,
      ]),
    })

    this.sendEvent(buildFunctionCallOutput(callId, output))
    // Only one response may be active at a time. If the current response is still
    // streaming, defer the tool-result turn until ResponseDone; issuing
    // response.create now would fail with conversation_already_has_active_response
    // and the tool result would never be verbalized.
    this.pendingFunctionResponse = true
    this.pendingFunctionResponseRetryCount = 0
    this.flushPendingFunctionResponse()
  }

  private handleRealtimeError(event: RealtimeEventBase): void {
    const error = isRecord(event.error) ? event.error : null
    const message =
      typeof error?.message === 'string' && error.message.length > 0
        ? error.message
        : 'Realtime error'
    const originatingEventId =
      typeof error?.event_id === 'string' && error.event_id.length > 0 ? error.event_id : null
    const pending = this.pendingSessionUpdate
    if (pending && originatingEventId === pending.eventId) {
      this.rejectPendingSessionUpdate(new Error(message))
    }
    if (originatingEventId === this.pendingResponseCreateEventId) {
      this.pendingResponseCreateEventId = null
      useConnectionStore().responseInProgress = false
      this.pumpSessionUpdate()
      if (this.pendingFunctionResponse) {
        if (this.pendingFunctionResponseRetryCount < MAX_FUNCTION_RESPONSE_RETRIES) {
          this.pendingFunctionResponseRetryCount += 1
          this.flushPendingFunctionResponse()
        } else {
          this.pendingFunctionResponse = false
          this.pendingFunctionResponseRetryCount = 0
        }
      }
    }

    // Realtime protocol errors are recoverable by default. Keep the socket and
    // session active while surfacing the failure to the user and event log.
    useConnectionStore().setRecoverableError(message)
    useEventLogStore().add({
      direction: 'system',
      severity: 'error',
      type: 'realtime.error',
      summary: message,
      detail: this.redactDetail(event),
    })
  }

  private handleError(): void {
    const message = 'Realtime WebSocket error.'
    this.resetSessionUpdateState(new Error(message))
    this.teardownSocket()
    useConnectionStore().setError(message)
    useEventLogStore().add({
      direction: 'system',
      severity: 'error',
      type: 'websocket.error',
      summary: message,
    })
  }

  private handleClose(event: CloseEvent): void {
    this.sessionReady = false
    this.resetSessionUpdateState(
      new Error('Realtime connection closed before the session update was acknowledged.'),
    )
    useConnectionStore().setClosed(event.code, event.reason)
    useEventLogStore().add({
      direction: 'system',
      severity: event.code === NORMAL_CLOSE_CODE ? 'info' : 'warning',
      type: 'websocket.close',
      summary: `Realtime WebSocket closed (${event.code}).`,
      detail: event.reason,
    })
    this.socket = null
  }

  private sendEvent(
    payload: Record<string, unknown>,
    severity: 'info' | 'success' | 'warning' = 'info',
  ): boolean {
    if (!this.sendRaw(payload)) {
      return false
    }
    const type = typeof payload.type === 'string' ? payload.type : 'client.event'
    useEventLogStore().add({
      direction: 'outbound',
      severity,
      type,
      summary: type,
      detail: this.redactDetail(payload),
    })
    return true
  }

  private sendResponseCreate(): boolean {
    const settings = useSettingsStore()
    const eventId = `response-create-${createId()}`
    const sent = this.sendEvent({
      ...buildResponseCreate(settings.session, settings.profile),
      event_id: eventId,
    })
    if (sent) {
      this.pendingResponseCreateEventId = eventId
      useConnectionStore().responseInProgress = true
    }
    return sent
  }

  private sendRaw(payload: Record<string, unknown>): boolean {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) {
      return false
    }
    this.socket.send(safeStringify(payload, 0))
    return true
  }

  private logInboundEvent(event: RealtimeEventBase): void {
    useEventLogStore().add({
      direction: 'inbound',
      severity: isErrorEvent(event) ? 'error' : 'info',
      type: event.type,
      summary: isAudioDeltaEvent(event.type) ? 'Audio delta received.' : event.type,
      detail: isAudioDeltaEvent(event.type) ? undefined : this.redactDetail(event),
    })
  }

  private logSystemWarning(type: string, summary: string): void {
    useEventLogStore().add({
      direction: 'system',
      severity: 'warning',
      type,
      summary,
    })
  }

  private redactDetail(value: unknown): string {
    return redactSecrets(safeStringify(value), [useSettingsStore().apiKey])
  }

  private teardownSocket(): void {
    this.sessionReady = false
    this.resetSessionUpdateState(
      new Error('Realtime connection closed before the session update was acknowledged.'),
    )
    const socket = this.socket
    if (!socket) {
      return
    }
    // Detach handlers first so a trailing close/error from this socket can never
    // clobber a socket opened by a subsequent connect().
    this.clearSocketHandlers(socket)
    if (socket.readyState === SOCKET_OPEN || socket.readyState === SOCKET_CONNECTING) {
      socket.close(NORMAL_CLOSE_CODE, 'Client disconnect')
    }
    this.socket = null
  }

  private pumpSessionUpdate(): void {
    if (
      !this.sessionReady ||
      this.pendingSessionUpdate ||
      this.settledSessionUpdateGeneration >= this.requestedSessionUpdateGeneration
    ) {
      return
    }

    const generation = this.requestedSessionUpdateGeneration
    const eventId = `session-update-${createId()}`
    const settings = useSettingsStore()
    const tools = useToolsStore()
    const connection = useConnectionStore()
    const includesAudio = resolveOutputModalities(settings.session, settings.profile).includes(
      'audio',
    )
    const desiredSpeed =
      settings.profile.supportsSpeed && includesAudio ? settings.session.audio.speed : null

    if (
      connection.responseInProgress &&
      desiredSpeed !== null &&
      desiredSpeed !== this.appliedSpeed
    ) {
      return
    }

    const includeSpeed = !connection.responseInProgress
    const includesVoice = !this.voiceConfigured && includesAudio
    const speed = includeSpeed ? desiredSpeed : null
    const timeout = setTimeout(() => {
      this.failSessionUpdate('Realtime session update timed out.')
    }, SESSION_UPDATE_TIMEOUT_MS)
    this.pendingSessionUpdate = { eventId, generation, includesVoice, speed, timeout }

    if (
      !this.sendEvent(
        {
          ...buildSessionUpdate(settings.session, settings.profile, tools.toolSpecs, {
            includeSpeed,
            includeVoice: includesVoice,
          }),
          event_id: eventId,
        },
        'success',
      )
    ) {
      this.failSessionUpdate('Realtime session update could not be sent.')
    }
  }

  private failSessionUpdate(message: string): void {
    const error = new Error(message)
    this.resetSessionUpdateState(error)
    this.teardownSocket()
    useConnectionStore().setError(message)
    useEventLogStore().add({
      direction: 'system',
      severity: 'error',
      type: 'session.update.error',
      summary: message,
    })
  }

  private resetSessionUpdateState(error: Error): void {
    if (this.pendingSessionUpdate) {
      clearTimeout(this.pendingSessionUpdate.timeout)
      this.pendingSessionUpdate = null
    }
    for (const waiter of this.sessionUpdateWaiters) {
      waiter.reject(error)
    }
    this.sessionUpdateWaiters = []
    this.requestedSessionUpdateGeneration = 0
    this.settledSessionUpdateGeneration = 0
    this.voiceConfigured = false
    this.appliedSpeed = null
    this.pendingResponseCreateEventId = null
    this.pendingFunctionResponse = false
    this.pendingFunctionResponseRetryCount = 0
  }

  private rejectPendingSessionUpdate(error: Error): void {
    const pending = this.pendingSessionUpdate
    if (!pending) {
      return
    }

    clearTimeout(pending.timeout)
    this.pendingSessionUpdate = null
    this.settledSessionUpdateGeneration = pending.generation

    const remaining: SessionUpdateWaiter[] = []
    for (const waiter of this.sessionUpdateWaiters) {
      if (waiter.generation <= pending.generation) {
        waiter.reject(error)
      } else {
        remaining.push(waiter)
      }
    }
    this.sessionUpdateWaiters = remaining
    this.pumpSessionUpdate()
    this.flushPendingFunctionResponse()
  }

  private flushPendingFunctionResponse(): void {
    if (
      !this.pendingFunctionResponse ||
      !this.sessionReady ||
      useConnectionStore().responseInProgress ||
      this.pendingSessionUpdate ||
      this.settledSessionUpdateGeneration < this.requestedSessionUpdateGeneration
    ) {
      return
    }

    if (!this.sendResponseCreate()) {
      this.pendingFunctionResponse = true
    }
  }

  private clearSocketHandlers(socket: WebSocket): void {
    socket.onopen = null
    socket.onmessage = null
    socket.onerror = null
    socket.onclose = null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readStringField(record: RealtimeEventBase, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}
