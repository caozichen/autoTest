import { describe, expect, it } from 'vitest'

import type { EnvironmentLoginResult } from '@/domain/environment-login'
import type { TestEnvironment } from '@/domain/environment'
import { SessionRuntimeVariableService } from '@/services/runtime-variables/session-runtime-variable.service'
import { applyResponseVariable } from './apply-response-variable'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

const environment = {
  id: 'env-testing',
  auth: {
    tokenTypePath: 'data.token_type',
    tokenTypeFallback: 'Bearer',
  },
} as TestEnvironment

function loginResult(businessSuccess: boolean, token: unknown, tokenType = 'Bearer'): EnvironmentLoginResult {
  return {
    businessSuccess,
    ok: true,
    status: 200,
    statusText: 'OK',
    targetUrl: 'https://lx.admin.lingxi.tech/api/be/login/mobile',
    durationMs: 100,
    receivedAt: '2026-08-12T02:00:00.000Z',
    requestBody: {},
    responseBody: { code: businessSuccess ? 0 : 1001, data: { token, token_type: tokenType } },
    rawResponse: '',
    responseHeaders: {},
  }
}

describe('applyResponseVariable', () => {
  it('extracts and overwrites a global variable after business success', () => {
    const variables = new SessionRuntimeVariableService(new MemoryStorage())
    variables.upsert({
      key: 'AUTH_TOKEN',
      value: 'old-token',
      secret: true,
      sourceEnvironmentId: environment.id,
      sourcePath: 'data.token',
    })

    const applied = applyResponseVariable(
      { variableName: 'AUTH_TOKEN', responsePath: 'data.token' },
      environment,
      loginResult(true, 'new-token'),
      variables,
    )

    expect(applied).toMatchObject({
      value: 'new-token',
      authorizationScheme: 'Bearer',
    })
    expect(variables.get('AUTH_TOKEN')?.value).toBe('new-token')
  })

  it('keeps the previous value after business failure or invalid extraction', () => {
    const variables = new SessionRuntimeVariableService(new MemoryStorage())
    variables.upsert({
      key: 'AUTH_TOKEN',
      value: 'last-success-token',
      secret: true,
      sourceEnvironmentId: environment.id,
      sourcePath: 'data.token',
    })

    expect(applyResponseVariable(
      { variableName: 'AUTH_TOKEN', responsePath: 'data.token' },
      environment,
      loginResult(false, 'must-not-apply'),
      variables,
    )).toBeNull()
    expect(applyResponseVariable(
      { variableName: 'AUTH_TOKEN', responsePath: 'data.missing' },
      environment,
      loginResult(true, 'unused'),
      variables,
    )).toBeNull()
    expect(variables.get('AUTH_TOKEN')?.value).toBe('last-success-token')
  })
})
