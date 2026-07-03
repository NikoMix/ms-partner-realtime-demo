import { safeParse } from './json'

/**
 * Thin, defensive wrappers around localStorage. All access is guarded so the
 * app continues to function in private-mode browsers, during SSR, or in test
 * environments where storage may be unavailable or throw on write.
 *
 * SECURITY: Callers must never pass the API key or endpoint through these
 * helpers. Only non-secret preferences are persisted.
 */

function getStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null
    }
    return localStorage
  } catch {
    return null
  }
}

export function loadJson<T>(key: string, fallback: T): T {
  const storage = getStorage()
  if (!storage) {
    return fallback
  }
  const raw = storage.getItem(key)
  if (raw === null) {
    return fallback
  }
  return safeParse<T>(raw, fallback)
}

export function saveJson(key: string, value: unknown): void {
  const storage = getStorage()
  if (!storage) {
    return
  }
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore quota or serialization failures — persistence is best-effort.
  }
}

export function removeKey(key: string): void {
  const storage = getStorage()
  if (!storage) {
    return
  }
  try {
    storage.removeItem(key)
  } catch {
    // Ignore.
  }
}
