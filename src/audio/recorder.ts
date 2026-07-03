import { uint8ToBase64 } from './pcm'

const REALTIME_SAMPLE_RATE_HZ = 24000

// The worklet ships from `public/` as plain JS so it loads with a JavaScript MIME type
// and honours the configured base path (root or the GitHub Pages sub-path).
const PCM_WORKLET_URL = `${import.meta.env.BASE_URL}pcm-recorder.worklet.js`

type MicRecorderState = 'idle' | 'recording' | 'error'

export interface MicRecorderOptions {
  deviceId?: string
  onChunk: (base64Pcm16: string) => void
  onError?: (err: Error) => void
  onStateChange?: (state: MicRecorderState) => void
}

export class MicRecorder {
  private audioContext: AudioContext | null = null

  private options: MicRecorderOptions | null = null

  private sourceNode: MediaStreamAudioSourceNode | null = null

  private stateValue: MicRecorderState = 'idle'

  private stream: MediaStream | null = null

  private workletNode: AudioWorkletNode | null = null

  get state(): MicRecorderState {
    return this.stateValue
  }

  async start(options: MicRecorderOptions): Promise<void> {
    if (this.stateValue === 'recording') {
      await this.stop()
    }

    this.options = options

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
      const audioContext = new AudioContext({ sampleRate: REALTIME_SAMPLE_RATE_HZ })
      await audioContext.audioWorklet.addModule(PCM_WORKLET_URL)

      const sourceNode = audioContext.createMediaStreamSource(stream)
      const workletNode = new AudioWorkletNode(audioContext, 'pcm-recorder')

      workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        this.handlePcmChunk(event)
      }

      sourceNode.connect(workletNode)

      this.stream = stream
      this.audioContext = audioContext
      this.sourceNode = sourceNode
      this.workletNode = workletNode
      this.setState('recording')
    } catch (error) {
      await this.releaseResources(false)
      this.reportError(toError(error))
      this.setState('error')
    }
  }

  async stop(): Promise<void> {
    if (this.workletNode) {
      this.workletNode.port.postMessage('stop')
      await delay(0)
    }

    await this.releaseResources(true)
    this.setState('idle')
  }

  private handlePcmChunk(event: MessageEvent<ArrayBuffer>): void {
    try {
      if (!(event.data instanceof ArrayBuffer)) {
        return
      }

      const base64Pcm16 = uint8ToBase64(new Uint8Array(event.data))
      this.options?.onChunk(base64Pcm16)
    } catch (error) {
      this.reportError(toError(error))
      this.setState('error')
    }
  }

  private async releaseResources(reportErrors: boolean): Promise<void> {
    this.disconnectNode(this.sourceNode, reportErrors)
    this.disconnectNode(this.workletNode, reportErrors)

    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop()
      }
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        await this.audioContext.close()
      } catch (error) {
        if (reportErrors) {
          this.reportError(toError(error))
        }
      }
    }

    this.stream = null
    this.sourceNode = null
    this.workletNode = null
    this.audioContext = null
  }

  private disconnectNode(node: AudioNode | null, reportErrors: boolean): void {
    if (!node) {
      return
    }

    try {
      node.disconnect()
    } catch (error) {
      if (reportErrors) {
        this.reportError(toError(error))
      }
    }
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

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    globalThis.setTimeout(resolve, milliseconds)
  })

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error))
