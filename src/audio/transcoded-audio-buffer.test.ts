import { describe, expect, it } from 'vitest'

import { TranscodedAudioBuffer, getRawAudioExtension } from './transcoded-audio-buffer'

describe('TranscodedAudioBuffer', () => {
  it('retains only the newest exact encoded bytes when the duration limit is reached', () => {
    const buffer = new TranscodedAudioBuffer(4 / 48_000)
    buffer.begin('pcm16', 123)
    buffer.append(new Uint8Array([1, 2, 3]))
    buffer.append(new Uint8Array([4, 5, 6]))

    expect(buffer.info).toMatchObject({
      byteLength: 4,
      format: 'pcm16',
      startedAt: 123,
      truncated: true,
    })
    expect(Array.from(buffer.createRawBytes())).toEqual([3, 4, 5, 6])
  })

  it('wraps PCM16 bytes in a playable mono WAV without changing the samples', () => {
    const buffer = new TranscodedAudioBuffer()
    buffer.begin('pcm16')
    buffer.append(new Uint8Array([0x00, 0x80, 0xff, 0x7f]))

    const wav = buffer.createPlayableWavBytes()
    const view = new DataView(wav.buffer)

    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe('WAVE')
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(24_000)
    expect(view.getUint32(40, true)).toBe(4)
    expect(Array.from(wav.subarray(44))).toEqual([0x00, 0x80, 0xff, 0x7f])
  })

  it('decodes mu-law and A-law only when creating playback WAV files', () => {
    const muLaw = new TranscodedAudioBuffer()
    muLaw.begin('g711_ulaw')
    muLaw.append(new Uint8Array([0x00, 0x80, 0xff]))
    const muLawWav = new DataView(muLaw.createPlayableWavBytes().buffer)

    expect(muLawWav.getUint32(24, true)).toBe(8_000)
    expect(muLawWav.getInt16(44, true)).toBe(-32_124)
    expect(muLawWav.getInt16(46, true)).toBe(32_124)
    expect(muLawWav.getInt16(48, true)).toBe(0)

    const aLaw = new TranscodedAudioBuffer()
    aLaw.begin('g711_alaw')
    aLaw.append(new Uint8Array([0x55, 0xd5]))
    const aLawWav = new DataView(aLaw.createPlayableWavBytes().buffer)

    expect(aLawWav.getInt16(44, true)).toBe(-8)
    expect(aLawWav.getInt16(46, true)).toBe(8)
  })

  it('reports raw filename extensions for every supported input format', () => {
    expect(getRawAudioExtension('pcm16')).toBe('s16le')
    expect(getRawAudioExtension('g711_ulaw')).toBe('ulaw')
    expect(getRawAudioExtension('g711_alaw')).toBe('alaw')
  })

  it('requires an active capture and buffered audio before exporting', () => {
    const buffer = new TranscodedAudioBuffer()

    expect(() => buffer.append(new Uint8Array([1]))).toThrow(/start/i)
    expect(() => buffer.createPlayableWavBytes()).toThrow(/no transcoded/i)
  })
})
