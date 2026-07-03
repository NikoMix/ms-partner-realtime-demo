/**
 * Stub tool definitions.
 *
 * Users can register function tools that the realtime model may call. For safety
 * this app NEVER executes real code or contacts external MCP servers — a tool
 * "call" is logged and answered with a user-authored canned JSON payload only.
 */

export interface StubToolDefinition {
  id: string
  /** Function name advertised to the model (must match `^[a-zA-Z0-9_-]+$`). */
  name: string
  description: string
  /** Raw JSON Schema text for the tool parameters, as edited by the user. */
  parametersJson: string
  /** Canned JSON returned as the `function_call_output` when the tool is invoked. */
  stubResponseJson: string
  enabled: boolean
}

/** A record of a single (stubbed) tool invocation for the event log / tools panel. */
export interface ToolInvocationRecord {
  id: string
  toolName: string
  callId: string
  argumentsJson: string
  responseJson: string
  timestamp: number
  matchedDefinitionId: string | null
}

/** The function-tool spec sent to the service inside `session.update`. */
export interface RealtimeToolSpec {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** A newly-created, blank tool definition (id supplied by the store). */
export function createBlankTool(id: string): StubToolDefinition {
  return {
    id,
    name: 'get_weather',
    description: 'Return the current weather for a location. (Stub — returns canned data.)',
    parametersJson: JSON.stringify(
      {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name, e.g. "Seattle"' },
        },
        required: ['location'],
      },
      null,
      2,
    ),
    stubResponseJson: JSON.stringify(
      { temperature_c: 18, condition: 'Partly cloudy', note: 'Stubbed response — no real data.' },
      null,
      2,
    ),
    enabled: true,
  }
}
