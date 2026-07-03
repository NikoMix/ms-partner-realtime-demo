import { describe, expect, it } from 'vitest'

import {
  base64ToUint8,
  encodePcmChunkToBase64,
  floatTo16BitPCM,
  int16ToUint8LE,
  pcm16Base64ToFloat32,
  uint8ToBase64,
} from './pcm'

const PCM16_EPSILON = 1 / 0x8000 + 1e-7

describe('PCM conversion helpers', () => {
  it('clamps Float32 samples to signed PCM16 bounds', () => {
    const encoded = floatTo16BitPCM(
      new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2, Number.NaN, Infinity, -Infinity]),
    )

    expect([...encoded]).toEqual([-32768, -32768, -16384, 0, 16384, 32767, 32767, 0, 32767, -32768])
  })

  it('writes Int16 samples as little-endian bytes', () => {
    const bytes = int16ToUint8LE(new Int16Array([-32768, -1, 0, 1, 32767]))

    expect([...bytes]).toEqual([0x00, 0x80, 0xff, 0xff, 0x00, 0x00, 0x01, 0x00, 0xff, 0x7f])
  })

  it('round-trips arbitrary byte arrays through base64', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_value, index) => index)
    const encoded = uint8ToBase64(bytes)
    const decoded = base64ToUint8(encoded)

    expect([...decoded]).toEqual([...bytes])
  })

  it('round-trips large byte arrays without overflowing the call stack', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_value, index) => index % 251)
    const decoded = base64ToUint8(uint8ToBase64(bytes))

    expect(decoded).toHaveLength(bytes.length)
    expect(decoded[0]).toBe(0)
    expect(decoded[50_000]).toBe(51)
    expect(decoded[99_999]).toBe(101)
  })

  it('reconstructs PCM16 base64 chunks within quantization tolerance', () => {
    const samples = new Float32Array([
      -1,
      -0.75,
      -0.5,
      -1 / 0x8000,
      0,
      1 / 0x7fff,
      0.25,
      0.5,
      0.75,
      1,
    ])
    const decoded = pcm16Base64ToFloat32(encodePcmChunkToBase64(samples))

    expect(decoded).toHaveLength(samples.length)

    for (let index = 0; index < samples.length; index += 1) {
      const expected = samples[index] ?? 0
      const actual = decoded[index] ?? 0
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(PCM16_EPSILON)
    }
  })

  it('handles empty inputs without throwing', () => {
    expect(floatTo16BitPCM(new Float32Array(0))).toHaveLength(0)
    expect(int16ToUint8LE(new Int16Array(0))).toHaveLength(0)
    expect(uint8ToBase64(new Uint8Array(0))).toBe('')
    expect(base64ToUint8('')).toHaveLength(0)
    expect(pcm16Base64ToFloat32('')).toHaveLength(0)
    expect(encodePcmChunkToBase64(new Float32Array(0))).toBe('')
  })

  it('ignores a trailing odd byte when decoding PCM16 bytes', () => {
    const decoded = pcm16Base64ToFloat32(uint8ToBase64(new Uint8Array([0x00, 0x80, 0xff])))

    expect(decoded).toHaveLength(1)
    expect(decoded[0]).toBe(-1)
  })
})
