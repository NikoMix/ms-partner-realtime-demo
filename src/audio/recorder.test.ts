import { afterEach, describe, expect, it, vi } from 'vitest'

import { MicRecorder } from './recorder'

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
} {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function installPendingCaptureHarness(options: {
  addModule?: () => Promise<void>
  resume?: () => Promise<void>
}) {
  const stopTrack = vi.fn()
  const stream = {
    getTracks: () => [{ stop: stopTrack }],
  } as unknown as MediaStream
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(() => Promise.resolve(stream)) },
  })

  const sourceNode = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  }
  class FakeAudioContext {
    readonly audioWorklet = {
      addModule: vi.fn(() => options.addModule?.() ?? Promise.resolve()),
    }
    readonly close = vi.fn(() => {
      this.state = 'closed'
      return Promise.resolve()
    })
    readonly createMediaStreamSource = vi.fn(() => sourceNode)
    readonly resume = vi.fn(async () => {
      await options.resume?.()
      this.state = 'running'
    })
    state: AudioContextState = 'suspended'

    constructor(readonly contextOptions: AudioContextOptions) {
      contexts.push(this)
    }
  }
  const contexts: FakeAudioContext[] = []

  class FakeAudioWorkletNode {
    readonly disconnect = vi.fn()
    readonly port = {
      onmessage: null as
        ((event: MessageEvent<ArrayBuffer | { type: 'flush-complete' }>) => void) | null,
      postMessage: vi.fn(),
    }

    constructor() {
      worklets.push(this)
    }
  }
  const worklets: FakeAudioWorkletNode[] = []

  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode)
  return { contexts, sourceNode, stopTrack, worklets }
}

afterEach(() => {
  vi.unstubAllGlobals()
  if (originalMediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
  } else {
    Reflect.deleteProperty(navigator, 'mediaDevices')
  }
})

describe('MicRecorder', () => {
  it('starts G.711 capture at 8 kHz and releases all resources on stop', async () => {
    const stopTrack = vi.fn()
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream
    const getUserMedia = vi.fn(() => Promise.resolve(stream))
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })

    const sourceNode = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    }
    const createdContexts: FakeAudioContext[] = []
    class FakeAudioContext {
      readonly audioWorklet = { addModule: vi.fn(() => Promise.resolve()) }
      readonly close = vi.fn(() => {
        this.state = 'closed'
        return Promise.resolve()
      })
      readonly createMediaStreamSource = vi.fn(() => sourceNode)
      readonly resume = vi.fn(() => {
        this.state = 'running'
        return Promise.resolve()
      })
      state: AudioContextState = 'suspended'

      constructor(readonly options: AudioContextOptions) {
        createdContexts.push(this)
      }
    }

    const createdWorklets: FakeAudioWorkletNode[] = []
    class FakeAudioWorkletNode {
      readonly disconnect = vi.fn()
      readonly port = {
        onmessage: null as
          ((event: MessageEvent<ArrayBuffer | { type: 'flush-complete' }>) => void) | null,
        postMessage: vi.fn(),
      }

      constructor() {
        createdWorklets.push(this)
        this.port.postMessage.mockImplementation(() => {
          this.port.onmessage?.(
            new MessageEvent<ArrayBuffer>('message', {
              data: new Uint8Array([0x7f]).buffer,
            }),
          )
          this.port.onmessage?.(
            new MessageEvent('message', { data: { type: 'flush-complete' as const } }),
          )
        })
      }
    }

    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode)

    const onChunk = vi.fn()
    const stateChanges: string[] = []
    const recorder = new MicRecorder()
    await recorder.start({
      inputFormat: 'g711_ulaw',
      onChunk,
      onStateChange: (state) => stateChanges.push(state),
    })

    const context = createdContexts[0]
    const worklet = createdWorklets[0]
    if (!context || !worklet) {
      throw new Error('Capture resources were not created')
    }
    expect(context.options.sampleRate).toBe(8_000)
    expect(sourceNode.connect).toHaveBeenCalledWith(worklet)
    expect(recorder.state).toBe('recording')

    worklet.port.onmessage?.(
      new MessageEvent<ArrayBuffer>('message', { data: new Uint8Array([0xd5]).buffer }),
    )
    expect(onChunk).toHaveBeenCalledWith('1Q==')

    await recorder.stop()

    expect(worklet.port.postMessage).toHaveBeenCalledWith('stop')
    expect(onChunk).toHaveBeenLastCalledWith('fw==')
    expect(onChunk).toHaveBeenCalledTimes(2)
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(context.close).toHaveBeenCalledOnce()
    expect(stateChanges).toEqual(['recording', 'idle'])
  })

  it('releases a microphone stream that arrives after capture was stopped', async () => {
    vi.stubGlobal('AudioContext', class FakeAudioContext {})
    const stopTrack = vi.fn()
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream
    let resolveStream: (stream: MediaStream) => void = (_stream) => undefined
    const streamPromise = new Promise<MediaStream>((resolve) => {
      resolveStream = resolve
    })
    const getUserMedia = vi.fn(() => streamPromise)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })

    const stateChanges: string[] = []
    const recorder = new MicRecorder()
    const starting = recorder.start({
      inputFormat: 'g711_alaw',
      onChunk: vi.fn(),
      onStateChange: (state) => stateChanges.push(state),
    })

    expect(getUserMedia).toHaveBeenCalledOnce()
    const stopping = recorder.stop()
    resolveStream(stream)
    await Promise.all([starting, stopping])

    expect(stopTrack).toHaveBeenCalledOnce()
    expect(recorder.state).toBe('idle')
    expect(stateChanges).not.toContain('recording')
  })

  it('releases owned resources while the worklet module is still loading', async () => {
    const moduleLoad = deferred<void>()
    const { contexts, stopTrack } = installPendingCaptureHarness({
      addModule: () => moduleLoad.promise,
    })
    const recorder = new MicRecorder()

    const starting = recorder.start({
      inputFormat: 'g711_ulaw',
      onChunk: vi.fn(),
    })
    await vi.waitFor(() => {
      expect(contexts[0]?.audioWorklet.addModule).toHaveBeenCalled()
    })

    await recorder.stop()

    expect(stopTrack).toHaveBeenCalledOnce()
    expect(contexts[0]?.close).toHaveBeenCalledOnce()

    moduleLoad.resolve()
    await starting
    expect(recorder.state).toBe('idle')
  })

  it('releases connected resources while the audio context is still resuming', async () => {
    const resume = deferred<void>()
    const { contexts, sourceNode, stopTrack, worklets } = installPendingCaptureHarness({
      resume: () => resume.promise,
    })
    const recorder = new MicRecorder()

    const starting = recorder.start({
      inputFormat: 'g711_alaw',
      onChunk: vi.fn(),
    })
    await vi.waitFor(() => {
      expect(contexts[0]?.resume).toHaveBeenCalled()
    })

    await recorder.stop()

    expect(stopTrack).toHaveBeenCalledOnce()
    expect(sourceNode.disconnect).toHaveBeenCalledOnce()
    expect(worklets[0]?.disconnect).toHaveBeenCalledOnce()
    expect(contexts[0]?.close).toHaveBeenCalledOnce()

    resume.resolve()
    await starting
    expect(recorder.state).toBe('idle')
  })
})
