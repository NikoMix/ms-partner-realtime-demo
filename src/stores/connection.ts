import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'closing'
  | 'closed'
  | 'error'

/**
 * Tracks the lifecycle of the realtime WebSocket connection. The realtime
 * engine (WS2) mutates this store as socket events occur; the UI reads it to
 * render connection status and enable/disable controls.
 */
export const useConnectionStore = defineStore('connection', () => {
  const status = ref<ConnectionStatus>('idle')
  const errorMessage = ref<string | null>(null)
  const connectedAt = ref<number | null>(null)
  const closedAt = ref<number | null>(null)
  const lastCloseCode = ref<number | null>(null)
  const lastCloseReason = ref<string>('')
  /** Redacted (api-key masked) URL currently in use, for display only. */
  const currentUrlRedacted = ref<string>('')
  /** Session id reported by the server `session.created` event. */
  const sessionId = ref<string | null>(null)
  /** True while the model is generating a response. */
  const responseInProgress = ref(false)
  /** True while the server has detected active user speech (VAD). */
  const userSpeaking = ref(false)

  const isConnected = computed(() => status.value === 'connected')
  const isConnecting = computed(() => status.value === 'connecting')
  const isActive = computed(
    () => status.value === 'connecting' || status.value === 'connected' || status.value === 'closing',
  )

  function setConnecting(urlRedacted: string): void {
    status.value = 'connecting'
    errorMessage.value = null
    currentUrlRedacted.value = urlRedacted
    connectedAt.value = null
    closedAt.value = null
    sessionId.value = null
  }

  function setConnected(): void {
    status.value = 'connected'
    connectedAt.value = Date.now()
  }

  function setClosing(): void {
    status.value = 'closing'
  }

  function setClosed(code: number | null, reason: string): void {
    status.value = 'closed'
    closedAt.value = Date.now()
    lastCloseCode.value = code
    lastCloseReason.value = reason
    responseInProgress.value = false
    userSpeaking.value = false
  }

  function setError(message: string): void {
    status.value = 'error'
    errorMessage.value = message
    responseInProgress.value = false
    userSpeaking.value = false
  }

  function setSessionId(id: string): void {
    sessionId.value = id
  }

  function reset(): void {
    status.value = 'idle'
    errorMessage.value = null
    connectedAt.value = null
    closedAt.value = null
    lastCloseCode.value = null
    lastCloseReason.value = ''
    currentUrlRedacted.value = ''
    sessionId.value = null
    responseInProgress.value = false
    userSpeaking.value = false
  }

  return {
    status,
    errorMessage,
    connectedAt,
    closedAt,
    lastCloseCode,
    lastCloseReason,
    currentUrlRedacted,
    sessionId,
    responseInProgress,
    userSpeaking,
    isConnected,
    isConnecting,
    isActive,
    setConnecting,
    setConnected,
    setClosing,
    setClosed,
    setError,
    setSessionId,
    reset,
  }
})
