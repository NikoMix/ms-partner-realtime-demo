import type { RealtimeSchema } from '@/models/catalog'

/**
 * Provider layer contract. Each inference provider (Azure AI Foundry, Azure
 * OpenAI, GitHub Models) implements {@link RealtimeProvider} to describe itself
 * and to build the realtime WebSocket URL. Keeping this behind an interface lets
 * the app support modular inference back-ends without leaking provider-specific
 * URL logic into the UI or the realtime engine.
 */

export const PROVIDER_IDS = ['azure-foundry', 'azure-openai', 'github-models'] as const
export type ProviderId = (typeof PROVIDER_IDS)[number]

export const DEFAULT_PROVIDER_ID: ProviderId = 'azure-foundry'

export interface ProviderDescriptor {
  readonly id: ProviderId
  readonly label: string
  readonly description: string
  /** Whether the provider exposes a realtime audio WebSocket endpoint. */
  readonly supportsRealtimeAudio: boolean
  readonly endpointPlaceholder: string
  readonly endpointHelp: string
  readonly keyHelp: string
  readonly docsUrl: string
}

/**
 * Everything the provider needs to construct a realtime connection. The
 * `apiKey` is held in memory only and is embedded as the `api-key` query
 * parameter because browser WebSockets cannot set request headers.
 */
export interface RealtimeConnectionParams {
  readonly endpoint: string
  readonly deployment: string
  readonly apiKey: string
  readonly apiVersion: string
  readonly schema: RealtimeSchema
}

export interface RealtimeProvider {
  readonly descriptor: ProviderDescriptor
  /**
   * Builds the full realtime WebSocket URL including the api-key query param.
   * Throws if the provider does not support realtime audio.
   */
  buildRealtimeUrl(params: RealtimeConnectionParams): string
  /** Optional WebSocket subprotocols. */
  realtimeSubprotocols(params: RealtimeConnectionParams): string[]
  /** Returns a display-safe copy of a URL with secrets masked. */
  redactUrl(url: string): string
}

export const PROVIDER_DESCRIPTORS: Readonly<Record<ProviderId, ProviderDescriptor>> = {
  'azure-foundry': {
    id: 'azure-foundry',
    label: 'Azure AI Foundry',
    description:
      'Connect to a realtime model deployed in an Azure AI Foundry project. Supports the full realtime audio protocol.',
    supportsRealtimeAudio: true,
    endpointPlaceholder: 'https://<resource>.openai.azure.com',
    endpointHelp:
      'Your Azure AI Foundry / Azure OpenAI resource endpoint. The deployment name is set separately below.',
    keyHelp:
      'API key for the resource. Held only in memory for this session — never stored, logged, or sent anywhere except your chosen endpoint.',
    docsUrl: 'https://learn.microsoft.com/azure/ai-services/openai/how-to/realtime-audio',
  },
  'azure-openai': {
    id: 'azure-openai',
    label: 'Azure OpenAI',
    description:
      'Connect directly to an Azure OpenAI resource realtime deployment. Supports the full realtime audio protocol.',
    supportsRealtimeAudio: true,
    endpointPlaceholder: 'https://<resource>.openai.azure.com',
    endpointHelp:
      'Your Azure OpenAI resource endpoint. Provide the realtime deployment name separately below.',
    keyHelp:
      'API key for the resource. Held only in memory for this session — never stored, logged, or sent anywhere except your chosen endpoint.',
    docsUrl:
      'https://learn.microsoft.com/azure/ai-services/openai/how-to/realtime-audio-websockets',
  },
  'github-models': {
    id: 'github-models',
    label: 'GitHub Models',
    description:
      'GitHub Models offers REST inference only. Realtime audio streaming is not available, so audio controls are disabled for this provider.',
    supportsRealtimeAudio: false,
    endpointPlaceholder: 'https://models.github.ai/inference',
    endpointHelp:
      'GitHub Models inference endpoint. Note: realtime audio is not supported by this provider.',
    keyHelp:
      'GitHub token with the models scope. Held only in memory for this session — never stored or logged.',
    docsUrl: 'https://docs.github.com/github-models',
  },
}

export const PROVIDER_LIST: readonly ProviderDescriptor[] = PROVIDER_IDS.map(
  (id) => PROVIDER_DESCRIPTORS[id],
)

export function getProviderDescriptor(id: ProviderId): ProviderDescriptor {
  return PROVIDER_DESCRIPTORS[id]
}
