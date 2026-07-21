import { effectScope, onScopeDispose, ref, watch } from 'vue'
import { Pcm16Player } from '@/audio/player'
import { MicRecorder } from '@/audio/recorder'
import { RealtimeClient } from '@/realtime/client'
import { useAudioDevicesStore } from '@/stores/audioDevices'
import { useConnectionStore } from '@/stores/connection'
import { useEventLogStore } from '@/stores/eventlog'
import { useSettingsStore } from '@/stores/settings'
import { useToolsStore } from '@/stores/tools'
import type { AudioEngineState, InputAudioFormat } from '@/types/audio'

/**
 * Integration glue between the audio engine (recorder + player) and the realtime
 * client. A single shared instance is created lazily and reused across the app so
 * that one WebSocket, one microphone stream, and one playback context are in play.
 *
 * SECURITY: no credentials are handled here — the client reads them from the
 * in-memory settings store and redacts them before anything reaches the log.
 */
function createRealtimeSession() {
  const connection = useConnectionStore()
  const events = useEventLogStore()
  const devices = useAudioDevicesStore()
  const settings = useSettingsStore()
  const tools = useToolsStore()

  const player = new Pcm16Player()
  const client = new RealtimeClient({ audioSink: player })
  const recorder = new MicRecorder()

  const micState = ref<AudioEngineState>('idle')
  const micFormatLocked = ref(false)
  const micStopping = ref(false)
  const volume = ref(1)
  const supportsSinkSelection = player.supportsSinkSelection
  let sessionUpdateTimer: ReturnType<typeof setTimeout> | null = null
  let activeInputFormat: InputAudioFormat | null = null
  let microphoneOperationGeneration = 0
  let stopMicPromise: Promise<void> | null = null
  let disconnectPromise: Promise<void> | null = null

  function logError(type: string, summary: string): void {
    events.add({ direction: 'system', severity: 'error', type, summary })
  }

  async function applyOutputDevice(): Promise<void> {
    if (!supportsSinkSelection || !devices.selectedOutputId) {
      return
    }
    try {
      await player.setSinkId(devices.selectedOutputId)
    } catch {
      logError('audio.sink.error', 'Failed to route audio to the selected speaker.')
    }
  }

  async function connect(): Promise<void> {
    if (connection.isActive) {
      return
    }
    if (stopMicPromise) {
      await stopMicPromise
    }
    if (connection.isActive) {
      return
    }
    // A user gesture reached us, so unlock playback and route to the chosen sink.
    try {
      await player.resume()
    } catch {
      // Playback resumes on first audio delta if this is unavailable.
    }
    await applyOutputDevice()
    client.connect()
  }

  function disconnect(): Promise<void> {
    if (disconnectPromise) {
      return disconnectPromise
    }

    // Keep the current socket alive while the recorder delivers its final
    // acknowledged chunk, but lock the UI against new actions immediately.
    connection.setClosing()
    const disconnecting = (async () => {
      try {
        await stopMic()
      } finally {
        client.disconnect()
        player.clear()
      }
    })().finally(() => {
      if (disconnectPromise === disconnecting) {
        disconnectPromise = null
      }
    })
    disconnectPromise = disconnecting
    return disconnecting
  }

  async function startMic(): Promise<void> {
    if (!connection.isConnected || micFormatLocked.value) {
      return
    }
    const inputFormat = settings.session.audio.inputFormat
    const operationGeneration = ++microphoneOperationGeneration
    activeInputFormat = inputFormat
    micFormatLocked.value = true

    try {
      await player.resume()
    } catch {
      // Non-fatal; playback context resumes lazily.
    }
    if (operationGeneration !== microphoneOperationGeneration || !connection.isConnected) {
      return
    }

    try {
      await applySessionUpdateNow()
    } catch {
      if (operationGeneration === microphoneOperationGeneration) {
        activeInputFormat = null
        micFormatLocked.value = false
      }
      return
    }
    if (operationGeneration !== microphoneOperationGeneration || !connection.isConnected) {
      return
    }

    await recorder.start({
      deviceId: devices.selectedInputId || undefined,
      inputFormat,
      onChunk: (base64Audio: string) => {
        client.sendAudioChunk(base64Audio)
      },
      onStateChange: (state: AudioEngineState) => {
        micState.value = state
        if (state === 'error') {
          void stopMic()
        }
      },
      onError: (error: Error) => {
        logError('audio.recorder.error', error.message)
        devices.setPermission('denied')
      },
    })

    if (operationGeneration !== microphoneOperationGeneration) {
      return
    }
    if (!connection.isConnected) {
      await stopMic()
      return
    }

    if (recorder.state === 'recording') {
      devices.setPermission('granted')
      void devices.refreshDevices()
    } else {
      activeInputFormat = null
      micFormatLocked.value = false
    }
  }

  function stopMic(): Promise<void> {
    microphoneOperationGeneration += 1
    if (stopMicPromise) {
      return stopMicPromise
    }

    micStopping.value = true
    const stopping = recorder.stop().finally(() => {
      micState.value = 'idle'
      activeInputFormat = null
      micFormatLocked.value = false
      micStopping.value = false
      if (stopMicPromise === stopping) {
        stopMicPromise = null
      }
    })
    stopMicPromise = stopping
    return stopping
  }

  async function toggleMic(): Promise<void> {
    if (micState.value === 'recording') {
      await stopMic()
    } else {
      await startMic()
    }
  }

  /** Manual turn mode: commit the buffered audio and ask for a response. */
  async function commitAndRespond(): Promise<void> {
    if (!connection.isConnected || connection.responseInProgress || micStopping.value) {
      return
    }

    await stopMic()
    if (!connection.isConnected || connection.responseInProgress) {
      return
    }
    client.commitInput()
    client.createResponse()
  }

  function setVolume(value: number): void {
    volume.value = value
    player.setVolume(value)
  }

  function scheduleSessionUpdate(): void {
    if (sessionUpdateTimer !== null) {
      clearTimeout(sessionUpdateTimer)
    }
    sessionUpdateTimer = setTimeout(() => {
      sessionUpdateTimer = null
      // RealtimeClient surfaces update failures while preserving recoverable sessions.
      void client.updateSession().catch(() => undefined)
    }, 100)
  }

  function applySessionUpdateNow(): Promise<void> {
    if (sessionUpdateTimer !== null) {
      clearTimeout(sessionUpdateTimer)
      sessionUpdateTimer = null
    }
    return client.updateSession()
  }

  watch([() => settings.session, () => tools.toolSpecs], scheduleSessionUpdate, {
    deep: true,
    flush: 'post',
  })

  watch(
    () => settings.session.audio.inputFormat,
    (inputFormat) => {
      if (!micFormatLocked.value) {
        if (connection.isConnected) {
          client.clearInput()
          scheduleSessionUpdate()
        }
        return
      }

      if (activeInputFormat === null || inputFormat === activeInputFormat) {
        return
      }

      settings.session.audio.inputFormat = activeInputFormat
      events.add({
        direction: 'system',
        severity: 'warning',
        type: 'audio.input_format.locked',
        summary: 'Stop the microphone before changing its input format.',
      })
    },
    { flush: 'sync' },
  )

  watch(
    () => devices.selectedOutputId,
    () => {
      void applyOutputDevice()
    },
  )

  watch(
    () => connection.isConnected,
    (isConnected) => {
      if (!isConnected && micFormatLocked.value) {
        void stopMic()
      }
    },
  )

  onScopeDispose(() => {
    if (sessionUpdateTimer !== null) {
      clearTimeout(sessionUpdateTimer)
    }
    void stopMic()
    player.dispose()
  })

  return {
    micState,
    micFormatLocked,
    micStopping,
    volume,
    supportsSinkSelection,
    connect,
    disconnect,
    startMic,
    stopMic,
    toggleMic,
    commitAndRespond,
    applyOutputDevice,
    setVolume,
  }
}

type RealtimeSession = ReturnType<typeof createRealtimeSession>

let sharedSession: RealtimeSession | null = null

/**
 * Returns the shared realtime session, creating it on first use. The session is
 * built inside a detached effect scope so its watcher and disposal hook belong to
 * the singleton itself rather than to whichever component happens to resolve it
 * first — unmounting that component must never tear down the shared audio engine.
 */
export function useRealtimeSession(): RealtimeSession {
  if (sharedSession) {
    return sharedSession
  }
  const scope = effectScope(true)
  const created = scope.run(() => createRealtimeSession())
  if (!created) {
    throw new Error('Failed to initialize the realtime session.')
  }
  sharedSession = created
  return sharedSession
}
