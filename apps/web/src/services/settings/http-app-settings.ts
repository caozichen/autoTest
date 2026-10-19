import { runtimeConfig } from '@/config/runtime'
import { LocalEnvironmentService, normalizeEnvironmentArray } from '../environments/local-environment.service'

export const ENVIRONMENTS_KEY = 'autotest.environments.v7'
export const PIPELINES_KEY = 'autotest.automation-pipelines.v1'
export const SESSION_PREFIX = 'autotest.environment-session.v1.'
const TABS_KEY = 'autotest.run-history-tabs.v1'

interface Snapshot {
  schemaVersion: 1
  revision: number
  values: Record<string, string | null>
}

export class SettingsStorage implements Storage {
  private readonly values = new Map<string, string>()
  private readonly removed = new Set<string>()
  constructor(values: Record<string, string | null> = {}) {
    for (const [key, value] of Object.entries(values)) if (value !== null) this.values.set(key, value)
  }
  get length(): number { return this.values.size }
  clear(): void { for (const key of this.values.keys()) this.removed.add(key); this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key); this.removed.add(key) }
  setItem(key: string, value: string): void { this.values.set(key, value); this.removed.delete(key) }
  entries(): Record<string, string | null> {
    return { ...Object.fromEntries([...this.removed].map(key => [key, null])), ...Object.fromEntries(this.values) }
  }
}

interface Options {
  fetcher?: typeof fetch
  runnerBaseUrl?: string
  legacyStorage?: Storage | null
  requestTimeoutMs?: number
}

function browserStorage(): Storage | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}

function hasOwn(value: object, key: string): boolean { return Object.prototype.hasOwnProperty.call(value, key) }

class SettingsHttpError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

// The Runner is the authority. Browser storage is read only for one-time migration,
// and retained as a recovery copy; failed requests never fall back to fresh defaults.
export class HttpAppSettings {
  private readonly fetcher: typeof fetch
  private readonly baseUrl: string
  private readonly legacyStorage: Storage | null
  private readonly timeoutMs: number
  private migration: Promise<void> | null = null
  private tail: Promise<void> = Promise.resolve()

  constructor(options: Options = {}) {
    this.fetcher = (options.fetcher ?? globalThis.fetch).bind(globalThis)
    this.baseUrl = (options.runnerBaseUrl ?? runtimeConfig.runnerBaseUrl).replace(/\/+$/, '')
    this.legacyStorage = options.legacyStorage === undefined ? browserStorage() : options.legacyStorage
    this.timeoutMs = options.requestTimeoutMs ?? 15_000
  }

  async read<T>(query: (storage: SettingsStorage) => T | Promise<T>): Promise<T> {
    await this.ensureMigration()
    const snapshot = await this.request('/app-settings')
    return query(new SettingsStorage(snapshot.values))
  }

  mutate<T>(transition: (storage: SettingsStorage) => T | Promise<T>): Promise<T> {
    const operation = this.tail.then(async () => {
      await this.ensureMigration()
      for (let attempt = 0; attempt < 3; attempt++) {
        const snapshot = await this.request('/app-settings')
        const storage = new SettingsStorage(snapshot.values)
        const result = await transition(storage)
        const next = storage.entries()
        const keys = new Set([...Object.keys(snapshot.values), ...Object.keys(next)])
        const changes = Object.fromEntries([...keys].flatMap(key => {
          const value = next[key] ?? null
          return value === snapshot.values[key] ? [] : [[key, value]]
        }))
        if (!Object.keys(changes).length) return result
        try {
          const saved = await this.request('/app-settings', { method: 'PATCH', body: JSON.stringify({ changes, expectedRevision: snapshot.revision }) })
          if (!Object.entries(changes).every(([key, value]) => saved.values[key] === value)) {
            throw new Error('Runner 未完整确认配置保存，请刷新检查后重试')
          }
          return result
        } catch (error) {
          if (error instanceof SettingsHttpError && error.status === 409 && attempt < 2) continue
          throw error
        }
      }
      throw new Error('配置更新冲突，请刷新后重试')
    })
    this.tail = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async ensureMigration(): Promise<void> {
    if (!this.migration) this.migration = this.migrate().catch(error => { this.migration = null; throw error })
    await this.migration
  }

  private async migrate(): Promise<void> {
    if (!this.legacyStorage) return
    const snapshot = await this.request('/app-settings')
    const entries: Record<string, string> = {}
    for (let index = 0; index < this.legacyStorage.length; index++) {
      const key = this.legacyStorage.key(index)
      if (!key || hasOwn(snapshot.values, key)) continue
      if (![ENVIRONMENTS_KEY, PIPELINES_KEY, TABS_KEY].includes(key) && !key.startsWith(SESSION_PREFIX)) continue
      const raw = this.legacyStorage.getItem(key)
      if (raw !== null) entries[key] = raw
    }
    // Reuse the existing v1–v6 migration without changing the browser's backup.
    if (!hasOwn(snapshot.values, ENVIRONMENTS_KEY) && !hasOwn(entries, ENVIRONMENTS_KEY)) {
      const legacy = new SettingsStorage()
      for (let version = 6; version >= 1; version--) {
        const key = `autotest.environments.v${version}`
        const raw = this.legacyStorage.getItem(key)
        if (raw !== null) {
          if (!normalizeEnvironmentArray(JSON.parse(raw), true)) throw new Error('旧环境配置格式无效，浏览器原数据已保留')
          legacy.setItem(key, raw)
          break
        }
      }
      if (legacy.length) entries[ENVIRONMENTS_KEY] = JSON.stringify(await new LocalEnvironmentService(legacy).list())
    }
    if (Object.keys(entries).length) {
      const migrated = await this.request('/app-settings/migrations/local-storage-v1', { method: 'POST', body: JSON.stringify({ entries }) })
      if (!Object.keys(entries).every(key => hasOwn(migrated.values, key))) {
        throw new Error('Runner 未完整确认旧配置迁移，浏览器原数据已保留')
      }
    }
  }

  private async request(path: string, init: RequestInit = {}): Promise<Snapshot> {
    const controller = new AbortController()
    const timer = globalThis.setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetcher(this.baseUrl + path, { ...init, cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }) } })
      const payload = await response.json()
      if (!response.ok) throw new SettingsHttpError(typeof payload?.error === 'string' ? payload.error : `配置请求失败（HTTP ${response.status}）`, response.status)
      if (payload?.schemaVersion !== 1 || !Number.isSafeInteger(payload.revision) || payload.revision < 0
        || !payload.values || typeof payload.values !== 'object' || Array.isArray(payload.values)
        || !Object.values(payload.values).every(value => value === null || typeof value === 'string')) {
        throw new Error('Runner 返回的配置格式无效，已停止操作')
      }
      return payload as Snapshot
    } catch (error) {
      if (controller.signal.aborted) throw new Error('本地配置请求超时，请检查 Runner 后重试')
      if (error instanceof TypeError) throw new Error('无法连接本地 Runner，配置未保存，请启动服务后重试')
      throw error
    } finally { globalThis.clearTimeout(timer) }
  }
}
