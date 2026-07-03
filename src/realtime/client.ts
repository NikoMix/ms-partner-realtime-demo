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
import { buildFunctionCallOutput, buildResponseCreate, buildSessionUpdate } from './session-config'
import { useConnectionStore } from '@/stores/connection'
import { useEventLogStore } from '@/stores/eventlog'
import { useSettingsStore } from '@/stores/settings'
import { useToolsStore } from '@/stores/tools'
import { safeStringify } from '@/utils/json'
import { redactSecrets } from '@/utils/redact'
import type { RealtimeConnectionParams } from '@/providers/types'
import type { RealtimeAudioSink } from './audio-sink'

const SOCKET_CONNECTING = 0
const SOCKET_OPEN = 1
const NORMAL_CLOSE_CODE = 1000

export interface RealtimeClientOptions {
  webSocketFactory?: (url: string, protocols?: string[]) => WebSocket
  audioSink?: RealtimeAudioSink
}

export class RealtimeClient {
  private socket: WebSocket | null = null
  private readonly webSocketFactory: (url: string, protocols?: string[]) => WebSocket
  private readonly audioSink?: RealtimeAudioSink

  constructor(options: RealtimeClientOptions = {}) {
    this.webSocketFactory =
      options.webSocketFactory ?? ((url, protocols) => new WebSocket(url, protocols))
    this.audioSink = options.audioSink
  }

  connect(): void {
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
      const message =
        error instanceof Error ? error.message : 'Failed to connect realtime WebSocket.'
      connection.setError(message)
      events.add({
        direction: 'system',
        severity: 'error',
        type: 'websocket.connect.error',
        summary: message,
      })
    }
  }

  sendAudioChunk(base64Pcm16: string): void {
    this.sendRaw({ type: ClientEventType.InputAudioBufferAppend, audio: base64Pcm16 })
  }

  commitInput(): void {
    this.sendEvent({ type: ClientEventType.InputAudioBufferCommit })
  }

  clearInput(): void {
    this.sendEvent({ type: ClientEventType.InputAudioBufferClear })
  }

  createResponse(): void {
    const settings = useSettingsStore()
    this.sendEvent(buildResponseCreate(settings.session, settings.profile))
  }

  disconnect(): void {
    const connection = useConnectionStore()
    const events = useEventLogStore()
    connection.setClosing()

    const socket = this.socket
    if (!socket) {
      connection.setClosed(null, '')
      return
    }

    this.clearSocketHandlers(socket)
    if (socket.readyState === SOCKET_OPEN || socket.readyState === SOCKET_CONNECTING) {
      socket.close(NORMAL_CLOSE_CODE, 'Client disconnect')
    }
    this.socket = null
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
    const settings = useSettingsStore()
    const tools = useToolsStore()
    useConnectionStore().setConnected()
    this.sendEvent(
      buildSessionUpdate(settings.session, settings.profile, tools.toolSpecs),
      'success',
    )
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
      case CanonicalServerEvent.SpeechStarted:
        this.handleSpeechStarted()
        return
      case CanonicalServerEvent.SpeechStopped:
        useConnectionStore().userSpeaking = false
        return
      case CanonicalServerEvent.ResponseCreated:
        useConnectionStore().responseInProgress = true
        return
      case CanonicalServerEvent.ResponseDone:
        useConnectionStore().responseInProgress = false
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
    if (!isRecord(session)) {
      return
    }
    const id = session.id
    if (typeof id === 'string' && id.length > 0) {
      useConnectionStore().setSessionId(id)
    }
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
    this.sendEvent(buildResponseCreate(settings.session, settings.profile))
  }

  private handleRealtimeError(event: RealtimeEventBase): void {
    const error = isRecord(event.error) ? event.error : null
    const message =
      typeof error?.message === 'string' && error.message.length > 0
        ? error.message
        : 'Realtime error'
    useConnectionStore().setError(message)
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
    useConnectionStore().setError(message)
    useEventLogStore().add({
      direction: 'system',
      severity: 'error',
      type: 'websocket.error',
      summary: message,
    })
  }

  private handleClose(event: CloseEvent): void {
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
  ): void {
    if (!this.sendRaw(payload)) {
      return
    }
    const type = typeof payload.type === 'string' ? payload.type : 'client.event'
    useEventLogStore().add({
      direction: 'outbound',
      severity,
      type,
      summary: type,
      detail: this.redactDetail(payload),
    })
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
