import { describe, expect, it } from 'vitest'

import { CanonicalServerEvent, normalizeServerEvent, parseServerEvent } from './events'

describe('normalizeServerEvent', () => {
  it('collapses both audio delta variants to a single canonical event', () => {
    expect(normalizeServerEvent('response.audio.delta')).toBe(CanonicalServerEvent.AudioDelta)
    expect(normalizeServerEvent('response.output_audio.delta')).toBe(CanonicalServerEvent.AudioDelta)
  })

  it('collapses both transcript delta variants to a single canonical event', () => {
    expect(normalizeServerEvent('response.audio_transcript.delta')).toBe(
      CanonicalServerEvent.AudioTranscriptDelta,
    )
    expect(normalizeServerEvent('response.output_audio_transcript.delta')).toBe(
      CanonicalServerEvent.AudioTranscriptDelta,
    )
  })

  it('maps unknown event types to Other', () => {
    expect(normalizeServerEvent('something.new.event')).toBe(CanonicalServerEvent.Other)
  })
})

describe('parseServerEvent', () => {
  it('parses a valid event envelope', () => {
    const event = parseServerEvent('{"type":"session.created","session":{}}')
    expect(event?.type).toBe('session.created')
  })

  it('returns null for malformed JSON', () => {
    expect(parseServerEvent('{not json')).toBeNull()
  })

  it('returns null when the type field is missing or non-string', () => {
    expect(parseServerEvent('{"foo":"bar"}')).toBeNull()
    expect(parseServerEvent('{"type":123}')).toBeNull()
  })
})
