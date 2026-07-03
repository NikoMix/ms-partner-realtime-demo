import { describe, expect, it } from 'vitest'

import { getModelProfile } from '@/models/catalog'
import { createDefaultSessionSettings, type SessionSettings } from '@/types/settings'
import type { RealtimeToolSpec } from '@/types/tools'
import { buildResponseCreate, buildSessionUpdate, mapTurnDetection } from './session-config'

const toolSpecs: readonly RealtimeToolSpec[] = [
  {
    type: 'function',
    name: 'lookup_order',
    description: 'Look up an order.',
    parameters: { type: 'object' },
  },
]

function record(value: unknown): Record<string, unknown> {
  expect(typeof value).toBe('object')
  expect(value).not.toBeNull()
  return value as Record<string, unknown>
}

function settings(id = 'gpt-realtime'): SessionSettings {
  const result = createDefaultSessionSettings(getModelProfile(id))
  result.instructions = 'Be brief.'
  result.temperature = 0.9
  result.audio.voice = 'marin'
  result.audio.speed = 1.1
  result.transcription.language = 'en'
  result.transcription.prompt = 'Product names are common.'
  return result
}

describe('buildSessionUpdate', () => {
  it('builds the GA nested realtime session shape without session temperature', () => {
    const payload = buildSessionUpdate(settings(), getModelProfile('gpt-realtime'), toolSpecs)
    const session = record(payload.session)
    const audio = record(session.audio)
    const input = record(audio.input)
    const output = record(audio.output)

    expect(payload.type).toBe('session.update')
    expect(session.type).toBe('realtime')
    expect(session.temperature).toBeUndefined()
    expect(session.output_modalities).toEqual(['audio', 'text'])
    expect(record(input.format).rate).toBe(24_000)
    expect(record(output.format).type).toBe('audio/pcm')
    expect(output.voice).toBe('marin')
    expect(output.speed).toBeCloseTo(1.1)
    expect(session.tools).toEqual(toolSpecs)
  })

  it('builds the legacy flat session shape with session temperature', () => {
    const payload = buildSessionUpdate(
      settings('gpt-4o-realtime-preview'),
      getModelProfile('gpt-4o-realtime-preview'),
      toolSpecs,
    )
    const session = record(payload.session)

    expect(session.input_audio_format).toBe('pcm16')
    expect(session.output_audio_format).toBe('pcm16')
    expect(session.temperature).toBeCloseTo(0.9)
    expect(session.max_response_output_tokens).toBe(4096)
    expect(session.tools).toEqual(toolSpecs)
  })
})

describe('mapTurnDetection', () => {
  it('maps none to null', () => {
    const td = settings().turnDetection
    td.type = 'none'

    expect(mapTurnDetection(td)).toBeNull()
  })

  it('maps server_vad fields', () => {
    const td = settings().turnDetection
    td.type = 'server_vad'
    td.threshold = 0.7
    td.prefixPaddingMs = 250
    td.silenceDurationMs = 600

    expect(mapTurnDetection(td)).toEqual({
      type: 'server_vad',
      threshold: 0.7,
      prefix_padding_ms: 250,
      silence_duration_ms: 600,
      create_response: true,
      interrupt_response: true,
    })
  })

  it('maps semantic_vad fields', () => {
    const td = settings().turnDetection
    td.type = 'semantic_vad'
    td.eagerness = 'high'

    expect(mapTurnDetection(td)).toEqual({
      type: 'semantic_vad',
      eagerness: 'high',
      create_response: true,
      interrupt_response: true,
    })
  })
})

describe('buildResponseCreate', () => {
  it('includes temperature only when the profile supports response-scoped temperature', () => {
    const ga = buildResponseCreate(settings(), getModelProfile('gpt-realtime'))
    const legacy = buildResponseCreate(
      settings('gpt-4o-realtime-preview'),
      getModelProfile('gpt-4o-realtime-preview'),
    )

    expect(record(ga.response).temperature).toBeCloseTo(0.9)
    expect(legacy.response).toEqual({})
  })
})
