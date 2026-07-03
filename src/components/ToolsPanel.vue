<script setup lang="ts">
import PanelCard from '@/components/ui/PanelCard.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { useToolsStore } from '@/stores/tools'
import type { StubToolDefinition } from '@/types/tools'

const tools = useToolsStore()

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString()
}

function onAddTool(): void {
  tools.addTool()
}

function validationFor(tool: StubToolDefinition) {
  return tools.validate(tool)
}
</script>

<template>
  <PanelCard
    title="Tools (stubs only)"
    subtitle="Advertise function tools to the model. Calls are logged and answered with your canned JSON — no code or external service ever runs."
  >
    <template #actions>
      <button type="button" class="btn btn-sm" @click="onAddTool">Add tool</button>
    </template>

    <p v-if="tools.tools.length === 0" class="text-sm text-muted empty">
      No tools defined. Add one to let the model issue (stubbed) function calls.
    </p>

    <ul class="tool-list">
      <li v-for="tool in tools.tools" :key="tool.id" class="tool-item">
        <div class="tool-head">
          <input
            v-model="tool.name"
            class="tool-name"
            type="text"
            spellcheck="false"
            placeholder="function_name"
            :aria-invalid="!validationFor(tool).nameValid"
          />
          <ToggleSwitch v-model="tool.enabled" label="Enabled" />
          <button type="button" class="btn btn-ghost btn-sm" @click="tools.removeTool(tool.id)">
            Remove
          </button>
        </div>

        <input
          v-model="tool.description"
          class="tool-desc"
          type="text"
          placeholder="What this tool does (shown to the model)"
        />

        <div class="grid-2">
          <label class="json-field">
            <span class="json-label text-xs text-muted">Parameters (JSON Schema)</span>
            <textarea
              v-model="tool.parametersJson"
              rows="6"
              spellcheck="false"
              :aria-invalid="!validationFor(tool).parametersValid"
            />
            <span v-if="!validationFor(tool).parametersValid" class="err text-xs">
              Invalid JSON
            </span>
          </label>
          <label class="json-field">
            <span class="json-label text-xs text-muted">Stub response (JSON)</span>
            <textarea
              v-model="tool.stubResponseJson"
              rows="6"
              spellcheck="false"
              :aria-invalid="!validationFor(tool).responseValid"
            />
            <span v-if="!validationFor(tool).responseValid" class="err text-xs">Invalid JSON</span>
          </label>
        </div>

        <p v-if="!validationFor(tool).nameValid" class="err text-xs">
          Name must match <code>^[a-zA-Z0-9_-]{1,64}$</code>.
        </p>
      </li>
    </ul>

    <div class="invocations">
      <div class="invocations-head">
        <h3 class="text-sm">Invocations ({{ tools.invocations.length }})</h3>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="tools.invocations.length === 0"
          @click="tools.clearInvocations"
        >
          Clear
        </button>
      </div>

      <p v-if="tools.invocations.length === 0" class="text-xs text-subtle">
        No tool calls yet.
      </p>

      <ul v-else class="invocation-list">
        <li v-for="record in tools.invocations" :key="record.id" class="invocation">
          <details>
            <summary>
              <span class="mono">{{ record.toolName }}</span>
              <span class="text-xs text-subtle">{{ formatTime(record.timestamp) }}</span>
              <span v-if="!record.matchedDefinitionId" class="badge badge-warning">unmatched</span>
            </summary>
            <div class="invocation-body">
              <p class="text-xs text-muted">call_id: <span class="mono">{{ record.callId }}</span></p>
              <p class="text-xs text-muted">Arguments</p>
              <pre class="mono">{{ record.argumentsJson }}</pre>
              <p class="text-xs text-muted">Stub response</p>
              <pre class="mono">{{ record.responseJson }}</pre>
            </div>
          </details>
        </li>
      </ul>
    </div>
  </PanelCard>
</template>

<style scoped>
.empty {
  padding: var(--space-3) 0;
}

.tool-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.tool-item {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-2);
}

.tool-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.tool-name {
  flex: 1;
  font-family: var(--font-mono);
  font-weight: 700;
}

.grid-2 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-4);
}

.json-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.json-label {
  font-weight: 600;
}

.err {
  color: var(--danger);
  font-weight: 600;
}

[aria-invalid='true'] {
  border-color: var(--danger);
}

.invocations {
  border-top: 1px solid var(--border);
  padding-top: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.invocations-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.invocation-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.invocation {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-3);
  background: var(--bg-inset);
}

summary {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  cursor: pointer;
}

.invocation-body {
  margin-top: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

pre {
  margin: 0;
  padding: var(--space-2);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
