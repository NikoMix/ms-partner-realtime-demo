import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { getModelProfile } from '@/models/catalog'
import { createDefaultSessionSettings } from '@/types/settings'
import { useSettingsStore } from './settings'

const STORAGE_KEY = 'realtime-studio:settings:v1'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('settings store', () => {
  it('uses audio and temperature 1 as fresh session defaults', () => {
    const settings = useSettingsStore()

    expect(settings.session.outputModalities).toEqual(['audio'])
    expect(settings.session.temperature).toBe(1)
    expect(settings.session.audio.inputFormat).toBe('pcm16')
  })

  it('normalizes a portal URI and selects its model', () => {
    const settings = useSettingsStore()

    settings.applyEndpointInput(
      'https://mixn-moa844yd-swedencentral.cognitiveservices.azure.com/openai/v1/realtime?model=gpt-realtime-2',
    )

    expect(settings.endpoint).toBe(
      'https://mixn-moa844yd-swedencentral.cognitiveservices.azure.com',
    )
    expect(settings.modelPresetId).toBe('gpt-realtime-2')
    expect(settings.deployment).toBe('gpt-realtime-2')
    expect(settings.session.outputModalities).toEqual(['audio'])
  })

  it('keeps the selected model when an endpoint has no model query', () => {
    const settings = useSettingsStore()
    settings.setModelPreset('gpt-realtime-1.5')

    settings.applyEndpointInput('https://example.openai.azure.com')

    expect(settings.modelPresetId).toBe('gpt-realtime-1.5')
  })

  it('defaults older persisted sessions without an input format to PCM16', () => {
    const defaults = createDefaultSessionSettings(getModelProfile('gpt-realtime'))
    const legacyAudio = {
      voice: defaults.audio.voice,
      speed: defaults.audio.speed,
      noiseReduction: defaults.audio.noiseReduction,
    }
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        providerId: 'azure-openai',
        modelPresetId: 'gpt-realtime',
        apiVersion: '',
        theme: 'system',
        session: { ...defaults, audio: legacyAudio },
      }),
    )

    const settings = useSettingsStore()

    expect(settings.session.audio.inputFormat).toBe('pcm16')
  })

  it('rejects an unknown persisted input format', () => {
    const defaults = createDefaultSessionSettings(getModelProfile('gpt-realtime'))
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        providerId: 'azure-openai',
        modelPresetId: 'gpt-realtime',
        apiVersion: '',
        theme: 'system',
        session: {
          ...defaults,
          audio: { ...defaults.audio, inputFormat: 'opus' },
        },
      }),
    )

    const settings = useSettingsStore()

    expect(settings.session.audio.inputFormat).toBe('pcm16')
  })
})
