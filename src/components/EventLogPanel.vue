<script setup lang="ts">
import { computed } from 'vue'
import PanelCard from '@/components/ui/PanelCard.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { useEventLogStore } from '@/stores/eventlog'
import type { EventDirection, EventSeverity } from '@/types/eventlog'

const log = useEventLogStore()

const DIRECTION_OPTIONS: { value: EventDirection | 'all'; label: string }[] = [
  { value: 'all', label: 'All directions' },
  { value: 'outbound', label: 'Outbound ↑' },
  { value: 'inbound', label: 'Inbound ↓' },
  { value: 'system', label: 'System' },
]

const SEVERITY_OPTIONS: { value: EventSeverity | 'all'; label: string }[] = [
  { value: 'all', label: 'All severities' },
  { value: 'info', label: 'Info' },
  { value: 'success', label: 'Success' },
  { value: 'warning', label: 'Warning' },
  { value: 'error', label: 'Error' },
]

// Newest first for readability.
const rows = computed(() => log.filtered.slice().reverse())

const directionSymbol: Record<EventDirection, string> = {
  outbound: '↑',
  inbound: '↓',
  system: '•',
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour12: false })
}
</script>

<template>
  <PanelCard title="Event log" subtitle="Every socket event, tool call, and system notice. API keys are always redacted.">
    <template #actions>
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        :disabled="log.counts.total === 0"
        @click="log.clear"
      >
        Clear
      </button>
    </template>

    <div class="filters">
      <input
        id="event-log-search"
        v-model="log.search"
        name="event-log-search"
        type="search"
        class="search"
        placeholder="Filter by type or text…"
        aria-label="Filter events by type or text"
        spellcheck="false"
      />
      <select
        id="event-log-direction"
        v-model="log.directionFilter"
        name="event-log-direction"
        aria-label="Direction filter"
      >
        <option v-for="opt in DIRECTION_OPTIONS" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
      <select
        id="event-log-severity"
        v-model="log.severityFilter"
        name="event-log-severity"
        aria-label="Severity filter"
      >
        <option v-for="opt in SEVERITY_OPTIONS" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
    </div>

    <div class="toggles">
      <ToggleSwitch v-model="log.hideAudioDeltas" label="Hide audio deltas" />
      <ToggleSwitch v-model="log.paused" label="Pause capture" />
    </div>

    <div class="counts text-xs text-subtle">
      <span>{{ log.counts.total }} total</span>
      <span>↑ {{ log.counts.outbound }}</span>
      <span>↓ {{ log.counts.inbound }}</span>
      <span :class="{ 'has-errors': log.counts.errors > 0 }">{{ log.counts.errors }} errors</span>
    </div>

    <p v-if="rows.length === 0" class="text-sm text-muted empty">
      No events match the current filters.
    </p>

    <ol v-else class="events">
      <li v-for="entry in rows" :key="entry.id" class="event" :class="`sev-${entry.severity}`">
        <details>
          <summary>
            <span class="ev-dir" :class="`dir-${entry.direction}`">
              {{ directionSymbol[entry.direction] }}
            </span>
            <span class="ev-time mono text-xs">{{ formatTime(entry.timestamp) }}</span>
            <span class="ev-type mono">{{ entry.type }}</span>
            <span class="ev-summary text-sm">{{ entry.summary }}</span>
          </summary>
          <pre v-if="entry.detail" class="mono">{{ entry.detail }}</pre>
        </details>
      </li>
    </ol>
  </PanelCard>
</template>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.search {
  flex: 1;
  min-width: 180px;
}

.filters select {
  width: auto;
  flex: 0 0 auto;
}

.toggles {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-5);
}

.counts {
  display: flex;
  gap: var(--space-4);
  font-weight: 600;
}

.has-errors {
  color: var(--danger);
}

.empty {
  padding: var(--space-3) 0;
}

.events {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 32rem;
  overflow-y: auto;
}

.event {
  border-left: 3px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}

.sev-success {
  border-left-color: var(--success);
}
.sev-warning {
  border-left-color: var(--warning);
}
.sev-error {
  border-left-color: var(--danger);
  background: color-mix(in srgb, var(--danger) 8%, var(--surface-2));
}
.sev-info {
  border-left-color: var(--info);
}

summary {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
}

.ev-dir {
  font-weight: 700;
  flex-shrink: 0;
}

.dir-outbound {
  color: var(--accent);
}
.dir-inbound {
  color: var(--success);
}
.dir-system {
  color: var(--text-subtle);
}

.ev-time {
  color: var(--text-subtle);
  flex-shrink: 0;
}

.ev-type {
  font-weight: 600;
  flex-shrink: 0;
}

.ev-summary {
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
}

pre {
  margin: 0;
  padding: var(--space-3);
  background: var(--bg-elevated);
  border-top: 1px solid var(--border);
  font-size: var(--text-xs);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
