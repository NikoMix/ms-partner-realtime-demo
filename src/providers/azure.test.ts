import { describe, expect, it } from 'vitest'

import { azureFoundryProvider, parseAzureRealtimeEndpoint } from './azure'
import { githubModelsProvider } from './github-models'
import type { RealtimeConnectionParams } from './types'

function params(patch: Partial<RealtimeConnectionParams> = {}): RealtimeConnectionParams {
  return {
    endpoint: 'https://example.openai.azure.com/',
    deployment: 'gpt realtime',
    apiKey: 'super-secret-key',
    apiVersion: '2025-04-01-preview',
    schema: 'ga',
    ...patch,
  }
}

describe('azure realtime provider', () => {
  it('builds GA realtime URLs with model and api-key query params', () => {
    const url = new URL(azureFoundryProvider.buildRealtimeUrl(params()))

    expect(url.protocol).toBe('wss:')
    expect(url.pathname).toBe('/openai/v1/realtime')
    expect(url.searchParams.get('model')).toBe('gpt realtime')
    expect(url.searchParams.get('api-key')).toBe('super-secret-key')
  })

  it('builds legacy realtime URLs with api-version, deployment, and api-key', () => {
    const url = new URL(
      azureFoundryProvider.buildRealtimeUrl(
        params({ schema: 'legacy', deployment: 'legacy-model' }),
      ),
    )

    expect(url.pathname).toBe('/openai/realtime')
    expect(url.searchParams.get('api-version')).toBe('2025-04-01-preview')
    expect(url.searchParams.get('deployment')).toBe('legacy-model')
    expect(url.searchParams.get('api-key')).toBe('super-secret-key')
  })

  it('converts https endpoints to wss and handles trailing slashes', () => {
    const url = azureFoundryProvider.buildRealtimeUrl(
      params({ endpoint: 'https://example.openai.azure.com///', deployment: 'gpt-realtime' }),
    )

    expect(url).toContain('wss://example.openai.azure.com/openai/v1/realtime')
  })

  it('normalizes a portal realtime URI and reads its model', () => {
    expect(
      parseAzureRealtimeEndpoint(
        'https://mixn-moa844yd-swedencentral.cognitiveservices.azure.com/openai/v1/realtime?model=gpt-realtime-2',
      ),
    ).toEqual({
      endpoint: 'https://mixn-moa844yd-swedencentral.cognitiveservices.azure.com',
      model: 'gpt-realtime-2',
      deployment: null,
      apiVersion: null,
    })
  })

  it('prefers the model embedded in a full portal realtime URI', () => {
    const url = new URL(
      azureFoundryProvider.buildRealtimeUrl(
        params({
          endpoint: 'https://example.openai.azure.com/openai/v1/realtime?model=gpt-realtime-2',
          deployment: 'gpt-realtime',
        }),
      ),
    )

    expect(url.searchParams.get('model')).toBe('gpt-realtime-2')
  })

  it('defaults endpoints without a scheme to wss', () => {
    const url = new URL(
      azureFoundryProvider.buildRealtimeUrl(
        params({ endpoint: 'example.openai.azure.com', deployment: 'gpt-realtime' }),
      ),
    )

    expect(url.protocol).toBe('wss:')
  })

  it.each(['http', 'ws'])(
    'rejects plaintext %s endpoints that would expose the API key',
    (protocol) => {
      const endpoint = `${protocol}://example.openai.azure.com`
      expect(() => azureFoundryProvider.buildRealtimeUrl(params({ endpoint }))).toThrow(
        'Azure Realtime endpoints must use HTTPS or WSS.',
      )
    },
  )

  it('throws when deployment is empty', () => {
    expect(() => azureFoundryProvider.buildRealtimeUrl(params({ deployment: '   ' }))).toThrow(
      'Realtime deployment is required.',
    )
  })

  it('redacts api-key query params', () => {
    const redacted = azureFoundryProvider.redactUrl(
      azureFoundryProvider.buildRealtimeUrl(params({ deployment: 'gpt-realtime' })),
    )

    expect(redacted).not.toContain('super-secret-key')
    expect(redacted).toContain('api-key=***redacted***')
  })
})

describe('github models provider', () => {
  it('throws because realtime audio is unsupported', () => {
    expect(() => githubModelsProvider.buildRealtimeUrl(params())).toThrow(
      'GitHub Models does not support realtime audio streaming.',
    )
  })
})
