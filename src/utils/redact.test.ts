import { describe, expect, it } from 'vitest'

import { redactSecrets, redactUrl } from './redact'

describe('redactUrl', () => {
  it('masks the api-key query parameter', () => {
    const redacted = redactUrl('wss://example.openai.azure.com/openai/v1/realtime?model=m&api-key=supersecret')
    expect(redacted).not.toContain('supersecret')
    expect(redacted).toContain('api-key=***redacted***')
    expect(redacted).toContain('model=m')
  })

  it('masks sensitive params even when the string is not a valid URL', () => {
    const redacted = redactUrl('not a url but api-key=abcd1234 here')
    expect(redacted).not.toContain('abcd1234')
    expect(redacted).toContain('***redacted***')
  })

  it('returns the original string when there is nothing sensitive', () => {
    const url = 'https://example.com/path?foo=bar'
    expect(redactUrl(url)).toBe(url)
  })
})

describe('redactSecrets', () => {
  it('replaces every occurrence of a secret', () => {
    const result = redactSecrets('key=SECRETVALUE and again SECRETVALUE', ['SECRETVALUE'])
    expect(result).not.toContain('SECRETVALUE')
    expect(result.match(/\*\*\*redacted\*\*\*/g)).toHaveLength(2)
  })

  it('ignores secrets shorter than four characters to avoid over-masking', () => {
    const input = 'the quick brown fox'
    expect(redactSecrets(input, ['a', '   '])).toBe(input)
  })
})
