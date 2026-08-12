const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

function normalizePath(path: string): string[] | null {
  const segments = path
    .trim()
    .replace(/^\$\.?/, '')
    .replace(/\[([0-9]+)\]/g, '.$1')
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean)

  return segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment)) ? null : segments
}

export function getValueAtPath(source: unknown, path: string): unknown {
  const segments = normalizePath(path)
  if (segments === null) return undefined
  if (segments.length === 0) return source

  return segments.reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[segment]
  }, source)
}

export function stringifyExtractedValue(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}
