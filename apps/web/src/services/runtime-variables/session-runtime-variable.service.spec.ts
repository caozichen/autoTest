import { describe, expect, it } from 'vitest'

import { SessionRuntimeVariableService } from './session-runtime-variable.service'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

const firstUpdate = new Date('2026-08-12T01:00:00.000Z')
const secondUpdate = new Date('2026-08-12T02:00:00.000Z')

function tokenDraft(value: string) {
  return {
    key: 'AUTH_TOKEN',
    value,
    secret: true,
    sourceEnvironmentId: 'env-testing',
    sourcePath: 'data.token',
  }
}

describe('SessionRuntimeVariableService', () => {
  it('overwrites a variable with the same key and updates its metadata', () => {
    const storage = new MemoryStorage()
    const updates = [firstUpdate, secondUpdate]
    const service = new SessionRuntimeVariableService(storage, () => updates.shift() ?? secondUpdate)

    service.upsert(tokenDraft('old-token'))
    const updated = service.upsert({
      ...tokenDraft('new-token'),
      sourceEnvironmentId: 'env-staging',
      sourcePath: 'result.access_token',
    })

    expect(service.list()).toHaveLength(1)
    expect(service.get('AUTH_TOKEN')).toEqual(updated)
    expect(updated).toMatchObject({
      value: 'new-token',
      sourceEnvironmentId: 'env-staging',
      sourcePath: 'result.access_token',
      updatedAt: secondUpdate.toISOString(),
    })
  })

  it('restores variables from session storage', () => {
    const storage = new MemoryStorage()
    const original = new SessionRuntimeVariableService(storage, () => firstUpdate)
    original.upsert(tokenDraft('restored-token'))

    const restored = new SessionRuntimeVariableService(storage)

    expect(restored.get('AUTH_TOKEN')).toMatchObject({
      value: 'restored-token',
      secret: true,
      sourceEnvironmentId: 'env-testing',
      sourcePath: 'data.token',
      updatedAt: firstUpdate.toISOString(),
    })
  })

  it('clears in-memory and persisted variables', () => {
    const storage = new MemoryStorage()
    const service = new SessionRuntimeVariableService(storage, () => firstUpdate)
    service.upsert(tokenDraft('token-value'))

    service.clear()

    expect(service.list()).toEqual([])
    expect(new SessionRuntimeVariableService(storage).list()).toEqual([])
  })

  it('ignores invalid JSON and malformed stored entries', () => {
    const storage = new MemoryStorage()
    storage.setItem('autotest.runtime-variables.v1', '{invalid json')
    expect(new SessionRuntimeVariableService(storage).list()).toEqual([])

    storage.setItem('autotest.runtime-variables.v1', JSON.stringify([
      { key: 'BROKEN', value: 123 },
      { ...tokenDraft('valid-token'), updatedAt: firstUpdate.toISOString() },
    ]))
    const restored = new SessionRuntimeVariableService(storage)

    expect(restored.list()).toHaveLength(1)
    expect(restored.get('AUTH_TOKEN')?.value).toBe('valid-token')
  })

  it('resolves known template variables and preserves unknown placeholders', () => {
    const service = new SessionRuntimeVariableService(new MemoryStorage(), () => firstUpdate)
    service.upsert(tokenDraft('token-value'))

    expect(service.resolve('token={{ AUTH_TOKEN }}&missing={{UNKNOWN}}')).toBe(
      'token=token-value&missing={{UNKNOWN}}',
    )
  })

  it('builds default and custom Authorization header values', () => {
    const service = new SessionRuntimeVariableService(new MemoryStorage(), () => firstUpdate)
    service.upsert(tokenDraft('token-value'))

    expect(service.buildAuthorizationHeader('AUTH_TOKEN')).toBe('Bearer token-value')
    expect(service.buildAuthorizationHeader('AUTH_TOKEN', 'Token')).toBe('Token token-value')

    service.upsert({ ...tokenDraft('token-value'), authorizationScheme: 'Custom' })
    expect(service.buildAuthorizationHeader('AUTH_TOKEN', 'Token')).toBe('Custom token-value')
    expect(service.buildAuthorizationHeader('MISSING_TOKEN')).toBeNull()
  })
})
