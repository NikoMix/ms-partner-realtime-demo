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
