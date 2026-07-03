/**
 * Generates a reasonably unique identifier. Prefers the platform crypto UUID
 * generator, then a crypto random-bytes fallback, and finally a timestamp-only
 * value for environments without Web Crypto (never using a weak PRNG).
 */
export function createId(): string {
  const webCrypto = typeof crypto !== 'undefined' ? crypto : undefined
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID()
  }
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  return `id-${Date.now().toString(36)}`
}
