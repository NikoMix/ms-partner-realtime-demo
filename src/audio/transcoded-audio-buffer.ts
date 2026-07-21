import { INPUT_AUDIO_SAMPLE_RATES_HZ, type InputAudioFormat } from '@/types/audio'

export const TRANSCODED_AUDIO_BUFFER_MAX_DURATION_SECONDS = 5 * 60

const WAV_HEADER_BYTES = 44
const PCM16_BYTES_PER_SAMPLE = 2

const INPUT_AUDIO_BYTES_PER_SAMPLE = {
  pcm16: PCM16_BYTES_PER_SAMPLE,
  g711_ulaw: 1,
  g711_alaw: 1,
} as const satisfies Record<InputAudioFormat, number>

const RAW_AUDIO_EXTENSIONS = {
  pcm16: 's16le',
  g711_ulaw: 'ulaw',
  g711_alaw: 'alaw',
} as const satisfies Record<InputAudioFormat, string>

export interface TranscodedAudioBufferInfo {
  readonly byteLength: number
  readonly durationSeconds: number
  readonly format: InputAudioFormat | null
  readonly sampleRate: number | null
  readonly startedAt: number | null
  readonly truncated: boolean
}

/**
 * Holds transferred recorder buffers without copying them on the realtime path.
 * Decoding and concatenation happen only when the user requests playback/download.
 */
export class TranscodedAudioBuffer {
  private byteLength = 0

  private chunks = new Map<number, Uint8Array<ArrayBuffer>>()

  private format: InputAudioFormat | null = null

  private maxByteLength = 0

  private nextChunkId = 0

  private startedAt: number | null = null

  private truncated = false

  constructor(private readonly maxDurationSeconds = TRANSCODED_AUDIO_BUFFER_MAX_DURATION_SECONDS) {
    if (!Number.isFinite(maxDurationSeconds) || maxDurationSeconds <= 0) {
      throw new RangeError('Audio buffer duration must be greater than zero.')
    }
  }

  get info(): TranscodedAudioBufferInfo {
    const format = this.format
    const sampleRate = format ? INPUT_AUDIO_SAMPLE_RATES_HZ[format] : null
    const bytesPerSecond =
      format && sampleRate ? sampleRate * INPUT_AUDIO_BYTES_PER_SAMPLE[format] : 0

    return {
      byteLength: this.byteLength,
      durationSeconds: bytesPerSecond > 0 ? this.byteLength / bytesPerSecond : 0,
      format,
      sampleRate,
      startedAt: this.startedAt,
      truncated: this.truncated,
    }
  }

  begin(format: InputAudioFormat, startedAt = Date.now()): void {
    this.chunks.clear()
    this.byteLength = 0
    this.format = format
    this.nextChunkId = 0
    this.startedAt = startedAt
    this.truncated = false
    this.maxByteLength = Math.max(
      1,
      Math.floor(
        INPUT_AUDIO_SAMPLE_RATES_HZ[format] *
          INPUT_AUDIO_BYTES_PER_SAMPLE[format] *
          this.maxDurationSeconds,
      ),
    )
  }

  append(bytes: Uint8Array<ArrayBuffer>): void {
    if (!this.format) {
      throw new Error('Start the transcoded audio buffer before appending audio.')
    }
    if (bytes.byteLength === 0) {
      return
    }

    this.chunks.set(this.nextChunkId, bytes)
    this.nextChunkId += 1
    this.byteLength += bytes.byteLength
    this.trimToLimit()
  }

  clear(): void {
    this.chunks.clear()
    this.byteLength = 0
    this.format = null
    this.maxByteLength = 0
    this.nextChunkId = 0
    this.startedAt = null
    this.truncated = false
  }

  createRawBytes(): Uint8Array<ArrayBuffer> {
    this.requireAudio()
    const output = new Uint8Array(this.byteLength)
    let offset = 0

    for (const chunk of this.chunks.values()) {
      output.set(chunk, offset)
      offset += chunk.byteLength
    }

    return output
  }

  createRawBlob(): Blob {
    return new Blob([this.createRawBytes()], { type: 'application/octet-stream' })
  }

