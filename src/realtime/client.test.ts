import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useConnectionStore } from '@/stores/connection'
import { useSettingsStore } from '@/stores/settings'
import { useToolsStore } from '@/stores/tools'
import { safeParse } from '@/utils/json'
import { RealtimeClient, type RealtimeClientOptions } from './client'
import type { RealtimeAudioSink } from './audio-sink'

interface ClientPayload {
  event_id?: string
  type?: string
  session?: Record<string, unknown>
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

function acknowledgeSessionUpdate(socket: FakeWebSocket): void {
  socket.message(JSON.stringify({ type: 'session.updated', session: {} }))
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  configureSettings()
})

describe('RealtimeClient', () => {
  it('reports whether an audio chunk was queued on the WebSocket', () => {
    const { client, sockets } = createClient()

    expect(client.sendAudioChunk('AQ==')).toBe(false)
    client.connect()
    const socket = firstSocket(sockets)
    socket.open()

    expect(client.sendAudioChunk('AQ==')).toBe(true)
    expect(payload(socket.sent.at(-1))).toMatchObject({
      type: 'input_audio_buffer.append',
    })
  })

  it('waits for session.created before sending session.update', () => {
    const { client, sockets } = createClient()
    client.connect()

    const socket = firstSocket(sockets)
    socket.open()
    expect(socket.sent).toHaveLength(0)
    expect(useConnectionStore().status).toBe('connecting')
    socket.message(JSON.stringify({ type: 'session.created', session: { id: 'session-1' } }))

    expect(payload(socket.sent[0]).type).toBe('session.update')
    expect(payload(socket.sent[0]).event_id).toMatch(/^session-update-/)
    expect(payload(socket.sent[0]).session?.temperature).toBeUndefined()
    expect(
      (payload(socket.sent[0]).session?.audio as { output?: { voice?: string } } | undefined)
        ?.output?.voice,
    ).toBe('marin')
    expect(useConnectionStore().status).toBe('connected')
    expect(useConnectionStore().sessionId).toBe('session-1')
    acknowledgeSessionUpdate(socket)
  })

  it('applies changed settings and waits for session.updated', async () => {
    const { client, sockets } = createClient()
    client.connect()
    const socket = firstSocket(sockets)
    socket.open()
    socket.message(JSON.stringify({ type: 'session.created', session: { id: 'session-1' } }))
    acknowledgeSessionUpdate(socket)

    useSettingsStore().session.instructions = 'Use the latest instructions.'
    let acknowledged = false
    const update = client.updateSession().then(() => {
      acknowledged = true
    })
    await Promise.resolve()

    const latest = payload(socket.sent.at(-1))
    expect(latest.type).toBe('session.update')
    expect((latest as { session?: { instructions?: string } }).session?.instructions).toBe(
      'Use the latest instructions.',
    )
    expect(
      (latest.session?.audio as { output?: { voice?: string } } | undefined)?.output?.voice,
    ).toBeUndefined()
    expect(acknowledged).toBe(false)

    acknowledgeSessionUpdate(socket)
    await update
    expect(acknowledged).toBe(true)
  })

  it('queues the latest settings while a session update is in flight', async () => {
    const { client, sockets } = createClient()
    client.connect()
    const socket = firstSocket(sockets)
    socket.open()
    socket.message(JSON.stringify({ type: 'session.created', session: {} }))

    useSettingsStore().session.instructions = 'Queued instructions.'
    const queuedUpdate = client.updateSession()
    expect(socket.sent).toHaveLength(1)

    acknowledgeSessionUpdate(socket)
    expect(socket.sent).toHaveLength(2)
    expect(
      (payload(socket.sent[1]) as { session?: { instructions?: string } }).session?.instructions,
    ).toBe('Queued instructions.')

    acknowledgeSessionUpdate(socket)
    await expect(queuedUpdate).resolves.toBeUndefined()
  })

  it('sends the selected voice when a text-only session later switches to audio', async () => {
    const settings = useSettingsStore()
    settings.setModelPreset('gpt-realtime-2')
    settings.session.outputModalities = ['text']
    const { client, sockets } = createClient()
    client.connect()
    const socket = firstSocket(sockets)
    socket.open()
    socket.message(JSON.stringify({ type: 'session.created', session: {} }))

    const initialOutput = (
      payload(socket.sent.at(-1)).session?.audio as { output?: { voice?: string } } | undefined
    )?.output
    expect(initialOutput).toBeUndefined()
    acknowledgeSessionUpdate(socket)

    settings.session.outputModalities = ['audio']
    const update = client.updateSession()
    const audioOutput = (
      payload(socket.sent.at(-1)).session?.audio as { output?: { voice?: string } } | undefined
    )?.output
    expect(audioOutput?.voice).toBe('marin')

    acknowledgeSessionUpdate(socket)
    await expect(update).resolves.toBeUndefined()
  })

  it('omits unchanged speed from live updates during an active response', async () => {
    const { client, sockets } = createClient()
    client.connect()
    const socket = firstSocket(sockets)
    socket.open()
    socket.message(JSON.stringify({ type: 'session.created', session: {} }))
    acknowledgeSessionUpdate(socket)
    socket.message(JSON.stringify({ type: 'response.created', response: { id: 'resp-1' } }))

    useSettingsStore().session.instructions = 'Apply this during the response.'
    const update = client.updateSession()
    const output = (
      payload(socket.sent.at(-1)).session?.audio as { output?: { speed?: number } } | undefined
    )?.output
    expect(output?.speed).toBeUndefined()

    acknowledgeSessionUpdate(socket)
    await expect(update).resolves.toBeUndefined()
  })

  it('defers changed speed until the active response completes', async () => {
    const { client, sockets } = createClient()
    client.connect()
    const socket = firstSocket(sockets)
    socket.open()
    socket.message(JSON.stringify({ type: 'session.created', session: {} }))
    acknowledgeSessionUpdate(socket)
    client.createResponse()
    expect(useConnectionStore().responseInProgress).toBe(true)
    expect(payload(socket.sent.at(-1)).event_id).toMatch(/^response-create-/)

    useSettingsStore().session.audio.speed = 1.2
    const sentBeforeUpdate = socket.sent.length
    const update = client.updateSession()
    expect(socket.sent).toHaveLength(sentBeforeUpdate)

    socket.message(JSON.stringify({ type: 'response.done', response: { id: 'resp-1' } }))
    const output = (
      payload(socket.sent.at(-1)).session?.audio as { output?: { speed?: number } } | undefined
    )?.output
    expect(output?.speed).toBeCloseTo(1.2)

    acknowledgeSessionUpdate(socket)
    await expect(update).resolves.toBeUndefined()
  })

  it('clears a rejected response and resumes a deferred speed update', async () => {
    const { client, sockets } = createClient()
    client.connect()
    const socket = firstSocket(sockets)
    socket.open()
    socket.message(JSON.stringify({ type: 'session.created', session: {} }))
    acknowledgeSessionUpdate(socket)

    client.createResponse()
    const responseEventId = payload(socket.sent.at(-1)).event_id
    useSettingsStore().session.audio.speed = 1.2
    const update = client.updateSession()
    socket.message(
      JSON.stringify({
        type: 'error',
        error: { message: 'Response rejected', event_id: responseEventId },
      }),
    )

    expect(useConnectionStore().responseInProgress).toBe(false)
    expect(useConnectionStore().status).toBe('connected')
    expect(socket.readyState).toBe(1)
    const output = (
      payload(socket.sent.at(-1)).session?.audio as { output?: { speed?: number } } | undefined
    )?.output
    expect(output?.speed).toBeCloseTo(1.2)

    acknowledgeSessionUpdate(socket)
    await expect(update).resolves.toBeUndefined()
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
    socket.message(JSON.stringify({ type: 'session.created', session: {} }))
    acknowledgeSessionUpdate(socket)

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
    expect(responseCreate?.response).toEqual({})
  })

  it('defers the tool-result response.create until the active response completes', () => {
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
    socket.message(JSON.stringify({ type: 'session.created', session: {} }))
    acknowledgeSessionUpdate(socket)

    // A response is already streaming when the function call arrives.
    socket.message(JSON.stringify({ type: 'response.created', response: { id: 'resp-1' } }))
    socket.message(
      JSON.stringify({
        type: 'response.function_call_arguments.done',
        call_id: 'call-1',
        name: 'lookup_order',
        arguments: '{"orderId":"42"}',
      }),
    )

    const typesBeforeDone = socket.sent.map((entry) => payload(entry).type)
    expect(typesBeforeDone).toContain('conversation.item.create')
    // Must NOT open a new response while one is still active — that would fail
    // server-side with conversation_already_has_active_response.
    expect(typesBeforeDone.filter((type) => type === 'response.create')).toHaveLength(0)

    // Once the active response ends, the deferred follow-up turn is flushed exactly once.
    socket.message(JSON.stringify({ type: 'response.done', response: { id: 'resp-1' } }))
    const responseCreates = socket.sent
      .map((entry) => payload(entry))
      .filter((entry) => entry.type === 'response.create')
    expect(responseCreates).toHaveLength(1)
    expect(responseCreates[0]?.response).toEqual({})
  })

  it('continues a tool-result turn after a recoverable session update failure', async () => {
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
    socket.message(JSON.stringify({ type: 'session.created', session: {} }))
    acknowledgeSessionUpdate(socket)
    socket.message(JSON.stringify({ type: 'response.created', response: { id: 'resp-1' } }))
    socket.message(
      JSON.stringify({
        type: 'response.function_call_arguments.done',
        call_id: 'call-1',
        name: 'lookup_order',
        arguments: '{"orderId":"42"}',
      }),
    )

    useSettingsStore().session.instructions = 'This update will be rejected.'
    const update = client.updateSession()
    const updateEventId = payload(socket.sent.at(-1)).event_id
    const rejected = expect(update).rejects.toThrow('Invalid live setting')
    socket.message(JSON.stringify({ type: 'response.done', response: { id: 'resp-1' } }))
    socket.message(
      JSON.stringify({
        type: 'error',
        error: { message: 'Invalid live setting', event_id: updateEventId },
      }),
    )

    await rejected
    expect(payload(socket.sent.at(-1)).type).toBe('response.create')
    expect(useConnectionStore().responseInProgress).toBe(true)
    expect(useConnectionStore().status).toBe('connected')

    const firstResponseEventId = payload(socket.sent.at(-1)).event_id
    socket.message(
      JSON.stringify({
        type: 'error',
        error: { message: 'Transient response failure', event_id: firstResponseEventId },
      }),
    )
    const retryResponseEventId = payload(socket.sent.at(-1)).event_id
    expect(retryResponseEventId).toMatch(/^response-create-/)
    expect(retryResponseEventId).not.toBe(firstResponseEventId)

    socket.message(
      JSON.stringify({
        type: 'error',
        error: { message: 'Persistent response failure', event_id: retryResponseEventId },
      }),
    )
    const sentBeforeManualResponse = socket.sent.length
    client.createResponse()
    expect(socket.sent).toHaveLength(sentBeforeManualResponse + 1)
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
    socket.message(JSON.stringify({ type: 'session.created', session: {} }))
    acknowledgeSessionUpdate(socket)

    socket.message(JSON.stringify({ type: 'response.audio.delta', delta: 'base64-audio' }))

    expect(enqueue).toHaveBeenCalledWith('base64-audio')
  })

  it('rejects a matching session update error without closing the socket', async () => {
    const { client, sockets } = createClient()
    client.connect()
    const socket = firstSocket(sockets)
    socket.open()
    socket.message(JSON.stringify({ type: 'session.created', session: {} }))
    acknowledgeSessionUpdate(socket)

    const update = client.updateSession()
    const updateEventId = payload(socket.sent.at(-1)).event_id
    expect(updateEventId).toMatch(/^session-update-/)

    socket.message(
      JSON.stringify({
        type: 'error',
        error: { message: 'boom', event_id: updateEventId },
      }),
    )

    await expect(update).rejects.toThrow('boom')
    expect(useConnectionStore().errorMessage).toBe('boom')
    expect(useConnectionStore().status).toBe('connected')
    expect(socket.readyState).toBe(1)

    const retry = client.updateSession()
    acknowledgeSessionUpdate(socket)
    await expect(retry).resolves.toBeUndefined()
  })

  it('keeps a session update pending when a recoverable error belongs to another event', async () => {
    const { client, sockets } = createClient()
    client.connect()
    const socket = firstSocket(sockets)
    socket.open()
    socket.message(JSON.stringify({ type: 'session.created', session: {} }))
    acknowledgeSessionUpdate(socket)

    let acknowledged = false
    const update = client.updateSession().then(() => {
      acknowledged = true
    })
    socket.message(
      JSON.stringify({
        type: 'error',
        error: { message: 'Bad audio chunk', event_id: 'audio-append-1' },
      }),
    )
    await Promise.resolve()

    expect(acknowledged).toBe(false)
    expect(useConnectionStore().status).toBe('connected')
    expect(useConnectionStore().errorMessage).toBe('Bad audio chunk')
    expect(socket.readyState).toBe(1)

    acknowledgeSessionUpdate(socket)
    await update
    expect(acknowledged).toBe(true)
  })
})
