/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

import type { InputAudioFormat } from '@/types/audio'

const WORKLET_SOURCE = readFileSync('public/pcm-recorder.worklet.js', 'utf8')

interface TestMessagePort {
  onmessage: ((event: { data: unknown }) => void) | null
  postMessage(message: ArrayBuffer | { readonly type: string }): void
}

interface TestRecorderProcessor {
  readonly port: TestMessagePort
  process(inputs: Float32Array[][]): boolean
}

type TestProcessorConstructor = new (options: {
  processorOptions: { inputFormat: InputAudioFormat }
}) => TestRecorderProcessor

function createProcessor(inputFormat: InputAudioFormat, contextSampleRate: number) {
  const chunks: Uint8Array[] = []
  const controlMessages: { readonly type: string }[] = []
  let registeredName = ''
  let RegisteredProcessor: TestProcessorConstructor | undefined

  class FakeAudioWorkletProcessor {
    readonly port: TestMessagePort = {
      onmessage: null,
      postMessage: (message) => {
        if ('byteLength' in message) {
          chunks.push(Uint8Array.from(new Uint8Array(message)))
        } else {
          controlMessages.push(message)
        }
      },
    }
  }

  // This executes trusted repository code in an isolated context to emulate
  // AudioWorkletGlobalScope without maintaining a second codec implementation.
  // eslint-disable-next-line sonarjs/code-eval
  runInNewContext(WORKLET_SOURCE, {
    AudioWorkletProcessor: FakeAudioWorkletProcessor,
    registerProcessor: (name: string, processor: TestProcessorConstructor) => {
      registeredName = name
      RegisteredProcessor = processor
    },
    sampleRate: contextSampleRate,
  })

  expect(registeredName).toBe('pcm-recorder')
  if (!RegisteredProcessor) {
    throw new Error('The recorder worklet did not register a processor')
  }

  return {
    chunks,
    controlMessages,
    processor: new RegisteredProcessor({ processorOptions: { inputFormat } }),
  }
}

function processInRenderQuanta(processor: TestRecorderProcessor, samples: Float32Array): void {
  for (let offset = 0; offset < samples.length; offset += 128) {
    expect(processor.process([[samples.subarray(offset, offset + 128)]])).toBe(true)
  }
}

function stop(processor: TestRecorderProcessor): void {
  processor.port.onmessage?.({ data: 'stop' })
  expect(processor.process([])).toBe(false)
}

function pcm16ToFloat32(samples: readonly number[]): Float32Array {
  return Float32Array.from(samples, (sample) => (sample < 0 ? sample / 0x8000 : sample / 0x7fff))
}

describe('microphone recorder worklet', () => {
  it.each([
    ['pcm16', 24_000, 4_800],
    ['g711_ulaw', 8_000, 800],
    ['g711_alaw', 8_000, 800],
  ] as const satisfies readonly (readonly [InputAudioFormat, number, number])[])(
    'emits pre-sized 100 ms %s chunks',
    (inputFormat, sampleRate, expectedByteLength) => {
      const { chunks, processor } = createProcessor(inputFormat, sampleRate)

      processInRenderQuanta(processor, new Float32Array(sampleRate / 10))

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toHaveLength(expectedByteLength)
    },
  )

  it('matches canonical G.711 mu-law vectors', () => {
    const samples = [
      -32768, -16384, -4096, -1024, -256, -64, -16, -1, 0, 1, 16, 64, 256, 1024, 4096, 16384, 32767,
    ]
    const expected = [
      0x00, 0x0f, 0x2f, 0x4d, 0x67, 0x77, 0x7d, 0x7f, 0xff, 0xff, 0xfd, 0xf7, 0xe7, 0xcd, 0xaf,
      0x8f, 0x80,
    ]
    const { chunks, controlMessages, processor } = createProcessor('g711_ulaw', 8_000)

    processInRenderQuanta(processor, pcm16ToFloat32(samples))
    stop(processor)

    expect([...chunks[0]!]).toEqual(expected)
    expect(controlMessages).toEqual([{ type: 'flush-complete' }])
  })

  it('matches canonical G.711 A-law vectors', () => {
    const samples = [
      -32768, -16384, -4096, -1024, -256, -64, -16, -1, 0, 1, 16, 64, 256, 1024, 4096, 16384, 32767,
    ]
    const expected = [
      0x2a, 0x3a, 0x1a, 0x7a, 0x5a, 0x56, 0x55, 0x55, 0xd5, 0xd5, 0xd4, 0xd1, 0xc5, 0xe5, 0x85,
      0xa5, 0xaa,
    ]
    const { chunks, processor } = createProcessor('g711_alaw', 8_000)

    processInRenderQuanta(processor, pcm16ToFloat32(samples))
    stop(processor)

    expect([...chunks[0]!]).toEqual(expected)
  })

  it('downsamples a 24 kHz fallback context to an 8 kHz G.711 stream', () => {
    const { chunks, processor } = createProcessor('g711_ulaw', 24_000)

    processInRenderQuanta(processor, new Float32Array(2_400))

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toHaveLength(800)
    expect(chunks[0]!.every((sample) => sample === 0xff)).toBe(true)
  })
})
