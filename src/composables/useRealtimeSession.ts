import { effectScope, onScopeDispose, ref, watch } from 'vue'
import { Pcm16Player } from '@/audio/player'
import { MicRecorder } from '@/audio/recorder'
import { RealtimeClient } from '@/realtime/client'
import { useAudioDevicesStore } from '@/stores/audioDevices'
import { useConnectionStore } from '@/stores/connection'
import { useEventLogStore } from '@/stores/eventlog'
import type { AudioEngineState } from '@/types/audio'

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

  const player = new Pcm16Player()
  const client = new RealtimeClient({ audioSink: player })
  const recorder = new MicRecorder()

  const micState = ref<AudioEngineState>('idle')
  const volume = ref(1)
  const supportsSinkSelection = player.supportsSinkSelection

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
    // A user gesture reached us, so unlock playback and route to the chosen sink.
    try {
      await player.resume()
    } catch {
      // Playback resumes on first audio delta if this is unavailable.
    }
    await applyOutputDevice()
    client.connect()
  }

  function disconnect(): void {
    void stopMic()
    client.disconnect()
    player.clear()
  }

  async function startMic(): Promise<void> {
    if (!connection.isConnected || micState.value === 'recording') {
      return
    }
    try {
      await player.resume()
    } catch {
      // Non-fatal; playback context resumes lazily.
    }
    await recorder.start({
      deviceId: devices.selectedInputId || undefined,
      onChunk: (base64Pcm16: string) => {
        client.sendAudioChunk(base64Pcm16)
      },
      onStateChange: (state: AudioEngineState) => {
        micState.value = state
      },
      onError: (error: Error) => {
        logError('audio.recorder.error', error.message)
        devices.setPermission('denied')
      },
    })
    if (recorder.state === 'recording') {
      devices.setPermission('granted')
      void devices.refreshDevices()
    }
  }

  async function stopMic(): Promise<void> {
    await recorder.stop()
    micState.value = 'idle'
  }

  async function toggleMic(): Promise<void> {
    if (micState.value === 'recording') {
      await stopMic()
    } else {
      await startMic()
    }
  }

  /** Manual turn mode: commit the buffered audio and ask for a response. */
  function commitAndRespond(): void {
    client.commitInput()
    client.createResponse()
  }

  function setVolume(value: number): void {
    volume.value = value
    player.setVolume(value)
  }

  watch(
    () => devices.selectedOutputId,
    () => {
      void applyOutputDevice()
    },
  )

  onScopeDispose(() => {
    void recorder.stop()
    player.dispose()
  })

  return {
    micState,
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
