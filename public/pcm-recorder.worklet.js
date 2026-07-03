/*
 * PCM16 recorder AudioWorklet.
 *
 * This is intentionally authored as plain JavaScript and shipped from `public/`
 * rather than as a bundled TypeScript module. AudioWorklet modules execute in the
 * dedicated `AudioWorkletGlobalScope`, and `audioWorklet.addModule()` requires a URL
 * that resolves to a script served with a JavaScript MIME type. Vite's asset pipeline
 * inlines `new URL('./x.ts', import.meta.url)` references as `data:video/mp2t` URLs
 * containing raw, uncompiled TypeScript, which browsers refuse to load as a worklet.
 * Keeping the worklet here guarantees a correct MIME type and honours the app's
 * configured base path (GitHub Pages sub-path or root) via `import.meta.env.BASE_URL`.
 *
 * It captures mono Float32 audio at the AudioContext sample rate (24 kHz), converts it
 * to little-endian PCM16, and posts ~100 ms chunks back to the main thread as transferable
 * ArrayBuffers. On receiving the string 'stop' it flushes any buffered samples and halts.
 */

const CHUNK_DURATION_SECONDS = 0.1

class PcmRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.pendingSamples = new Float32Array(0)
    this.targetFrameCount = Math.max(1, Math.round(sampleRate * CHUNK_DURATION_SECONDS))
    this.stopping = false

    this.port.onmessage = (event) => {
      if (event.data === 'stop') {
        this.stopping = true
        this.flushPendingSamples()
      }
    }
  }

  process(inputs) {
    const inputChannel = inputs[0] && inputs[0][0]

    if (inputChannel && inputChannel.length > 0) {
      this.appendSamples(inputChannel)
      this.emitFullChunks()
    }

    if (this.stopping) {
      this.flushPendingSamples()
      return false
    }

    return true
  }

  appendSamples(samples) {
    const combined = new Float32Array(this.pendingSamples.length + samples.length)
    combined.set(this.pendingSamples)
    combined.set(samples, this.pendingSamples.length)
    this.pendingSamples = combined
  }

  emitFullChunks() {
    while (this.pendingSamples.length >= this.targetFrameCount) {
      const chunk = this.pendingSamples.slice(0, this.targetFrameCount)
      this.postPcm16Chunk(chunk)
      this.pendingSamples = this.pendingSamples.slice(this.targetFrameCount)
    }
  }

  flushPendingSamples() {
    if (this.pendingSamples.length === 0) {
      return
    }

    this.postPcm16Chunk(this.pendingSamples)
    this.pendingSamples = new Float32Array(0)
  }

  postPcm16Chunk(samples) {
    const bytes = new Uint8Array(samples.length * 2)

    for (let index = 0; index < samples.length; index += 1) {
      const rawSample = samples[index] ?? 0
      const sample = Number.isNaN(rawSample) ? 0 : Math.max(-1, Math.min(1, rawSample))
      const pcmSample = Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff)
      const byteIndex = index * 2
      bytes[byteIndex] = pcmSample & 0xff
      bytes[byteIndex + 1] = (pcmSample >> 8) & 0xff
    }

    this.port.postMessage(bytes.buffer, [bytes.buffer])
  }
}

registerProcessor('pcm-recorder', PcmRecorderProcessor)
