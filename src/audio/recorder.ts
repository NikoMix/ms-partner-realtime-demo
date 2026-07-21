import { uint8ToBase64 } from './pcm'
import {
  G711_SAMPLE_RATE_HZ,
  INPUT_AUDIO_SAMPLE_RATES_HZ,
  PCM16_SAMPLE_RATE_HZ,
  type InputAudioFormat,
} from '@/types/audio'

// The worklet ships from `public/` as plain JS so it loads with a JavaScript MIME type
// and honours the configured base path (root or the GitHub Pages sub-path).
const RECORDER_WORKLET_URL = `${import.meta.env.BASE_URL}pcm-recorder.worklet.js`
const FLUSH_TIMEOUT_MS = 500

type MicRecorderState = 'idle' | 'recording' | 'error'
type RecorderWorkletMessage = ArrayBuffer | { readonly type: 'flush-complete' }

export interface MicRecorderOptions {
  deviceId?: string
  inputFormat: InputAudioFormat
  onChunk: (base64Audio: string) => boolean | void
  onEncodedChunk?: (encodedAudio: Uint8Array<ArrayBuffer>) => void
  onEncodedChunkError?: (err: Error) => void
  onError?: (err: Error) => void
  onStateChange?: (state: MicRecorderState) => void
}

export class MicRecorder {
  private audioContext: AudioContext | null = null

  private flushComplete: (() => void) | null = null

  private options: MicRecorderOptions | null = null

  private operationGeneration = 0

  private pendingResources: CaptureResources | null = null

  private sourceNode: MediaStreamAudioSourceNode | null = null

  private stateValue: MicRecorderState = 'idle'

  private stopPromise: Promise<void> | null = null

  private stream: MediaStream | null = null

  private workletNode: AudioWorkletNode | null = null

  get state(): MicRecorderState {
    return this.stateValue
  }

  async start(options: MicRecorderOptions): Promise<void> {
    if (this.stateValue === 'recording' || this.pendingResources || this.stopPromise) {
      await this.stop()
    }

    const operationGeneration = ++this.operationGeneration
    this.options = options
    const resources: CaptureResources = {
      audioContext: null,
      sourceNode: null,
      stream: null,
      workletNode: null,
    }
    this.pendingResources = resources

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone capture is unavailable in this browser')
      }

