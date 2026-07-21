import { PROVIDER_DESCRIPTORS, type ProviderDescriptor, type RealtimeProvider } from './types'
import { redactUrl as redactUrlSecret } from '@/utils/redact'

export interface AzureRealtimeEndpoint {
  readonly endpoint: string
  readonly model: string | null
  readonly deployment: string | null
  readonly apiVersion: string | null
}

export function parseAzureRealtimeEndpoint(endpoint: string): AzureRealtimeEndpoint {
  const trimmed = endpoint.trim()
  if (trimmed.length === 0) {
    throw new Error('Realtime endpoint is required.')
  }

  const withScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    throw new Error('Realtime endpoint must be a valid URL.')
  }

  if ((parsed.protocol !== 'https:' && parsed.protocol !== 'wss:') || !parsed.hostname) {
    throw new Error('Azure Realtime endpoints must use HTTPS or WSS.')
  }
  if (parsed.username || parsed.password) {
    throw new Error('Realtime endpoint must not contain embedded credentials.')
  }

  return {
    endpoint: `${parsed.protocol}//${parsed.host}`,
    model: readQueryValue(parsed, 'model'),
    deployment: readQueryValue(parsed, 'deployment'),
    apiVersion: readQueryValue(parsed, 'api-version'),
  }
}

function readQueryValue(url: URL, name: string): string | null {
  const value = url.searchParams.get(name)?.trim()
  return value ? value : null
}

function toWebSocketEndpoint(endpoint: string): URL {
  const parsed = new URL(endpoint)
  if (parsed.protocol === 'https:') {
    parsed.protocol = 'wss:'
  }
  return parsed
}

function requireDeployment(deployment: string): string {
  const trimmed = deployment.trim()
  if (trimmed.length === 0) {
    throw new Error('Realtime deployment is required.')
  }
  return trimmed
}

function requireLegacyApiVersion(apiVersion: string): string {
  const trimmed = apiVersion.trim()
  if (trimmed.length === 0) {
    throw new Error('Legacy realtime connections require an API version.')
  }
  return trimmed
}

export function createAzureProvider(descriptor: ProviderDescriptor): RealtimeProvider {
  return {
    descriptor,
    buildRealtimeUrl(params) {
      const parsedEndpoint = parseAzureRealtimeEndpoint(params.endpoint)
      const endpoint = toWebSocketEndpoint(parsedEndpoint.endpoint)
      const deployment = requireDeployment(
        parsedEndpoint.model ?? parsedEndpoint.deployment ?? params.deployment,
      )

      endpoint.pathname = params.schema === 'ga' ? '/openai/v1/realtime' : '/openai/realtime'
      endpoint.search = ''
      endpoint.hash = ''

      if (params.schema === 'ga') {
        endpoint.searchParams.set('model', deployment)
      } else {
        endpoint.searchParams.set(
          'api-version',
          requireLegacyApiVersion(parsedEndpoint.apiVersion ?? params.apiVersion),
        )
        endpoint.searchParams.set('deployment', deployment)
      }
      endpoint.searchParams.set('api-key', params.apiKey)

      return endpoint.toString()
    },
    realtimeSubprotocols() {
      return []
    },
    redactUrl(url) {
      return redactUrlSecret(url)
    },
  }
}

export const azureFoundryProvider = createAzureProvider(PROVIDER_DESCRIPTORS['azure-foundry'])
export const azureOpenAIProvider = createAzureProvider(PROVIDER_DESCRIPTORS['azure-openai'])
