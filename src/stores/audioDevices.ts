import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { AudioDeviceOption, MicPermissionState } from '@/types/audio'
import { loadJson, saveJson } from '@/utils/storage'

const STORAGE_KEY = 'realtime-studio:audio-devices:v1'

interface PersistedDeviceSelection {
  inputId: string
  outputId: string
}

function mediaDevicesAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices !== 'undefined' &&
    typeof navigator.mediaDevices.enumerateDevices === 'function'
  )
}

/** Detects whether the browser supports directing output to a chosen speaker. */
function detectOutputSelectionSupport(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  const audioCtor =
    typeof AudioContext !== 'undefined'
      ? AudioContext
      : (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  const contextSupportsSink =
    typeof audioCtor === 'function' && 'setSinkId' in audioCtor.prototype
  const elementSupportsSink =
    typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype
  return contextSupportsSink || elementSupportsSink
}

/**
 * Enumerates and tracks selected microphone (input) and speaker (output)
 * devices. Only opaque device ids are persisted (non-secret preferences).
 */
export const useAudioDevicesStore = defineStore('audioDevices', () => {
  const persisted = loadJson<PersistedDeviceSelection | null>(STORAGE_KEY, null)

  const inputs = ref<AudioDeviceOption[]>([])
  const outputs = ref<AudioDeviceOption[]>([])
  const selectedInputId = ref<string>(persisted?.inputId ?? '')
  const selectedOutputId = ref<string>(persisted?.outputId ?? '')
  const permission = ref<MicPermissionState>(mediaDevicesAvailable() ? 'unknown' : 'unsupported')
  const error = ref<string | null>(null)

  const supportsOutputSelection = ref(detectOutputSelectionSupport())
  const supportsDeviceEnumeration = computed(() => mediaDevicesAvailable())

  async function refreshDevices(): Promise<void> {
    if (!mediaDevicesAvailable()) {
      permission.value = 'unsupported'
      return
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const nextInputs: AudioDeviceOption[] = []
      const nextOutputs: AudioDeviceOption[] = []
      let inputIndex = 0
      let outputIndex = 0
      for (const device of devices) {
        if (device.kind === 'audioinput') {
          inputIndex += 1
          nextInputs.push({
            deviceId: device.deviceId,
            kind: 'audioinput',
            label: device.label || `Microphone ${inputIndex}`,
          })
        } else if (device.kind === 'audiooutput') {
          outputIndex += 1
          nextOutputs.push({
            deviceId: device.deviceId,
            kind: 'audiooutput',
            label: device.label || `Speaker ${outputIndex}`,
          })
        }
      }
      inputs.value = nextInputs
      outputs.value = nextOutputs
      ensureSelectionValid()
      error.value = null
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to enumerate audio devices.'
    }
  }

  function ensureSelectionValid(): void {
    if (selectedInputId.value && !inputs.value.some((d) => d.deviceId === selectedInputId.value)) {
      selectedInputId.value = ''
    }
    if (
      selectedOutputId.value &&
      !outputs.value.some((d) => d.deviceId === selectedOutputId.value)
    ) {
      selectedOutputId.value = ''
    }
  }

  function setSelectedInput(deviceId: string): void {
    selectedInputId.value = deviceId
  }

  function setSelectedOutput(deviceId: string): void {
    selectedOutputId.value = deviceId
  }

  function setPermission(state: MicPermissionState): void {
    permission.value = state
  }

  watch([selectedInputId, selectedOutputId], () => {
    saveJson(STORAGE_KEY, {
      inputId: selectedInputId.value,
      outputId: selectedOutputId.value,
    } satisfies PersistedDeviceSelection)
  })

  return {
    inputs,
    outputs,
    selectedInputId,
    selectedOutputId,
    permission,
    error,
    supportsOutputSelection,
    supportsDeviceEnumeration,
    refreshDevices,
    setSelectedInput,
    setSelectedOutput,
    setPermission,
  }
})
