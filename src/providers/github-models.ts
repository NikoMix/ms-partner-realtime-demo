import { PROVIDER_DESCRIPTORS, type RealtimeProvider } from './types'
import { redactUrl as redactUrlSecret } from '@/utils/redact'

export const githubModelsProvider: RealtimeProvider = {
  descriptor: PROVIDER_DESCRIPTORS['github-models'],
  buildRealtimeUrl() {
    throw new Error('GitHub Models does not support realtime audio streaming.')
  },
  realtimeSubprotocols() {
    return []
  },
  redactUrl(url) {
    return redactUrlSecret(url)
  },
}
