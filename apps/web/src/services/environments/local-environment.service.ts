import type { EnvironmentDraft, EnvironmentVariable, TestEnvironment } from '@/domain/environment'
import type { EnvironmentService } from './environment-service'

const STORAGE_KEY = 'autotest.environments.v5'
const PREVIOUS_STORAGE_KEY = 'autotest.environments.v4'
const V3_STORAGE_KEY = 'autotest.environments.v3'
const V2_STORAGE_KEY = 'autotest.environments.v2'
const LEGACY_STORAGE_KEY = 'autotest.environments.v1'
const DEMO_ENVIRONMENT_IDS = new Set(['env-development', 'env-staging', 'env-legacy'])

const initialEnvironments: TestEnvironment[] = [
  {
    id: 'env-testing',
    name: '测试环境',
    code: 'TEST',
    description: '灵犀管理端手机号验证码登录测试环境。',
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
      mobile: '',
      verifyCode: '',
      successPath: 'code',
      successValue: '0',
      tokenPath: 'data.token',
      tokenVariable: 'AUTH_TOKEN',
      tokenTypePath: 'data.token_type',
      tokenTypeFallback: 'Bearer',
    },
    variables: [],
    updatedAt: '暂无数据',
  },
]

function cloneEnvironments(environments: TestEnvironment[]): TestEnvironment[] {
  return structuredClone(environments)
}

function formatNow(): string {
  const now = new Date()
  const date = now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-')
  const time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${date} ${time}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeVariables(value: unknown): EnvironmentVariable[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.key !== 'string') return []
    return [{
      id: item.id,
      key: item.key,
      value: stringValue(item.value),
      description: stringValue(item.description),
      secret: item.secret === true,
      enabled: item.enabled !== false,
    }]
  })
}

function normalizeEnvironment(value: unknown, applyLingxiDefaults: boolean): TestEnvironment | null {
  if (!isRecord(value) || !isRecord(value.auth)) return null
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.code !== 'string' ||
    typeof value.baseUrl !== 'string' ||
    typeof value.enabled !== 'boolean' ||
    typeof value.active !== 'boolean' ||
    typeof value.auth.loginPath !== 'string'
  ) return null

  const mode = value.auth.mode === 'mobile-code' ? 'mobile-code' : 'password'
  const method = value.auth.method === 'PUT' || value.auth.method === 'PATCH' ? value.auth.method : 'POST'
  const isLingxiTest = (
    (value.id === 'env-testing' || value.code.toUpperCase() === 'TEST') &&
    value.baseUrl.includes('lx.admin.lingxi.tech')
  )
  const useLingxiDefaults = applyLingxiDefaults && isLingxiTest

  return {
    id: value.id,
    name: value.name,
    code: value.code,
    description: stringValue(value.description),
    baseUrl: value.baseUrl,
    apiBaseUrl: stringValue(value.apiBaseUrl) || value.baseUrl,
    ignoreHTTPSErrors: value.ignoreHTTPSErrors === true || (
      value.ignoreHTTPSErrors === undefined && isLingxiTest
    ),
    enabled: value.enabled,
    active: value.active,
    auth: {
      mode,
      method,
      timeoutMs: typeof value.auth.timeoutMs === 'number' && value.auth.timeoutMs >= 5_000
        ? Math.min(value.auth.timeoutMs, 120_000)
        : 30_000,
      loginPath: value.auth.loginPath,
      username: stringValue(value.auth.username),
      password: stringValue(value.auth.password),
      mobile: stringValue(value.auth.mobile),
      verifyCode: stringValue(value.auth.verifyCode),
      successPath: stringValue(value.auth.successPath) || (useLingxiDefaults ? 'code' : ''),
      successValue: stringValue(value.auth.successValue) || (useLingxiDefaults ? '0' : ''),
      tokenPath: stringValue(value.auth.tokenPath) || (useLingxiDefaults ? 'data.token' : ''),
      tokenVariable: stringValue(value.auth.tokenVariable) || (useLingxiDefaults ? 'AUTH_TOKEN' : ''),
      tokenTypePath: stringValue(value.auth.tokenTypePath) || (useLingxiDefaults ? 'data.token_type' : ''),
      tokenTypeFallback: typeof value.auth.tokenTypeFallback === 'string'
        ? value.auth.tokenTypeFallback
        : 'Bearer',
    },
    variables: normalizeVariables(value.variables),
    updatedAt: stringValue(value.updatedAt) || formatNow(),
  }
}

function normalizeEnvironmentArray(value: unknown, applyLingxiDefaults = false): TestEnvironment[] | null {
  if (!Array.isArray(value)) return null
  const environments = value.map((environment) => normalizeEnvironment(environment, applyLingxiDefaults))
  if (environments.some((environment) => environment === null)) return null
  return environments as TestEnvironment[]
}

function migrateEnvironments(environments: TestEnvironment[], replaceExistingTest: boolean): TestEnvironment[] {
  const preset = structuredClone(initialEnvironments.find((environment) => environment.id === 'env-testing'))
  if (!preset) return cloneEnvironments(initialEnvironments)
  const withoutDemos = environments.filter((environment) => !DEMO_ENVIRONMENT_IDS.has(environment.id))
  const existingTest = withoutDemos.find((environment) => (
    environment.id === 'env-testing' || environment.code.toUpperCase() === 'TEST'
  ))
  const testEnvironment = existingTest && !replaceExistingTest
    ? structuredClone(existingTest)
    : preset

  const remaining = withoutDemos
    .filter((environment) => environment.id !== 'env-testing' && environment.code.toUpperCase() !== 'TEST')
  const activeEnvironment = existingTest?.active && testEnvironment.enabled
    ? testEnvironment.id
    : remaining.find((environment) => environment.active && environment.enabled)?.id
      ?? (testEnvironment.enabled ? testEnvironment.id : remaining.find((environment) => environment.enabled)?.id)

  return [
    { ...testEnvironment, active: testEnvironment.id === activeEnvironment },
    ...remaining.map((environment) => ({ ...environment, active: environment.id === activeEnvironment })),
  ]
}

