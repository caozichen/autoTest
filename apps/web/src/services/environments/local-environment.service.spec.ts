import { describe, expect, it } from 'vitest'

import { LocalEnvironmentService } from './local-environment.service'

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

describe('LocalEnvironmentService', () => {
  it('starts with only the real Lingxi testing environment', async () => {
    const environments = await new LocalEnvironmentService(new MemoryStorage()).list()

    expect(environments).toHaveLength(1)
    expect(environments[0]).toMatchObject({
      id: 'env-testing',
      name: '测试环境',
      code: 'TEST',
      active: true,
      baseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
    })
  })

  it('persists created environments and restores them', async () => {
    const storage = new MemoryStorage()
    const service = new LocalEnvironmentService(storage)
    const created = await service.create({
      name: '集成环境',
      code: 'INTEGRATION',
      description: '服务集成验证',
      baseUrl: 'https://integration.example.local/',
      apiBaseUrl: 'https://integration.example.local/api',
      ignoreHTTPSErrors: false,
      enabled: true,
      auth: {
        mode: 'password',
        method: 'POST',
        timeoutMs: 30_000,
        loginPath: '/api/login',
        username: 'qa',
        password: 'password',
        mobile: '',
        verifyCode: '',
        tokenPath: 'data.token',
        tokenVariable: 'AUTH_TOKEN',
      },
      variables: [],
    })

    const restored = new LocalEnvironmentService(storage)
    expect((await restored.list()).some((environment) => environment.id === created.id)).toBe(true)
  })

  it('keeps only one active environment and protects it from deletion', async () => {
    const service = new LocalEnvironmentService(new MemoryStorage())
    const active = await service.setActive('env-testing')

    expect(active.id).toBe('env-testing')
    expect((await service.list()).filter((environment) => environment.active)).toHaveLength(1)
    await expect(service.remove('env-testing')).rejects.toThrow('当前环境不能删除')
  })

  it('migrates the legacy TEST placeholder to the configurable Lingxi preset', async () => {
    const storage = new MemoryStorage()
    storage.setItem('autotest.environments.v1', JSON.stringify([
      {
        id: 'env-development',
        name: '开发环境',
        code: 'DEV',
        description: '原当前环境',
        baseUrl: 'https://dev.example.local',
        enabled: true,
        active: true,
        auth: {
          loginPath: '/api/login',
          username: 'dev-user',
          password: 'dev-password',
          tokenPath: 'data.token',
          tokenVariable: 'AUTH_TOKEN',
        },
        variables: [],
        updatedAt: '2026-08-10 09:00',
      },
      {
        id: 'env-testing',
        name: '测试环境',
        code: 'TEST',
        description: '旧占位环境',
        baseUrl: 'https://test-api.example.local',
        enabled: true,
        active: false,
        auth: {
          loginPath: '/api/auth/login',
          username: 'old-user',
          password: 'old-password',
          tokenPath: 'data.token',
          tokenVariable: 'AUTH_TOKEN',
        },
        variables: [],
        updatedAt: '2026-08-10 10:00',
      },
    ]))

    const service = new LocalEnvironmentService(storage)
    const preset = (await service.list()).find((environment) => environment.id === 'env-testing')

    expect(preset).toMatchObject({
      baseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: true,
      active: true,
      auth: {
        mode: 'mobile-code',
        method: 'POST',
        timeoutMs: 45_000,
        loginPath: '/be/login/mobile',
        mobile: '',
        verifyCode: '',
      },
    })
    expect((await service.list()).some((environment) => environment.id === 'env-development')).toBe(false)
    expect((await service.getActive())?.id).toBe('env-testing')
    expect(storage.getItem('autotest.environments.v5')).not.toBeNull()
  })

  it('adds the preset when migrating an intermediate v2 store without TEST', async () => {
    const storage = new MemoryStorage()
    storage.setItem('autotest.environments.v2', JSON.stringify([{
      id: 'env-custom',
      name: '自定义环境',
      code: 'CUSTOM',
      description: '已有配置',
      baseUrl: 'https://custom.example.com/',
      apiBaseUrl: 'https://custom.example.com/api',
      ignoreHTTPSErrors: false,
      enabled: true,
      active: true,
      auth: {
        mode: 'password',
        method: 'POST',
        timeoutMs: 30_000,
        loginPath: '/login',
        username: 'user',
        password: 'password',
        mobile: '',
        verifyCode: '',
        tokenPath: 'data.token',
        tokenVariable: 'AUTH_TOKEN',
      },
      variables: [],
      updatedAt: '2026-08-11 15:00',
    }]))

    const service = new LocalEnvironmentService(storage)
    const environments = await service.list()

    expect(environments.some((environment) => environment.id === 'env-testing')).toBe(true)
    expect((await service.getActive())?.id).toBe('env-custom')
  })

  it('adds Lingxi response extraction defaults while migrating v3 data', async () => {
    const storage = new MemoryStorage()
    storage.setItem('autotest.environments.v3', JSON.stringify([{
      id: 'env-testing',
      name: '测试环境',
      code: 'TEST',
      description: '灵犀测试环境',
      baseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
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
        tokenPath: '',
        tokenVariable: 'AUTH_TOKEN',
      },
      variables: [],
      updatedAt: '2026-08-11 15:30',
    }]))

    const service = new LocalEnvironmentService(storage)
    const preset = (await service.list())[0]

    expect(preset?.auth).toMatchObject({
      successPath: 'code',
      successValue: '0',
      tokenPath: 'data.token',
      tokenVariable: 'AUTH_TOKEN',
      tokenTypePath: 'data.token_type',
      tokenTypeFallback: 'Bearer',
    })
    expect(preset?.ignoreHTTPSErrors).toBe(true)
    expect(storage.getItem('autotest.environments.v5')).not.toBeNull()
  })

  it('removes only known demo environments while migrating v4 storage', async () => {
    const storage = new MemoryStorage()
    storage.setItem('autotest.environments.v4', JSON.stringify([
      {
        id: 'env-development',
        name: '开发环境',
        code: 'DEV',
        description: '旧演示项',
        baseUrl: 'https://dev-api.example.local',
        apiBaseUrl: 'https://dev-api.example.local',
        ignoreHTTPSErrors: false,
        enabled: true,
        active: true,
        auth: {
          mode: 'password', method: 'POST', timeoutMs: 30_000, loginPath: '/api/login',
          username: 'demo', password: 'demo', mobile: '', verifyCode: '', tokenPath: 'token', tokenVariable: 'TOKEN',
        },
        variables: [],
        updatedAt: '2026-08-11 10:00',
      },
      {
        id: 'env-testing',
        name: '测试环境',
        code: 'TEST',
        description: '用户已调整的真实环境',
        baseUrl: 'https://lx.admin.lingxi.tech/',
        apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
        ignoreHTTPSErrors: true,
        enabled: true,
        active: false,
        auth: {
          mode: 'mobile-code', method: 'POST', timeoutMs: 45_000, loginPath: '/be/login/mobile',
          username: '', password: '', mobile: '13800000000', verifyCode: '123456',
          successPath: 'code', successValue: '0', tokenPath: 'data.customToken', tokenVariable: 'CUSTOM_TOKEN',
          tokenTypePath: 'data.token_type', tokenTypeFallback: 'Bearer',
        },
        variables: [],
        updatedAt: '2026-08-12 09:00',
      },
      {
        id: 'user-environment-id',
        name: '用户环境',
        code: 'USER',
        description: '用户新增项',
        baseUrl: 'https://user.example.com',
        apiBaseUrl: 'https://user.example.com/api',
        ignoreHTTPSErrors: false,
        enabled: true,
        active: false,
        auth: {
          mode: 'password', method: 'POST', timeoutMs: 30_000, loginPath: '/login',
          username: 'user', password: 'password', mobile: '', verifyCode: '', tokenPath: 'data.token', tokenVariable: 'AUTH_TOKEN',
        },
        variables: [],
        updatedAt: '2026-08-12 10:00',
      },
      {
        id: 'env-staging',
        name: '预发布环境',
        code: 'STAGING',
        description: '旧演示项',
        baseUrl: 'https://staging-api.example.com',
        apiBaseUrl: 'https://staging-api.example.com',
        ignoreHTTPSErrors: false,
        enabled: true,
        active: false,
        auth: {
          mode: 'password', method: 'POST', timeoutMs: 30_000, loginPath: '/login',
          username: 'demo', password: 'demo', mobile: '', verifyCode: '', tokenPath: 'token', tokenVariable: 'TOKEN',
        },
        variables: [],
        updatedAt: '2026-08-11 10:00',
      },
      {
        id: 'env-legacy',
        name: '旧版兼容环境',
        code: 'LEGACY',
        description: '旧演示项',
        baseUrl: 'https://legacy-api.example.local',
        apiBaseUrl: 'https://legacy-api.example.local',
        ignoreHTTPSErrors: false,
        enabled: false,
        active: false,
        auth: {
          mode: 'password', method: 'POST', timeoutMs: 30_000, loginPath: '/login',
          username: 'demo', password: 'demo', mobile: '', verifyCode: '', tokenPath: 'token', tokenVariable: 'TOKEN',
        },
        variables: [],
        updatedAt: '2026-08-11 10:00',
      },
    ]))

    const service = new LocalEnvironmentService(storage)
    const environments = await service.list()

    expect(environments.map((environment) => environment.id)).toEqual(['env-testing', 'user-environment-id'])
    expect(environments.find((environment) => environment.id === 'env-testing')?.auth).toMatchObject({
      tokenPath: 'data.customToken',
      tokenVariable: 'CUSTOM_TOKEN',
    })
    expect((await service.getActive())?.id).toBe('env-testing')
    expect(storage.getItem('autotest.environments.v5')).not.toBeNull()
  })

  it('does not persist credentials from the inactive login mode', async () => {
    const service = new LocalEnvironmentService(new MemoryStorage())
    const created = await service.create({
      name: '手机登录环境',
      code: 'MOBILE',
      description: '凭据清理验证',
      baseUrl: 'https://mobile.example.com/',
      apiBaseUrl: 'https://mobile.example.com/api',
      ignoreHTTPSErrors: false,
      enabled: true,
      auth: {
        mode: 'mobile-code',
        method: 'POST',
        timeoutMs: 30_000,
        loginPath: '/login/mobile',
        username: 'should-not-persist',
        password: 'should-not-persist',
        mobile: '13800000000',
        verifyCode: '123456',
        tokenPath: '',
        tokenVariable: '',
      },
      variables: [],
    })

    expect(created.auth.username).toBe('')
    expect(created.auth.password).toBe('')
  })
})
