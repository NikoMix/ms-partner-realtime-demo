/** Microphone / speaker device option surfaced in the device pickers. */
export interface AudioDeviceOption {
  deviceId: string
  label: string
  kind: 'audioinput' | 'audiooutput'
}

/** Permission state for microphone access. */
export type MicPermissionState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unsupported'

/** High-level state of the audio capture/playback engine. */
export type AudioEngineState = 'idle' | 'recording' | 'error'

export const INPUT_AUDIO_FORMATS = ['pcm16', 'g711_ulaw', 'g711_alaw'] as const
export type InputAudioFormat = (typeof INPUT_AUDIO_FORMATS)[number]

export const INPUT_AUDIO_FORMAT_LABELS = {
  pcm16: 'PCM16 - 24 kHz',
  g711_ulaw: 'G.711 mu-law - 8 kHz',
  g711_alaw: 'G.711 A-law - 8 kHz',
} as const satisfies Record<InputAudioFormat, string>

export const PCM16_SAMPLE_RATE_HZ = 24_000
export const G711_SAMPLE_RATE_HZ = 8_000

export const INPUT_AUDIO_SAMPLE_RATES_HZ = {
  pcm16: PCM16_SAMPLE_RATE_HZ,
  g711_ulaw: G711_SAMPLE_RATE_HZ,
  g711_alaw: G711_SAMPLE_RATE_HZ,
} as const satisfies Record<InputAudioFormat, number>

export function isInputAudioFormat(value: unknown): value is InputAudioFormat {
  return typeof value === 'string' && INPUT_AUDIO_FORMATS.some((format) => format === value)
}
