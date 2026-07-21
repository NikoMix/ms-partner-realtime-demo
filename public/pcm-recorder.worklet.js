/*
 * Mono PCM16 / G.711 recorder AudioWorklet.
 *
 * This stays as plain JavaScript in `public/` because AudioWorklet modules need a
 * directly served JavaScript URL. Samples are encoded into a preallocated 100 ms
 * buffer and transferred to the main thread without per-render-quantum copies.
 * Browsers normally resample natively through the AudioContext. The streaming box
 * resampler is only used when an older browser rejects a native 8 kHz context.
 */

const CHUNK_DURATION_SECONDS = 0.1
const PCM16_SAMPLE_RATE_HZ = 24_000
const G711_SAMPLE_RATE_HZ = 8_000
const G711_BIAS = 0x84
const G711_CLIP = 32635
const ALAW_SEGMENT_ENDS = [0x1f, 0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff]

class PcmRecorderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()

    const inputFormat = options.processorOptions && options.processorOptions.inputFormat
    const format = getFormatConfiguration(inputFormat)

    this.bytesPerSample = format.bytesPerSample
    this.g711Encoder = format.encoder
    this.targetSampleRate = format.sampleRate
    this.targetFrameCount = Math.max(1, Math.round(this.targetSampleRate * CHUNK_DURATION_SECONDS))
    this.chunkBytes = new Uint8Array(this.targetFrameCount * this.bytesPerSample)
    this.chunkFrameOffset = 0
    this.resampleRatio = sampleRate / this.targetSampleRate
    this.resampleAccumulator = 0
    this.resampleWeight = 0
    this.stopping = false

    this.port.onmessage = (event) => {
      if (event.data === 'stop') {
        this.stopping = true
        this.flush()
        // MessagePort preserves ordering, so the main thread receives the final
        // transferred chunk before this acknowledgement.
        this.port.postMessage({ type: 'flush-complete' })
      }
    }
  }

  process(inputs) {
    if (this.stopping) {
      return false
    }

    const inputChannel = inputs[0] && inputs[0][0]
    if (inputChannel && inputChannel.length > 0) {
      this.encodeInput(inputChannel)
    }

    return true
  }

  encodeInput(samples) {
    if (this.resampleRatio === 1) {
      for (let index = 0; index < samples.length; index += 1) {
        this.writeSample(samples[index] ?? 0)
      }
      return
    }

    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index] ?? 0
      let remainingWeight = 1

      while (remainingWeight > 0) {
        const neededWeight = this.resampleRatio - this.resampleWeight
        const consumedWeight = Math.min(remainingWeight, neededWeight)
        this.resampleAccumulator += sample * consumedWeight
        this.resampleWeight += consumedWeight
        remainingWeight -= consumedWeight

        if (this.resampleWeight >= this.resampleRatio - Number.EPSILON) {
          this.writeSample(this.resampleAccumulator / this.resampleWeight)
          this.resampleAccumulator = 0
          this.resampleWeight = 0
        }
      }
    }
  }

  writeSample(rawSample) {
    const pcmSample = floatToPcm16(rawSample)
    const byteOffset = this.chunkFrameOffset * this.bytesPerSample

    if (this.g711Encoder) {
      this.chunkBytes[byteOffset] = this.g711Encoder(pcmSample)
    } else {
      this.chunkBytes[byteOffset] = pcmSample & 0xff
      this.chunkBytes[byteOffset + 1] = (pcmSample >> 8) & 0xff
    }

    this.chunkFrameOffset += 1
    if (this.chunkFrameOffset === this.targetFrameCount) {
      this.postChunk()
    }
  }

  flush() {
    if (this.resampleWeight > 0) {
      this.writeSample(this.resampleAccumulator / this.resampleWeight)
      this.resampleAccumulator = 0
      this.resampleWeight = 0
    }

    if (this.chunkFrameOffset > 0) {
      this.postChunk()
    }
  }

  postChunk() {
    const byteLength = this.chunkFrameOffset * this.bytesPerSample
    const bytes =
      byteLength === this.chunkBytes.length ? this.chunkBytes : this.chunkBytes.slice(0, byteLength)

    this.port.postMessage(bytes.buffer, [bytes.buffer])
    this.chunkBytes = new Uint8Array(this.targetFrameCount * this.bytesPerSample)
    this.chunkFrameOffset = 0
  }
}

function getFormatConfiguration(inputFormat) {
  switch (inputFormat) {
    case 'pcm16':
      return { bytesPerSample: 2, encoder: null, sampleRate: PCM16_SAMPLE_RATE_HZ }
    case 'g711_ulaw':
      return { bytesPerSample: 1, encoder: encodeMuLaw, sampleRate: G711_SAMPLE_RATE_HZ }
    case 'g711_alaw':
      return { bytesPerSample: 1, encoder: encodeALaw, sampleRate: G711_SAMPLE_RATE_HZ }
    default:
      throw new Error(`Unsupported microphone input format: ${String(inputFormat)}`)
  }
}

function floatToPcm16(rawSample) {
  const sample = Number.isNaN(rawSample) ? 0 : Math.max(-1, Math.min(1, rawSample))
  return Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff)
}

function encodeMuLaw(pcmSample) {
  const sign = pcmSample < 0 ? 0x80 : 0
  const magnitude = Math.min(sign ? -pcmSample : pcmSample, G711_CLIP) + G711_BIAS
  let exponent = 7

  for (
    let exponentMask = 0x4000;
    exponent > 0 && (magnitude & exponentMask) === 0;
    exponent -= 1, exponentMask >>= 1
  ) {
    // The loop locates the logarithmic segment.
  }

  const mantissa = (magnitude >> (exponent + 3)) & 0x0f
  return ~(sign | (exponent << 4) | mantissa) & 0xff
}

function encodeALaw(pcmSample) {
  let magnitude = pcmSample >> 3
  const mask = magnitude >= 0 ? 0xd5 : 0x55

  if (magnitude < 0) {
    magnitude = -magnitude - 1
  }

  let segment = 0
  while (segment < ALAW_SEGMENT_ENDS.length && magnitude > ALAW_SEGMENT_ENDS[segment]) {
    segment += 1
  }

  if (segment >= ALAW_SEGMENT_ENDS.length) {
    return 0x7f ^ mask
  }

  let encoded = segment << 4
  encoded |= segment < 2 ? (magnitude >> 1) & 0x0f : (magnitude >> segment) & 0x0f
  return encoded ^ mask
}

registerProcessor('pcm-recorder', PcmRecorderProcessor)