      if (typeof AudioContext === 'undefined') {
        throw new Error('Web Audio is unavailable in this browser')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: options.deviceId ? { deviceId: { exact: options.deviceId } } : true,
      })
      resources.stream = stream
      if (operationGeneration !== this.operationGeneration) {
        this.clearPendingResources(resources)
        await releaseCaptureResources(resources)
        return
      }

      const targetSampleRate = INPUT_AUDIO_SAMPLE_RATES_HZ[options.inputFormat]
      const audioContext = createCaptureContext(targetSampleRate)
      resources.audioContext = audioContext
      await audioContext.audioWorklet.addModule(RECORDER_WORKLET_URL)
      if (operationGeneration !== this.operationGeneration) {
        this.clearPendingResources(resources)
        await releaseCaptureResources(resources)
        return
      }

      const sourceNode = audioContext.createMediaStreamSource(stream)
      resources.sourceNode = sourceNode
      const workletNode = new AudioWorkletNode(audioContext, 'pcm-recorder', {
        channelCount: 1,
        channelCountMode: 'explicit',
        numberOfInputs: 1,
        numberOfOutputs: 0,
        processorOptions: { inputFormat: options.inputFormat },
      })
      resources.workletNode = workletNode

      workletNode.port.onmessage = (event: MessageEvent<RecorderWorkletMessage>) => {
        if (operationGeneration !== this.operationGeneration) {
          return
        }
        if (isFlushCompleteMessage(event.data)) {
          this.flushComplete?.()
          return
        }
        this.handleAudioChunk(event.data)
      }

      sourceNode.connect(workletNode)
      if (audioContext.state === 'suspended') {
        await audioContext.resume()
      }
      if (operationGeneration !== this.operationGeneration) {
        this.clearPendingResources(resources)
        await releaseCaptureResources(resources)
        return
      }

      this.clearPendingResources(resources)
      this.audioContext = audioContext
      this.sourceNode = sourceNode
      this.stream = stream
      this.workletNode = workletNode
      resources.audioContext = null
      resources.sourceNode = null
      resources.stream = null
      resources.workletNode = null
      this.setState('recording')
    } catch (error) {
      this.clearPendingResources(resources)
      await releaseCaptureResources(resources)
      if (operationGeneration !== this.operationGeneration) {
        return
      }
      this.reportError(toError(error))
      this.setState('error')
    }
  }

  async stop(): Promise<void> {
    if (this.stopPromise) {
      await this.stopPromise
      return
    }

    const stopPromise = this.performStop()
    this.stopPromise = stopPromise
    try {
      await stopPromise
    } finally {
      if (this.stopPromise === stopPromise) {
        this.stopPromise = null
      }
    }
  }

  private async performStop(): Promise<void> {
    const activeResources = this.takeActiveResources()
    if (!activeResources.workletNode) {
      // Pending startup operations must become stale before their resources are released.
      this.operationGeneration += 1
    }

    const pendingResources = this.pendingResources
    this.pendingResources = null
    const pendingCleanup = pendingResources
      ? releaseCaptureResources(pendingResources, (error) => this.reportError(error))
      : Promise.resolve()

    if (activeResources.workletNode) {
      // Keep the current generation valid until the final chunk and its ordered
      // acknowledgement arrive, then reject any late messages from this worklet.
      await this.flushWorklet(activeResources.workletNode)
      this.operationGeneration += 1
    }

    await Promise.all([
      pendingCleanup,
      releaseCaptureResources(activeResources, (error) => this.reportError(error)),
    ])
    this.setState('idle')
  }

  private handleAudioChunk(data: ArrayBuffer): void {
    try {
      const encodedAudio = new Uint8Array(data)
      const base64Audio = uint8ToBase64(encodedAudio)
      // The realtime callback always runs first. Only bytes accepted by that path
      // are eligible for archival, and archival failures remain isolated.
      const sent = this.options?.onChunk(base64Audio)
      if (sent === false) {
        return
      }
      try {
        this.options?.onEncodedChunk?.(encodedAudio)
      } catch (error) {
        this.options?.onEncodedChunkError?.(toError(error))
      }
    } catch (error) {
      this.reportError(toError(error))
      this.setState('error')
    }
  }

  private flushWorklet(workletNode: AudioWorkletNode): Promise<void> {
    return new Promise((resolve) => {
      let settled = false
      let timeout: ReturnType<typeof setTimeout> | null = null
      const complete = () => {
        if (settled) {
          return
        }
        settled = true
        if (timeout) {
          clearTimeout(timeout)
        }
        if (this.flushComplete === complete) {
          this.flushComplete = null
        }
        resolve()
      }

      this.flushComplete = complete
      timeout = globalThis.setTimeout(() => {
        this.reportError(new Error('Recorder worklet did not acknowledge its final audio flush.'))
        complete()
      }, FLUSH_TIMEOUT_MS)

      try {
        workletNode.port.postMessage('stop')
      } catch (error) {
        this.reportError(toError(error))
        complete()
      }
    })
  }

  private clearPendingResources(resources: CaptureResources): void {
    if (this.pendingResources === resources) {
      this.pendingResources = null
    }
  }

  private takeActiveResources(): CaptureResources {
    const resources: CaptureResources = {
      audioContext: this.audioContext,
      sourceNode: this.sourceNode,
      stream: this.stream,
      workletNode: this.workletNode,
    }
    this.stream = null
    this.sourceNode = null
    this.workletNode = null
    this.audioContext = null
    return resources
  }

  private reportError(error: Error): void {
    this.options?.onError?.(error)
  }

  private setState(state: MicRecorderState): void {
    if (this.stateValue === state) {
      return
    }

    this.stateValue = state
    this.options?.onStateChange?.(state)
  }
}

function createCaptureContext(targetSampleRate: number): AudioContext {
  try {
    return new AudioContext({ sampleRate: targetSampleRate })
  } catch (error) {
    if (targetSampleRate !== G711_SAMPLE_RATE_HZ || !isNotSupportedError(error)) {
      throw error
    }

    // The worklet performs allocation-free downsampling when an older browser
    // cannot create a native 8 kHz context.
    return new AudioContext({ sampleRate: PCM16_SAMPLE_RATE_HZ })
  }
}

function isNotSupportedError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'NotSupportedError'
  )
}

interface CaptureResources {
  audioContext: AudioContext | null
  sourceNode: MediaStreamAudioSourceNode | null
  stream: MediaStream | null
  workletNode: AudioWorkletNode | null
}

async function releaseCaptureResources(
  resources: CaptureResources,
  onError?: (error: Error) => void,
): Promise<void> {
  const { audioContext, sourceNode, stream, workletNode } = resources
  resources.audioContext = null
  resources.sourceNode = null
  resources.stream = null
  resources.workletNode = null

  disconnectNode(sourceNode, onError)
  disconnectNode(workletNode, onError)

  if (stream) {
    for (const track of stream.getTracks()) {
      track.stop()
    }
  }

  if (audioContext && audioContext.state !== 'closed') {
    try {
      await audioContext.close()
    } catch (error) {
      onError?.(toError(error))
    }
  }
}

function disconnectNode(node: AudioNode | null, onError?: (error: Error) => void): void {
  if (!node) {
    return
  }

  try {
    node.disconnect()
  } catch (error) {
    onError?.(toError(error))
  }
}

function isFlushCompleteMessage(value: RecorderWorkletMessage): value is {
  readonly type: 'flush-complete'
} {
  return !(value instanceof ArrayBuffer) && value.type === 'flush-complete'
}

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error))
