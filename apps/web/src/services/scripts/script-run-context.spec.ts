import { describe, expect, it } from 'vitest'

import type { TestEnvironment } from '@/domain/environment'
import { SessionRuntimeVariableService } from '@/services/runtime-variables/session-runtime-variable.service'
import { buildScriptRunContext } from './script-run-context'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

function environment(): TestEnvironment {
  return {
    id: 'env-testing',
    name: '测试环境',
    code: 'TEST',
    description: '登录测试环境',
    baseUrl: 'https://lx.admin.lingxi.tech/',
    apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
    ignoreHTTPSErrors: true,
    enabled: true,
    active: true,
    auth: {
      mode: 'mobile-code',
      method: 'POST',
      timeoutMs: 45_000,
      loginPath: '/be/login/mobile',
      username: '',
      password: '',
      mobile: '13800000000',
      verifyCode: '123456',
      successPath: 'code',
      successValue: '0',
      tokenPath: 'data.token',
      tokenVariable: 'AUTH_TOKEN',
      tokenTypePath: 'data.token_type',
      tokenTypeFallback: 'Bearer',
    },
    variables: [
      { id: 'static-token', key: 'AUTH_TOKEN', value: 'old-static-token', description: '', secret: true, enabled: true },
      { id: 'team', key: 'TEAM_ID', value: '10000', description: '', secret: false, enabled: true },
    ],
    updatedAt: '2026-08-12 10:00',
  }
}

describe('buildScriptRunContext', () => {
  it('lets runtime variables override static values and injects Authorization', () => {
    const runtimeVariables = new SessionRuntimeVariableService(new MemoryStorage())
    runtimeVariables.upsert({
      key: 'AUTH_TOKEN',
      value: 'latest-runtime-token',
      secret: true,
      authorizationScheme: 'Token',
      sourceEnvironmentId: 'env-testing',
      sourcePath: 'data.token',
    })

    const context = buildScriptRunContext(environment(), runtimeVariables)

    expect(context.variables).toEqual({
      AUTH_TOKEN: 'latest-runtime-token',
      TEAM_ID: '10000',
    })
    expect(context.apiBaseUrl).toBe('https://lx.admin.lingxi.tech/api')
    expect(context.siteBaseUrl).toBe('https://lx.admin.lingxi.tech/')
    expect(context.ignoreHTTPSErrors).toBe(true)
    expect(context.authorizationOrigin).toBe('https://lx.admin.lingxi.tech')
    expect(context.extraHTTPHeaders).toEqual({
      Authorization: 'Token latest-runtime-token',
    })
  })

  it('blocks execution until the selected environment has a runtime token', () => {
    const runtimeVariables = new SessionRuntimeVariableService(new MemoryStorage())

    expect(() => buildScriptRunContext(environment(), runtimeVariables)).toThrow(
      '缺少全局变量 {{AUTH_TOKEN}}',
    )
  })

  it('enables the Lingxi test certificate fallback for legacy environment data', () => {
    const legacyEnvironment = environment()
    delete (legacyEnvironment as Partial<TestEnvironment>).ignoreHTTPSErrors
    const runtimeVariables = new SessionRuntimeVariableService(new MemoryStorage())
    runtimeVariables.upsert({
      key: 'AUTH_TOKEN',
      value: 'runtime-token',
      secret: true,
      sourceEnvironmentId: legacyEnvironment.id,
      sourcePath: 'data.token',
    })

    expect(buildScriptRunContext(legacyEnvironment, runtimeVariables).ignoreHTTPSErrors).toBe(true)
  })
})
