import { effectScope, onScopeDispose, ref, watch } from 'vue'
import { Pcm16Player } from '@/audio/player'
import { MicRecorder } from '@/audio/recorder'
import {
  TranscodedAudioBuffer,
  getRawAudioExtension,
  type TranscodedAudioBufferInfo,
} from '@/audio/transcoded-audio-buffer'
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
  const transcodedAudioBuffer = new TranscodedAudioBuffer()

  const micState = ref<AudioEngineState>('idle')
  const micFormatLocked = ref(false)
  const micStopping = ref(false)
  const transcodedAudioBufferEnabled = ref(false)
  const transcodedAudioBufferInfo = ref<TranscodedAudioBufferInfo>(transcodedAudioBuffer.info)
  const transcodedAudioPlaybackUrl = ref<string | null>(null)
  const volume = ref(1)
  const supportsSinkSelection = player.supportsSinkSelection
  const AUDIO_BUFFER_UI_UPDATE_INTERVAL_MS = 500
  let sessionUpdateTimer: ReturnType<typeof setTimeout> | null = null
  let activeInputFormat: InputAudioFormat | null = null
  let lastAudioBufferUiUpdate = 0
  let microphoneOperationGeneration = 0
  let stopMicPromise: Promise<void> | null = null
  let disconnectPromise: Promise<void> | null = null

  function logError(type: string, summary: string): void {
    events.add({ direction: 'system', severity: 'error', type, summary })
  }

  function logWarning(type: string, summary: string): void {
    events.add({ direction: 'system', severity: 'warning', type, summary })
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

    if (transcodedAudioBufferEnabled.value) {
      revokeTranscodedAudioPlayback()
      transcodedAudioBuffer.begin(inputFormat)
      refreshTranscodedAudioBufferInfo()
    }

    await recorder.start({
      deviceId: devices.selectedInputId || undefined,
      inputFormat,
      onChunk: (base64Audio: string) => {
        return client.sendAudioChunk(base64Audio)
      },
      onEncodedChunk: (encodedAudio) => {
        if (!transcodedAudioBufferEnabled.value) {
          return
        }

        transcodedAudioBuffer.append(encodedAudio)
        const now = Date.now()
        if (now - lastAudioBufferUiUpdate >= AUDIO_BUFFER_UI_UPDATE_INTERVAL_MS) {
          refreshTranscodedAudioBufferInfo(now)
        }
      },
      onEncodedChunkError: (error: Error) => {
        transcodedAudioBufferEnabled.value = false
        refreshTranscodedAudioBufferInfo()
        logError(
          'audio.buffer.error',
          `Input audio buffering was disabled while realtime capture continues: ${error.message}`,
        )
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
      refreshTranscodedAudioBufferInfo()
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

  function setTranscodedAudioBufferEnabled(enabled: boolean): void {
    if (micFormatLocked.value || micStopping.value) {
      logWarning(
        'audio.buffer.locked',
        'Stop the microphone before changing input audio buffer capture.',
      )
      return
    }

    transcodedAudioBufferEnabled.value = enabled
  }

  function clearTranscodedAudioBuffer(): void {
    if (micFormatLocked.value || micStopping.value) {
      logWarning('audio.buffer.locked', 'Stop the microphone before clearing its audio buffer.')
      return
    }

    revokeTranscodedAudioPlayback()
    transcodedAudioBuffer.clear()
    refreshTranscodedAudioBufferInfo()
  }

  function prepareTranscodedAudioPlayback(): string | null {
    if (micFormatLocked.value || micStopping.value) {
      logWarning('audio.buffer.locked', 'Stop the microphone before preparing buffered playback.')
      return null
    }
    if (connection.responseInProgress) {
      logWarning(
        'audio.buffer.response_active',
        'Wait for the model response to finish before playing buffered input audio.',
      )
      return null
    }

    try {
      revokeTranscodedAudioPlayback()
      transcodedAudioPlaybackUrl.value = createObjectUrl(
        transcodedAudioBuffer.createPlayableWavBlob(),
      )
      return transcodedAudioPlaybackUrl.value
    } catch (error) {
      logError('audio.buffer.playback.error', toError(error).message)
      return null
    }
  }

  function downloadTranscodedAudioWav(): void {
    downloadTranscodedAudio(
      () => transcodedAudioBuffer.createPlayableWavBlob(),
      'wav',
      'audio.buffer.download.wav.error',
    )
  }

  function downloadTranscodedAudioRaw(): void {
    const format = transcodedAudioBufferInfo.value.format
    if (!format) {
      logError('audio.buffer.download.raw.error', 'No transcoded microphone audio is available.')
      return
    }

    downloadTranscodedAudio(
      () => transcodedAudioBuffer.createRawBlob(),
      getRawAudioExtension(format),
      'audio.buffer.download.raw.error',
    )
  }

  function downloadTranscodedAudio(
    createBlob: () => Blob,
    extension: string,
    errorType: string,
  ): void {
    if (micFormatLocked.value || micStopping.value) {
      logWarning('audio.buffer.locked', 'Stop the microphone before downloading its audio buffer.')
      return
    }
    if (connection.responseInProgress) {
      logWarning(
        'audio.buffer.response_active',
        'Wait for the model response to finish before exporting buffered input audio.',
      )
      return
    }

    try {
      const format = transcodedAudioBufferInfo.value.format
      const startedAt = transcodedAudioBufferInfo.value.startedAt
      if (!format || !startedAt) {
        throw new Error('No transcoded microphone audio is available.')
      }

      triggerDownload(
        createBlob(),
        `realtime-input-${format}-${formatTimestamp(startedAt)}.${extension}`,
      )
    } catch (error) {
      logError(errorType, toError(error).message)
    }
  }

  function refreshTranscodedAudioBufferInfo(updatedAt = Date.now()): void {
    transcodedAudioBufferInfo.value = transcodedAudioBuffer.info
    lastAudioBufferUiUpdate = updatedAt
  }

  function revokeTranscodedAudioPlayback(): void {
    if (!transcodedAudioPlaybackUrl.value) {
      return
    }

    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(transcodedAudioPlaybackUrl.value)
    }
    transcodedAudioPlaybackUrl.value = null
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

  watch(
    () => connection.responseInProgress,
    (responseInProgress) => {
      if (responseInProgress) {
        revokeTranscodedAudioPlayback()
      }
    },
  )

  onScopeDispose(() => {
    if (sessionUpdateTimer !== null) {
      clearTimeout(sessionUpdateTimer)
    }
    void stopMic()
    revokeTranscodedAudioPlayback()
    transcodedAudioBuffer.clear()
    player.dispose()
  })

  return {
    micState,
    micFormatLocked,
    micStopping,
    transcodedAudioBufferEnabled,
    transcodedAudioBufferInfo,
    transcodedAudioPlaybackUrl,
    volume,
    supportsSinkSelection,
    connect,
    disconnect,
    startMic,
    stopMic,
    toggleMic,
    commitAndRespond,
    applyOutputDevice,
    setTranscodedAudioBufferEnabled,
    clearTranscodedAudioBuffer,
    prepareTranscodedAudioPlayback,
    downloadTranscodedAudioWav,
    downloadTranscodedAudioRaw,
    setVolume,
  }
}

function createObjectUrl(blob: Blob): string {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('This browser cannot create local audio playback URLs.')
  }
  return URL.createObjectURL(blob)
}

function triggerDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') {
    throw new Error('Downloads are unavailable outside a browser.')
  }

  const url = createObjectUrl(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error))

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
