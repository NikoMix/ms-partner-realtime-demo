/**
 * Secret redaction helpers. The application never persists or logs the API key,
 * but URLs and diagnostic strings can still incidentally contain it (for example
 * the realtime WebSocket URL carries the key as the `api-key` query parameter for
 * browser authentication). These helpers guarantee secrets are masked before any
 * value reaches the on-screen event log.
 */

const REDACTED = '***redacted***'
const SENSITIVE_QUERY_PARAMS = ['api-key', 'apikey', 'key', 'access_token', 'token']

/** Masks sensitive query-string parameters (e.g. `api-key`) in a URL. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url)
    let mutated = false
    for (const param of SENSITIVE_QUERY_PARAMS) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, REDACTED)
        mutated = true
      }
    }
    return mutated ? parsed.toString() : url
  } catch {
    return redactSensitiveQueryString(url)
  }
}

function redactSensitiveQueryString(value: string): string {
  return value.replace(
    /((?:api-key|apikey|key|access_token|token)=)[^&\s"']+/gi,
    `$1${REDACTED}`,
  )
}

/**
 * Replaces every occurrence of each provided secret with a redaction marker.
 * Empty or whitespace-only secrets are ignored to avoid masking the entire string.
 */
export function redactSecrets(value: string, secrets: readonly string[]): string {
  let result = value
  for (const secret of secrets) {
    const trimmed = secret.trim()
    if (trimmed.length < 4) {
      continue
    }
    result = result.split(secret).join(REDACTED)
  }
  return result
}
