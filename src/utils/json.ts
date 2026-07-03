/**
 * JSON helpers that are safe against circular references and serialization
 * failures. Used to render arbitrary socket payloads in the event log without
 * risking a thrown exception breaking the UI.
 */

/** Serializes a value to pretty JSON, tolerating circular references. */
export function safeStringify(value: unknown, space = 2): string {
  const seen = new WeakSet<object>()
  try {
    return JSON.stringify(
      value,
      (_key, val: unknown) => {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) {
            return '[Circular]'
          }
          seen.add(val)
        }
        if (typeof val === 'bigint') {
          return val.toString()
        }
        return val
      },
      space,
    )
  } catch {
    return String(value)
  }
}

/** Parses JSON, returning the provided fallback on any failure. */
export function safeParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** Returns true when the provided string is valid JSON. */
export function isValidJson(raw: string): boolean {
  if (raw.trim().length === 0) {
    return false
  }
  try {
    JSON.parse(raw)
    return true
  } catch {
    return false
  }
}