function sanitizeDraft(draft: EnvironmentDraft): EnvironmentDraft {
  const sanitized = structuredClone(draft)
  if (sanitized.auth.mode === 'mobile-code') {
    sanitized.auth.username = ''
    sanitized.auth.password = ''
  } else {
    sanitized.auth.mobile = ''
    sanitized.auth.verifyCode = ''
  }
  return sanitized
}

export class LocalEnvironmentService implements EnvironmentService {
  private environments: TestEnvironment[]

  constructor(private readonly storage: Storage = window.localStorage) {
    this.environments = this.readStorage()
  }

  async list(): Promise<TestEnvironment[]> {
    return cloneEnvironments(this.environments)
  }

  async getActive(): Promise<TestEnvironment | null> {
    const active = this.environments.find((environment) => environment.active && environment.enabled)
    return active ? structuredClone(active) : null
  }

  async create(draft: EnvironmentDraft): Promise<TestEnvironment> {
    this.assertUnique(draft)
    const environment: TestEnvironment = {
      ...sanitizeDraft(draft),
      id: crypto.randomUUID(),
      active: false,
      updatedAt: formatNow(),
    }
    this.commit([environment, ...this.environments])
    return structuredClone(environment)
  }

  async update(id: string, draft: EnvironmentDraft): Promise<TestEnvironment> {
    const current = this.environments.find((environment) => environment.id === id)
    if (!current) throw new Error('环境不存在或已被删除')
    if (current.active && !draft.enabled) throw new Error('当前环境不能停用，请先切换到其它环境')

    this.assertUnique(draft, id)
    const updated: TestEnvironment = {
      ...sanitizeDraft(draft),
      id,
      active: current.active,
      updatedAt: formatNow(),
    }
    this.commit(this.environments.map((environment) => environment.id === id ? updated : environment))
    return structuredClone(updated)
  }

  async remove(id: string): Promise<void> {
    const current = this.environments.find((environment) => environment.id === id)
    if (!current) throw new Error('环境不存在或已被删除')
    if (current.active) throw new Error('当前环境不能删除，请先切换到其它环境')
    this.commit(this.environments.filter((environment) => environment.id !== id))
  }

  async setActive(id: string): Promise<TestEnvironment> {
    const target = this.environments.find((environment) => environment.id === id)
    if (!target) throw new Error('环境不存在或已被删除')
    if (!target.enabled) throw new Error('停用的环境不能切换为当前环境')

    const next = this.environments.map((environment) => ({ ...environment, active: environment.id === id }))
    this.commit(next)
    const active = next.find((environment) => environment.id === id)
    if (!active) throw new Error('环境切换失败')
    return structuredClone(active)
  }

  private assertUnique(draft: EnvironmentDraft, excludeId?: string): void {
    const duplicate = this.environments.find((environment) => (
      environment.id !== excludeId &&
      (environment.name.toLowerCase() === draft.name.trim().toLowerCase() || environment.code.toLowerCase() === draft.code.trim().toLowerCase())
    ))
    if (duplicate) throw new Error('环境名称或标识已存在')
  }

  private readStorage(): TestEnvironment[] {
    const current = this.readStorageKey(STORAGE_KEY)
    if (current) return current

    const previous = this.readStorageKey(PREVIOUS_STORAGE_KEY, true)
    if (previous) {
      const migrated = migrateEnvironments(previous, false)
      this.storage.setItem(STORAGE_KEY, JSON.stringify(migrated))
      return cloneEnvironments(migrated)
    }

    const v3 = this.readStorageKey(V3_STORAGE_KEY, true)
    if (v3) {
      const migrated = migrateEnvironments(v3, false)
      this.storage.setItem(STORAGE_KEY, JSON.stringify(migrated))
      return cloneEnvironments(migrated)
    }

    const v2 = this.readStorageKey(V2_STORAGE_KEY, true)
    if (v2) {
      const migrated = migrateEnvironments(v2, false)
      this.storage.setItem(STORAGE_KEY, JSON.stringify(migrated))
      return cloneEnvironments(migrated)
    }

    const legacy = this.readStorageKey(LEGACY_STORAGE_KEY, true)
    if (legacy) {
      const migrated = migrateEnvironments(legacy, true)
      this.storage.setItem(STORAGE_KEY, JSON.stringify(migrated))
      return cloneEnvironments(migrated)
    }

    return cloneEnvironments(initialEnvironments)
  }

  private readStorageKey(key: string, applyLingxiDefaults = false): TestEnvironment[] | null {
    const raw = this.storage.getItem(key)
    if (!raw) return null
    try {
      const parsed: unknown = JSON.parse(raw)
      const environments = normalizeEnvironmentArray(parsed, applyLingxiDefaults)
      return environments ? cloneEnvironments(environments) : null
    } catch {
      return null
    }
  }

  private commit(next: TestEnvironment[]): void {
    const cloned = cloneEnvironments(next)
    this.storage.setItem(STORAGE_KEY, JSON.stringify(cloned))
    this.environments = cloned
  }
}
