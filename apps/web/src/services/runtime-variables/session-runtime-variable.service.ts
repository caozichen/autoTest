import type { RuntimeVariable, RuntimeVariableDraft } from '@/domain/runtime-variable'
import type { RuntimeVariableService } from './runtime-variable-service'

const STORAGE_KEY = 'autotest.runtime-variables.v1'
const VARIABLE_PATTERN = /{{\s*([^{}]+?)\s*}}/g

function defaultStorage(): Storage {
  if (typeof window === 'undefined') {
    throw new Error('Session storage is unavailable outside the browser')
  }
  return window.sessionStorage
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function normalizeVariable(value: unknown): RuntimeVariable | null {
  if (!isRecord(value)) return null
  if (
    typeof value.key !== 'string' ||
    typeof value.value !== 'string' ||
    typeof value.secret !== 'boolean' ||
    (value.authorizationScheme !== undefined && typeof value.authorizationScheme !== 'string') ||
    typeof value.sourceEnvironmentId !== 'string' ||
    typeof value.sourcePath !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) return null

  const key = value.key.trim()
  if (!key) return null

  return {
    key,
    value: value.value,
    secret: value.secret,
    ...(value.authorizationScheme === undefined
      ? {}
      : { authorizationScheme: value.authorizationScheme }),
    sourceEnvironmentId: value.sourceEnvironmentId,
    sourcePath: value.sourcePath,
    updatedAt: value.updatedAt,
  }
}

export class SessionRuntimeVariableService implements RuntimeVariableService {
  private readonly variables = new Map<string, RuntimeVariable>()

  constructor(
    private readonly storage: Storage = defaultStorage(),
    private readonly now: () => Date = () => new Date(),
  ) {
    this.restore()
  }

  upsert(draft: RuntimeVariableDraft): RuntimeVariable {
    const key = draft.key.trim()
    if (!key) throw new Error('Runtime variable key cannot be empty')

    const variable: RuntimeVariable = {
      key,
      value: draft.value,
      secret: draft.secret,
      ...(draft.authorizationScheme === undefined
        ? {}
        : { authorizationScheme: draft.authorizationScheme.trim() }),
      sourceEnvironmentId: draft.sourceEnvironmentId,
      sourcePath: draft.sourcePath,
      updatedAt: this.now().toISOString(),
    }

    this.variables.set(key, variable)
    this.persist()
    return structuredClone(variable)
  }

  get(key: string): RuntimeVariable | null {
    const variable = this.variables.get(key.trim())
    return variable ? structuredClone(variable) : null
  }

  list(): RuntimeVariable[] {
    return [...this.variables.values()].map((variable) => structuredClone(variable))
  }

  clear(): void {
    this.variables.clear()
    try {
      this.storage.removeItem(STORAGE_KEY)
    } catch {
      // The in-memory values are cleared even when browser storage is unavailable.
    }
  }

  resolve(template: string): string {
    return template.replace(VARIABLE_PATTERN, (placeholder, rawKey: string) => {
      return this.variables.get(rawKey.trim())?.value ?? placeholder
    })
  }

  buildAuthorizationHeader(tokenKey: string, tokenType = 'Bearer'): string | null {
    const variable = this.get(tokenKey)
    if (!variable) return null
    const value = variable.value.trim()
    if (!value) return null
    const scheme = variable.authorizationScheme?.trim() || tokenType.trim() || 'Bearer'
    return `${scheme} ${value}`
  }

  private restore(): void {
    let raw: string | null
    try {
      raw = this.storage.getItem(STORAGE_KEY)
    } catch {
      return
    }
    if (!raw) return

    let stored: unknown
    try {
      stored = JSON.parse(raw) as unknown
    } catch {
      return
    }
    if (!Array.isArray(stored)) return

    for (const item of stored) {
      const variable = normalizeVariable(item)
      if (variable) this.variables.set(variable.key, variable)
    }
  }

  private persist(): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify([...this.variables.values()]))
    } catch {
      // Keep the current in-memory values when browser storage is unavailable.
    }
  }
}
