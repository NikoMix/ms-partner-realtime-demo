import { pcm16Base64ToFloat32 } from './pcm'

const REALTIME_SAMPLE_RATE_HZ = 24000

type AudioContextWithSinkId = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>
}

type HtmlAudioElementWithSinkId = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>
}

export class Pcm16Player {
  private activeSources = new Set<AudioBufferSourceNode>()

  private audioContext: AudioContext | null = null

  private gainNode: GainNode | null = null

  private playheadTime = 0

  private sinkAudioElement: HTMLAudioElement | null = null

  private streamDestination: MediaStreamAudioDestinationNode | null = null

  private volume = 1

  get supportsSinkSelection(): boolean {
    return supportsAudioContextSinkSelection() || supportsHtmlMediaSinkSelection()
  }

  enqueue(base64Pcm16: string): void {
    if (!base64Pcm16) {
      return
    }

    try {
      const samples = pcm16Base64ToFloat32(base64Pcm16)

      if (samples.length === 0) {
        return
      }

      const audioContext = this.ensureAudioContext()
      const gainNode = this.ensureGainNode(audioContext)
      const audioBuffer = audioContext.createBuffer(1, samples.length, audioContext.sampleRate)
      audioBuffer.copyToChannel(samples, 0)

      const source = audioContext.createBufferSource()
      source.buffer = audioBuffer
      source.connect(gainNode)

      const startTime = Math.max(audioContext.currentTime, this.playheadTime)
      source.start(startTime)
      this.playheadTime = startTime + audioBuffer.duration
      this.activeSources.add(source)

      source.onended = () => {
        this.activeSources.delete(source)
        source.disconnect()
      }
    } catch {
      // Invalid base64 or unavailable audio APIs should not break the realtime stream.
    }
  }

  clear(): void {
    for (const source of this.activeSources) {
      try {
        source.stop()
      } catch {
        // Already-ended sources are harmless.
      }

      source.disconnect()
    }

    this.activeSources.clear()
    this.playheadTime = this.audioContext?.currentTime ?? 0
  }

  async setSinkId(deviceId: string): Promise<void> {
    if (!this.supportsSinkSelection || typeof AudioContext === 'undefined') {
      return
    }

    const audioContext = this.ensureAudioContext()

    if (supportsAudioContextSinkSelection()) {
      const sinkAudioContext = audioContext as AudioContextWithSinkId
      await sinkAudioContext.setSinkId?.(deviceId)
      this.connectGainToContextDestination(audioContext)
      return
    }

    if (supportsHtmlMediaSinkSelection()) {
      await this.connectGainToSinkAudioElement(audioContext, deviceId)
    }
  }

  setVolume(volume: number): void {
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0

    if (this.gainNode) {
      this.gainNode.gain.value = this.volume
    }
  }

  async resume(): Promise<void> {
    const audioContext = this.ensureAudioContext()

    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }
  }

  dispose(): void {
    this.clear()
    this.disconnectGain()
    this.disposeSinkAudioElement()

    if (this.audioContext && this.audioContext.state !== 'closed') {
      void this.audioContext.close().catch(() => undefined)
    }

    this.gainNode = null
    this.audioContext = null
    this.streamDestination = null
    this.playheadTime = 0
  }

  private ensureAudioContext(): AudioContext {
    if (this.audioContext) {
      return this.audioContext
    }

    if (typeof AudioContext === 'undefined') {
      throw new Error('Web Audio is unavailable in this browser')
    }

    const audioContext = new AudioContext({ sampleRate: REALTIME_SAMPLE_RATE_HZ })
    this.audioContext = audioContext
    this.playheadTime = audioContext.currentTime
    this.ensureGainNode(audioContext)

    return audioContext
  }

  private ensureGainNode(audioContext: AudioContext): GainNode {
    if (this.gainNode) {
      return this.gainNode
    }

    const gainNode = audioContext.createGain()
    gainNode.gain.value = this.volume
    gainNode.connect(audioContext.destination)
    this.gainNode = gainNode

    return gainNode
  }

  private connectGainToContextDestination(audioContext: AudioContext): void {
    const gainNode = this.ensureGainNode(audioContext)
    this.disconnectGain()
    this.disposeSinkAudioElement()
    this.streamDestination = null
    gainNode.connect(audioContext.destination)
  }

  private async connectGainToSinkAudioElement(
    audioContext: AudioContext,
    deviceId: string,
  ): Promise<void> {
    if (typeof document === 'undefined') {
      return
    }

    const gainNode = this.ensureGainNode(audioContext)
    const streamDestination = this.streamDestination ?? audioContext.createMediaStreamDestination()
    this.streamDestination = streamDestination
    this.disconnectGain()
    gainNode.connect(streamDestination)

    const audioElement = this.sinkAudioElement ?? document.createElement('audio')
    audioElement.autoplay = true
    audioElement.hidden = true
    audioElement.srcObject = streamDestination.stream
    this.sinkAudioElement = audioElement

    if (!audioElement.parentElement && document.body) {
      document.body.append(audioElement)
    }

    const sinkAudioElement = audioElement as HtmlAudioElementWithSinkId
    await sinkAudioElement.setSinkId?.(deviceId)
    await audioElement.play().catch(() => undefined)
  }

  private disconnectGain(): void {
    if (!this.gainNode) {
      return
    }

    this.gainNode.disconnect()
  }

  private disposeSinkAudioElement(): void {
    if (!this.sinkAudioElement) {
      return
    }

    this.sinkAudioElement.pause()
    this.sinkAudioElement.srcObject = null
    this.sinkAudioElement.remove()
    this.sinkAudioElement = null
  }
}

const supportsAudioContextSinkSelection = (): boolean =>
  typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype

const supportsHtmlMediaSinkSelection = (): boolean =>
  typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype
