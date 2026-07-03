import { PROVIDER_DESCRIPTORS, type ProviderDescriptor, type RealtimeProvider } from './types'
import { redactUrl as redactUrlSecret } from '@/utils/redact'

function normaliseEndpoint(endpoint: string): URL {
  const trimmed = stripTrailingSlashes(endpoint.trim())
  if (trimmed.length === 0) {
    throw new Error('Realtime endpoint is required.')
  }

  const withScheme = trimmed.includes('://') ? trimmed : `wss://${trimmed}`
  const lowerCaseEndpoint = withScheme.toLowerCase()
  let websocketEndpoint = withScheme
  if (lowerCaseEndpoint.startsWith('https://')) {
    websocketEndpoint = `wss://${withScheme.slice('https://'.length)}`
  } else if (lowerCaseEndpoint.startsWith('http://')) {
    websocketEndpoint = `ws://${withScheme.slice('http://'.length)}`
  }

  try {
    return new URL(websocketEndpoint)
  } catch {
    throw new Error('Realtime endpoint must be a valid URL.')
  }
}

function stripTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value.charAt(end - 1) === '/') {
    end -= 1
  }
  return value.slice(0, end)
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
      const endpoint = normaliseEndpoint(params.endpoint)
      const deployment = requireDeployment(params.deployment)

      endpoint.pathname = params.schema === 'ga' ? '/openai/v1/realtime' : '/openai/realtime'
      endpoint.search = ''
      endpoint.hash = ''

      if (params.schema === 'ga') {
        endpoint.searchParams.set('model', deployment)
      } else {
        endpoint.searchParams.set('api-version', requireLegacyApiVersion(params.apiVersion))
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
