import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { EventDirection, EventLogEntry, EventLogInput, EventSeverity } from '@/types/eventlog'
import { createId } from '@/utils/id'

const MAX_ENTRIES = 2000

/**
 * In-memory ring buffer of every realtime socket event, tool call, and system
 * notice. Nothing here is persisted. Callers are responsible for redacting
 * secrets before appending (the connection engine does this at the boundary).
 */
export const useEventLogStore = defineStore('eventlog', () => {
  const entries = ref<EventLogEntry[]>([])
  const paused = ref(false)
  const search = ref('')
  const directionFilter = ref<EventDirection | 'all'>('all')
  const severityFilter = ref<EventSeverity | 'all'>('all')
  /** When true, high-frequency audio delta events are hidden from the view. */
  const hideAudioDeltas = ref(true)

  function add(input: EventLogInput): void {
    if (paused.value) {
      return
    }
    const entry: EventLogEntry = {
      id: createId(),
      timestamp: input.timestamp ?? Date.now(),
      direction: input.direction,
      severity: input.severity,
      type: input.type,
      summary: input.summary,
      detail: input.detail,
    }
    entries.value.push(entry)
    if (entries.value.length > MAX_ENTRIES) {
      entries.value.splice(0, entries.value.length - MAX_ENTRIES)
    }
  }

  function clear(): void {
    entries.value = []
  }

  const filtered = computed<EventLogEntry[]>(() => {
    const term = search.value.trim().toLowerCase()
    const dir = directionFilter.value
    const sev = severityFilter.value
    return entries.value.filter((entry) => {
      if (hideAudioDeltas.value && entry.type.includes('audio') && entry.type.includes('delta')) {
        return false
      }
      if (dir !== 'all' && entry.direction !== dir) {
        return false
      }
      if (sev !== 'all' && entry.severity !== sev) {
        return false
      }
      if (term.length > 0) {
        const haystack = `${entry.type} ${entry.summary} ${entry.detail ?? ''}`.toLowerCase()
        if (!haystack.includes(term)) {
          return false
        }
      }
      return true
    })
  })

  const counts = computed(() => {
    let inbound = 0
    let outbound = 0
    let errors = 0
    for (const entry of entries.value) {
      if (entry.direction === 'inbound') {
        inbound += 1
      } else if (entry.direction === 'outbound') {
        outbound += 1
      }
      if (entry.severity === 'error') {
        errors += 1
      }
    }
    return { total: entries.value.length, inbound, outbound, errors }
  })

  return {
    entries,
    paused,
    search,
    directionFilter,
    severityFilter,
    hideAudioDeltas,
    filtered,
    counts,
    add,
    clear,
  }
})
