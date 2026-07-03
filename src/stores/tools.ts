import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  type RealtimeToolSpec,
  type StubToolDefinition,
  type ToolInvocationRecord,
  createBlankTool,
} from '@/types/tools'
import { createId } from '@/utils/id'
import { isValidJson, safeParse } from '@/utils/json'
import { loadJson, saveJson } from '@/utils/storage'

const STORAGE_KEY = 'realtime-studio:tools:v1'
const MAX_INVOCATIONS = 500
const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/

export interface ToolValidation {
  nameValid: boolean
  parametersValid: boolean
  responseValid: boolean
  valid: boolean
}

/**
 * Manages user-defined **stub** tools. Definitions are persisted (non-secret
 * configuration); invocation history is in-memory only. Tools are never
 * executed — invocations are logged and answered with the user's canned JSON.
 */
export const useToolsStore = defineStore('tools', () => {
  const tools = ref<StubToolDefinition[]>(loadJson<StubToolDefinition[]>(STORAGE_KEY, []))
  const invocations = ref<ToolInvocationRecord[]>([])

  function validate(tool: StubToolDefinition): ToolValidation {
    const nameValid = TOOL_NAME_PATTERN.test(tool.name)
    const parametersValid = isValidJson(tool.parametersJson)
    const responseValid = isValidJson(tool.stubResponseJson)
    return {
      nameValid,
      parametersValid,
      responseValid,
      valid: nameValid && parametersValid && responseValid,
    }
  }

  const enabledTools = computed<StubToolDefinition[]>(() =>
    tools.value.filter((tool) => tool.enabled && validate(tool).valid),
  )

  /** Function-tool specs for `session.update`, built from enabled, valid tools. */
  const toolSpecs = computed<RealtimeToolSpec[]>(() =>
    enabledTools.value.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: safeParse<Record<string, unknown>>(tool.parametersJson, {}),
    })),
  )

  function addTool(): StubToolDefinition {
    const tool = createBlankTool(createId())
    tools.value.push(tool)
    return tool
  }

  function updateTool(id: string, patch: Partial<Omit<StubToolDefinition, 'id'>>): void {
    const tool = tools.value.find((candidate) => candidate.id === id)
    if (tool) {
      Object.assign(tool, patch)
    }
  }

  function removeTool(id: string): void {
    tools.value = tools.value.filter((tool) => tool.id !== id)
  }

  function toggleTool(id: string, enabled: boolean): void {
    updateTool(id, { enabled })
  }

  function findByName(name: string): StubToolDefinition | undefined {
    return tools.value.find((tool) => tool.name === name)
  }

  function recordInvocation(record: Omit<ToolInvocationRecord, 'id' | 'timestamp'>): ToolInvocationRecord {
    const entry: ToolInvocationRecord = {
      ...record,
      id: createId(),
      timestamp: Date.now(),
    }
    invocations.value.unshift(entry)
    if (invocations.value.length > MAX_INVOCATIONS) {
      invocations.value.length = MAX_INVOCATIONS
    }
    return entry
  }

  function clearInvocations(): void {
    invocations.value = []
  }

  watch(
    tools,
    (value) => {
      saveJson(STORAGE_KEY, value)
    },
    { deep: true },
  )

  return {
    tools,
    invocations,
    enabledTools,
    toolSpecs,
    validate,
    addTool,
    updateTool,
    removeTool,
    toggleTool,
    findByName,
    recordInvocation,
    clearInvocations,
  }
})
