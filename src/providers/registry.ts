import { azureFoundryProvider, azureOpenAIProvider } from './azure'
import { githubModelsProvider } from './github-models'
import type { ProviderId, RealtimeProvider } from './types'

export function getProvider(id: ProviderId): RealtimeProvider {
  switch (id) {
    case 'azure-foundry':
      return azureFoundryProvider
    case 'azure-openai':
      return azureOpenAIProvider
    case 'github-models':
      return githubModelsProvider
  }

  const exhaustive: never = id
  return exhaustive
}
