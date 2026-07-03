import { describe, expect, it } from 'vitest'

import { DEFAULT_MODEL_ID, getModelPreset, getModelProfile, MODEL_PRESETS } from './catalog'

describe('model catalog', () => {
  it('exposes the user-facing GPT-realtime 1 / 1.5 / 2 presets', () => {
    const ids = MODEL_PRESETS.map((preset) => preset.id)
    expect(ids).toContain('gpt-realtime')
    expect(ids).toContain('gpt-realtime-1.5')
    expect(ids).toContain('gpt-realtime-2')
  })

  it('returns the default preset for an unknown id', () => {
    expect(getModelPreset('does-not-exist').id).toBe(DEFAULT_MODEL_ID)
  })

  it('resolves a known preset directly', () => {
    expect(getModelPreset('gpt-realtime-1.5').id).toBe('gpt-realtime-1.5')
  })

  it('maps GA models to the nested schema and legacy models to the flat schema', () => {
    expect(getModelProfile('gpt-realtime').schema).toBe('ga')
    expect(getModelProfile('gpt-4o-realtime-preview').schema).toBe('legacy')
  })

  it('places temperature on the response for GA and on the session for legacy', () => {
    expect(getModelProfile('gpt-realtime').temperature.scope).toBe('response')
    expect(getModelProfile('gpt-4o-realtime-preview').temperature.scope).toBe('session')
  })
})
