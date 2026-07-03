const BASE64_CHUNK_SIZE = 0x8000

type Base64Buffer = {
  readonly length: number
  readonly [index: number]: number
  toString(encoding: 'base64'): string
}

type Base64BufferConstructor = {
  from(input: string, encoding: 'base64'): Base64Buffer
  from(input: Uint8Array): Pick<Base64Buffer, 'toString'>
}

const getNodeBuffer = (): Base64BufferConstructor | undefined =>
  (globalThis as { Buffer?: Base64BufferConstructor }).Buffer

export const floatTo16BitPCM = (input: Float32Array): Int16Array => {
  const output = new Int16Array(input.length)

  for (let index = 0; index < input.length; index += 1) {
    const rawSample = input[index] ?? 0
    const sample = Number.isNaN(rawSample) ? 0 : Math.max(-1, Math.min(1, rawSample))
    output[index] = Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff)
  }

  return output
}

export const int16ToUint8LE = (samples: Int16Array): Uint8Array => {
  const bytes = new Uint8Array(samples.length * 2)

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0
    const byteIndex = index * 2
    bytes[byteIndex] = sample & 0xff
    bytes[byteIndex + 1] = (sample >> 8) & 0xff
  }

  return bytes
}

export const uint8ToBase64 = (bytes: Uint8Array): string => {
  if (bytes.length === 0) {
    return ''
  }

  if (typeof btoa === 'undefined') {
    const buffer = getNodeBuffer()

    if (!buffer) {
      throw new Error('No base64 encoder is available')
    }

    return buffer.from(bytes).toString('base64')
  }

  const chunks: string[] = []

  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE)))
  }

  return btoa(chunks.join(''))
}

export const base64ToUint8 = (b64: string): Uint8Array => {
  if (b64.length === 0) {
    return new Uint8Array(0)
  }

  if (typeof atob === 'undefined') {
    const buffer = getNodeBuffer()

    if (!buffer) {
      throw new Error('No base64 decoder is available')
    }

    const decoded = buffer.from(b64, 'base64')
    const bytes = new Uint8Array(decoded.length)

    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded[index] ?? 0
    }

    return bytes
  }

  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

export const pcm16Base64ToFloat32 = (b64: string): Float32Array<ArrayBuffer> => {
  const bytes = base64ToUint8(b64)
  const sampleCount = Math.floor(bytes.length / 2)
  const output = new Float32Array(sampleCount)

  for (let index = 0; index < sampleCount; index += 1) {
    const byteIndex = index * 2
    const low = bytes[byteIndex] ?? 0
    const high = bytes[byteIndex + 1] ?? 0
    const unsignedSample = low | (high << 8)
    const signedSample = unsignedSample >= 0x8000 ? unsignedSample - 0x10000 : unsignedSample
    output[index] = signedSample / 0x8000
  }

  return output
}

export const encodePcmChunkToBase64 = (input: Float32Array): string =>
  uint8ToBase64(int16ToUint8LE(floatTo16BitPCM(input)))