  createPlayableWavBytes(): Uint8Array<ArrayBuffer> {
    const format = this.requireAudio()
    const sampleRate = INPUT_AUDIO_SAMPLE_RATES_HZ[format]
    const pcmDataLength =
      format === 'pcm16'
        ? this.byteLength - (this.byteLength % PCM16_BYTES_PER_SAMPLE)
        : this.byteLength * PCM16_BYTES_PER_SAMPLE
    const wav = new Uint8Array(WAV_HEADER_BYTES + pcmDataLength)
    const view = new DataView(wav.buffer)

    writeAscii(wav, 0, 'RIFF')
    view.setUint32(4, 36 + pcmDataLength, true)
    writeAscii(wav, 8, 'WAVE')
    writeAscii(wav, 12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * PCM16_BYTES_PER_SAMPLE, true)
    view.setUint16(32, PCM16_BYTES_PER_SAMPLE, true)
    view.setUint16(34, 16, true)
    writeAscii(wav, 36, 'data')
    view.setUint32(40, pcmDataLength, true)

    if (format === 'pcm16') {
      copyPcm16Chunks(this.chunks.values(), wav.subarray(WAV_HEADER_BYTES))
    } else {
      decodeG711Chunks(this.chunks.values(), format, view, WAV_HEADER_BYTES)
    }

    return wav
  }

  createPlayableWavBlob(): Blob {
    return new Blob([this.createPlayableWavBytes()], { type: 'audio/wav' })
  }

  private requireAudio(): InputAudioFormat {
    if (!this.format || this.byteLength === 0) {
      throw new Error('No transcoded microphone audio is available.')
    }
    return this.format
  }

  private trimToLimit(): void {
    let excessBytes = this.byteLength - this.maxByteLength
    if (excessBytes <= 0) {
      return
    }

    this.truncated = true
    while (excessBytes > 0) {
      const firstEntry = this.chunks.entries().next().value
      if (!firstEntry) {
        break
      }
      const [firstChunkId, first] = firstEntry

      if (first.byteLength <= excessBytes) {
        this.chunks.delete(firstChunkId)
        this.byteLength -= first.byteLength
        excessBytes -= first.byteLength
        continue
      }

      const retained = first.slice(excessBytes)
      this.chunks.set(firstChunkId, retained)
      this.byteLength -= excessBytes
      excessBytes = 0
    }
  }
}

export function getRawAudioExtension(format: InputAudioFormat): string {
  return RAW_AUDIO_EXTENSIONS[format]
}

function copyPcm16Chunks(
  chunks: Iterable<Uint8Array<ArrayBuffer>>,
  destination: Uint8Array<ArrayBuffer>,
): void {
  let destinationOffset = 0

  for (const chunk of chunks) {
    const remaining = destination.byteLength - destinationOffset
    if (remaining <= 0) {
      return
    }

    const source = chunk.subarray(0, Math.min(chunk.byteLength, remaining))
    destination.set(source, destinationOffset)
    destinationOffset += source.byteLength
  }
}

function decodeG711Chunks(
  chunks: Iterable<Uint8Array<ArrayBuffer>>,
  format: 'g711_ulaw' | 'g711_alaw',
  destination: DataView,
  destinationOffset: number,
): void {
  const decode = format === 'g711_ulaw' ? decodeMuLaw : decodeALaw

  for (const chunk of chunks) {
    for (const encodedSample of chunk) {
      destination.setInt16(destinationOffset, decode(encodedSample), true)
      destinationOffset += PCM16_BYTES_PER_SAMPLE
    }
  }
}

function decodeMuLaw(encodedSample: number): number {
  const value = ~encodedSample & 0xff
  let magnitude = ((value & 0x0f) << 3) + 0x84
  magnitude <<= (value & 0x70) >> 4
  return (value & 0x80) !== 0 ? 0x84 - magnitude : magnitude - 0x84
}

function decodeALaw(encodedSample: number): number {
  const value = encodedSample ^ 0x55
  const segment = (value & 0x70) >> 4
  let magnitude = (value & 0x0f) << 4

  if (segment === 0) {
    magnitude += 8
  } else {
    magnitude += 0x108
    if (segment > 1) {
      magnitude <<= segment - 1
    }
  }

  return (value & 0x80) !== 0 ? magnitude : -magnitude
}

function writeAscii(destination: Uint8Array<ArrayBuffer>, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    destination[offset + index] = value.charCodeAt(index)
  }
}
