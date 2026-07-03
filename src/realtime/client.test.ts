import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useConnectionStore } from '@/stores/connection'
import { useSettingsStore } from '@/stores/settings'
import { useToolsStore } from '@/stores/tools'
import { safeParse } from '@/utils/json'
import { RealtimeClient, type RealtimeClientOptions } from './client'
import type { RealtimeAudioSink } from './audio-sink'

interface ClientPayload {
  type?: string
  item?: {
    type?: string
    call_id?: string
    output?: string
  }
  response?: Record<string, unknown>
}

class FakeWebSocket {
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  readyState = 0
  readonly sent: string[] = []

  constructor(
    readonly url: string,
    readonly protocols?: string[],
  ) {}

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.sent.push(typeof data === 'string' ? data : '[binary]')
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3
    this.onclose?.(new CloseEvent('close', { code: code ?? 1000, reason: reason ?? '' }))
  }

  open(): void {
    this.readyState = 1
    this.onopen?.(new Event('open'))
  }

  message(data: string): void {
    this.onmessage?.(new MessageEvent('message', { data }))
  }
}

function createClient(audioSink?: RealtimeAudioSink): {
  client: RealtimeClient
  sockets: FakeWebSocket[]
} {
  const sockets: FakeWebSocket[] = []
  const options: RealtimeClientOptions = {
    audioSink,
    webSocketFactory: (url, protocols) => {
      const socket = new FakeWebSocket(url, protocols)
      sockets.push(socket)
      return socket as unknown as WebSocket
    },
  }
  return { client: new RealtimeClient(options), sockets }
}

function configureSettings(): void {
  const settings = useSettingsStore()
  settings.setProvider('azure-foundry')
  settings.setModelPreset('gpt-realtime')
  settings.endpoint = 'https://example.openai.azure.com'
  settings.deployment = 'gpt-realtime'
  settings.apiKey = 'super-secret-key'
  settings.apiVersion = '2025-04-01-preview'
}

function firstSocket(sockets: readonly FakeWebSocket[]): FakeWebSocket {
  const socket = sockets[0]
  expect(socket).toBeDefined()
  return socket!
}

function payload(raw: string | undefined): ClientPayload {
  expect(raw).toBeDefined()
  return safeParse<ClientPayload>(raw ?? '{}', {})
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  configureSettings()
})

describe('RealtimeClient', () => {
  it('sends session.update when the socket opens', () => {
    const { client, sockets } = createClient()
    client.connect()

    const socket = firstSocket(sockets)
    socket.open()

    expect(payload(socket.sent[0]).type).toBe('session.update')
  })

  it('stubs function calls and sends function_call_output followed by response.create', () => {
    const tools = useToolsStore()
    const tool = tools.addTool()
    tools.updateTool(tool.id, {
      name: 'lookup_order',
      description: 'Look up an order.',
      parametersJson: '{"type":"object"}',
      stubResponseJson: '{"ok":true}',
      enabled: true,
    })
    const { client, sockets } = createClient()
    client.connect()
    const socket = firstSocket(sockets)
    socket.open()

    socket.message(
      JSON.stringify({
        type: 'response.function_call_arguments.done',
        call_id: 'call-1',
        name: 'lookup_order',
        arguments: '{"orderId":"42"}',
      }),
    )

    const invocation = tools.invocations[0]
    expect(invocation?.toolName).toBe('lookup_order')
    expect(invocation?.matchedDefinitionId).toBe(tool.id)

    const sentPayloads = socket.sent.map((entry) => payload(entry))
    const functionOutput = sentPayloads.find((entry) => entry.type === 'conversation.item.create')
    const responseCreate = sentPayloads.findLast((entry) => entry.type === 'response.create')

    expect(functionOutput?.item?.type).toBe('function_call_output')
    expect(functionOutput?.item?.call_id).toBe('call-1')
    expect(functionOutput?.item?.output).toBe('{"ok":true}')
    expect(responseCreate?.response?.temperature).toBeCloseTo(0.8)
  })

  it('forwards audio deltas to the audio sink', () => {
    const enqueue = vi.fn<(base64Pcm16: string) => void>()
    const audioSink: RealtimeAudioSink = {
      enqueue,
      clear: vi.fn<() => void>(),
    }
    const { client, sockets } = createClient(audioSink)
    client.connect()
    const socket = firstSocket(sockets)
    socket.open()

    socket.message(JSON.stringify({ type: 'response.audio.delta', delta: 'base64-audio' }))

    expect(enqueue).toHaveBeenCalledWith('base64-audio')
  })

  it('sets connection errors from realtime error events', () => {
    const { client, sockets } = createClient()
    client.connect()
    const socket = firstSocket(sockets)
    socket.open()

    socket.message(JSON.stringify({ type: 'error', error: { message: 'boom' } }))

    expect(useConnectionStore().errorMessage).toBe('boom')
  })
})
