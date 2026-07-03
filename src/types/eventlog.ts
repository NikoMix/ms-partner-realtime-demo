/** Direction of a logged realtime event relative to this client. */
export type EventDirection = 'outbound' | 'inbound' | 'system'

export type EventSeverity = 'info' | 'success' | 'warning' | 'error'

/**
 * A single entry in the socket event log. `payload` is always redaction-safe:
 * the API key is masked before an entry is ever created.
 */
export interface EventLogEntry {
  id: string
  timestamp: number
  direction: EventDirection
  severity: EventSeverity
  /** Raw event type (e.g. `response.audio.delta`) or a system category. */
  type: string
  /** Short human-readable one-line summary. */
  summary: string
  /** Optional pretty-printed, redacted JSON body. */
  detail?: string
}

/** Fields required to append an entry; id and timestamp are filled in by the store. */
export type EventLogInput = Omit<EventLogEntry, 'id' | 'timestamp'> & {
  timestamp?: number
}
