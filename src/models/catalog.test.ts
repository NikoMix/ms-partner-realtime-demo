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

  it('omits service-managed GA temperature and configures legacy temperature on the session', () => {
    expect(getModelProfile('gpt-realtime').temperature).toMatchObject({
      supported: false,
      scope: 'none',
    })
    expect(getModelProfile('gpt-4o-realtime-preview').temperature.scope).toBe('session')
  })

  it('uses model-specific output modality capabilities', () => {
    expect(getModelProfile('gpt-realtime').outputModalities).toEqual({
      supported: ['audio'],
      default: ['audio'],
      maxSelected: 1,
      configurable: false,
    })
    expect(getModelProfile('gpt-realtime-2').outputModalities).toEqual({
      supported: ['audio', 'text'],
      default: ['audio'],
      maxSelected: 1,
      configurable: true,
    })
  })

  it('defaults temperature to 1', () => {
    expect(getModelProfile('gpt-realtime').temperature.default).toBe(1)
    expect(getModelProfile('gpt-4o-realtime-preview').temperature.default).toBe(1)
  })
})
