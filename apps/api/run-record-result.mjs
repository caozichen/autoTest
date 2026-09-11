import { sanitizeErrorMessage } from './script-runner.mjs'

const sensitiveKey = /authorization|token|password|passwd|secret|cookie|verify[_-]?code|mobile|credential|session|api[_-]?key/i

// Frontend-independent history persistence must apply redaction too. Never persist
// the request context (login headers/variables) alongside an execution receipt.
export function redactRunRecordResult(result, context = {}, additionalSecrets = []) {
  const secrets = [...additionalSecrets].filter(Boolean)
  function collect(value, key = '') {
    if (typeof value === 'string' && sensitiveKey.test(key) && value) secrets.push(value)
    else if (value && typeof value === 'object') {
      for (const [name, entry] of Object.entries(value)) collect(entry, name)
    }
  }
  collect(context)
  function redact(value, key = '') {
    if (sensitiveKey.test(key)) return '[REDACTED]'
    if (typeof value === 'string') return sanitizeErrorMessage(value, secrets).replace(/\bBearer\s+[^\s"',;}\]]+/gi, 'Bearer [REDACTED]')
    if (Array.isArray(value)) return value.map((item) => redact(item))
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, redact(entry, name)]))
  }
  return redact(result)
}
