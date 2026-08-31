import { runtimeConfig } from '@/config/runtime'
import type {
  AppendRunLogDraft,
  CompleteRunRecordDraft,
  FailRunRecordDraft,
  RunRecord,
  StartRunRecordDraft,
  UpdateRunScriptProgressDraft,
} from '@/domain/run-record'
import { LocalRunRecordService } from './local-run-record.service'
import type { RunRecordService } from './run-record-service'

const LEGACY_STORAGE_KEY = 'autotest.run-records.v1'
const DEFAULT_CONFLICT_RETRIES = 2

type RecordTransition = (service: LocalRunRecordService) => Promise<RunRecord>

interface MigrationResult {
  importedCount: number
  skippedCount: number
  importedIds: string[]
  skippedIds: string[]
}

export interface HttpRunRecordServiceOptions {
  fetcher?: typeof fetch
  runnerBaseUrl?: string
  legacyStorage?: Storage | null
  now?: () => Date
  idFactory?: () => string
  conflictRetries?: number
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

class RunRecordHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'RunRecordHttpError'
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function defaultLegacyStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function cloneRecord(value: unknown): RunRecord {
  if (!isObject(value) || value.schemaVersion !== 1 || typeof value.id !== 'string') {
    throw new Error('Runner 返回了无效的运行记录')
  }
  return structuredClone(value) as unknown as RunRecord
}

function recordsFromPayload(value: unknown): RunRecord[] {
  if (!isObject(value) || !Array.isArray(value.records)) {
    throw new Error('Runner 返回了无效的运行记录列表')
  }
  return value.records.map(cloneRecord)
}

function recordFromPayload(value: unknown): RunRecord {
  if (!isObject(value)) throw new Error('Runner 返回了无效的运行记录')
  return cloneRecord(value.record)
}

function migrationFromPayload(value: unknown): MigrationResult {
  if (
    !isObject(value) ||
    !Number.isInteger(value.importedCount) ||
    !Number.isInteger(value.skippedCount) ||
    !Array.isArray(value.importedIds) ||
    !Array.isArray(value.skippedIds) ||
    !value.importedIds.every((id) => typeof id === 'string') ||
    !value.skippedIds.every((id) => typeof id === 'string')
  ) {
    throw new Error('Runner 未完整确认旧运行记录的迁移结果')
  }
  return value as unknown as MigrationResult
}

export class HttpRunRecordService implements RunRecordService {
  private readonly fetcher: typeof fetch
  private readonly runnerBaseUrl: string
  private readonly legacyStorage: Storage | null
  private readonly now: () => Date
  private readonly idFactory: () => string
  private readonly conflictRetries: number
  private readonly mutationTails = new Map<string, Promise<void>>()
  private migrationComplete = false
  private migrationPromise: Promise<void> | null = null

  constructor(options: HttpRunRecordServiceOptions = {}) {
    const fetcher = options.fetcher ?? globalThis.fetch
    this.fetcher = fetcher.bind(globalThis)
    this.runnerBaseUrl = options.runnerBaseUrl ?? runtimeConfig.runnerBaseUrl
    this.legacyStorage = options.legacyStorage === undefined
      ? defaultLegacyStorage()
      : options.legacyStorage
    this.now = options.now ?? (() => new Date())
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID())
    this.conflictRetries = Math.max(0, Math.floor(options.conflictRetries ?? DEFAULT_CONFLICT_RETRIES))
  }

  async list(): Promise<RunRecord[]> {
    await this.ensureLegacyMigration()
    return this.fetchList()
  }

  async get(id: string): Promise<RunRecord | null> {
    await this.ensureLegacyMigration()
    return this.fetchRecord(id)
  }

  async start(draft: StartRunRecordDraft): Promise<RunRecord> {
    await this.ensureLegacyMigration()
    const existingRecords = await this.fetchList()
    const record = await this.createTransformer(existingRecords).start(draft)
    const { response, payload } = await this.request('/run-records', {
      method: 'POST',
      body: JSON.stringify({ record }),
    })
    this.assertOk(response, payload)
    return recordFromPayload(payload)
  }

  appendLog(id: string, draft: AppendRunLogDraft): Promise<RunRecord> {
    return this.mutate(id, (service) => service.appendLog(id, draft))
  }

  updateScriptProgress(id: string, draft: UpdateRunScriptProgressDraft): Promise<RunRecord> {
    return this.mutate(id, (service) => service.updateScriptProgress(id, draft))
  }

  complete(id: string, draft: CompleteRunRecordDraft): Promise<RunRecord> {
    return this.mutate(id, (service) => service.complete(id, draft))
  }

  fail(id: string, draft: FailRunRecordDraft): Promise<RunRecord> {
    return this.mutate(id, (service) => service.fail(id, draft))
  }

  interrupt(id: string, reason: string): Promise<RunRecord> {
    return this.mutate(id, (service) => service.interrupt(id, reason))
  }

  async interruptByScriptId(scriptId: string): Promise<RunRecord[]> {
    await this.ensureLegacyMigration()
    const matchingIds = (await this.fetchList())
      .filter((record) => record.status === 'running' && record.scripts.some((script) => script.id === scriptId))
      .map((record) => record.id)
    const records = await Promise.all(matchingIds.map((id) => this.enqueueMutation(id, async () => {
      for (let attempt = 0; attempt <= this.conflictRetries; attempt += 1) {
        const current = await this.fetchRecord(id)
        if (!current || current.status !== 'running' || !current.scripts.some((script) => script.id === scriptId)) {
          return null
        }
        const [next] = await this.createTransformer([current]).interruptByScriptId(scriptId)
        if (!next) return null
        try {
          return await this.patchRecord(current, next)
        } catch (error) {
          if (error instanceof RunRecordHttpError && error.status === 409 && attempt < this.conflictRetries) {
            continue
          }
          throw error
        }
      }
      return null
    })))
    return records.filter((record): record is RunRecord => record !== null)
  }

  private mutate(id: string, transition: RecordTransition): Promise<RunRecord> {
    return this.enqueueMutation(id, async () => {
      await this.ensureLegacyMigration()
      for (let attempt = 0; attempt <= this.conflictRetries; attempt += 1) {
        const current = await this.fetchRecord(id)
        if (!current) throw new Error('运行记录不存在或已被删除')
        const next = await transition(this.createTransformer([current]))
        try {
          return await this.patchRecord(current, next)
        } catch (error) {
          if (error instanceof RunRecordHttpError && error.status === 409 && attempt < this.conflictRetries) {
            continue
          }
          throw error
        }
      }
      throw new Error('运行记录更新冲突，请刷新后重试')
    })
  }

  private enqueueMutation<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTails.get(id) ?? Promise.resolve()
    const pending = previous.then(operation)
    const tail = pending.then(() => undefined, () => undefined)
    this.mutationTails.set(id, tail)
    void tail.then(() => {
      if (this.mutationTails.get(id) === tail) this.mutationTails.delete(id)
    })
    return pending
  }

  private createTransformer(records: RunRecord[]): LocalRunRecordService {
    const storage = new MemoryStorage()
    if (records.length > 0) storage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(records))
    return new LocalRunRecordService(storage, this.now, this.idFactory)
  }

  private async fetchList(): Promise<RunRecord[]> {
    const { response, payload } = await this.request('/run-records')
    this.assertOk(response, payload)
    return recordsFromPayload(payload)
  }

  private async fetchRecord(id: string): Promise<RunRecord | null> {
    const { response, payload } = await this.request(`/run-records/${encodeURIComponent(id)}`)
    if (response.status === 404) return null
    this.assertOk(response, payload)
    return recordFromPayload(payload)
  }

  private async patchRecord(current: RunRecord, next: RunRecord): Promise<RunRecord> {
    const { response, payload } = await this.request(`/run-records/${encodeURIComponent(current.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        record: next,
        expectedRevision: current.revision,
        expectedUpdatedAt: current.updatedAt,
      }),
    })
    this.assertOk(response, payload)
    const persisted = recordFromPayload(payload)
    if (
      persisted.id !== next.id ||
      persisted.revision !== next.revision ||
      persisted.updatedAt !== next.updatedAt
    ) {
      throw new Error('Runner 未完整确认运行记录更新')
    }
    return persisted
  }

  private async ensureLegacyMigration(): Promise<void> {
    if (this.migrationComplete) return
    if (!this.migrationPromise) this.migrationPromise = this.migrateLegacyRecords()
    const pending = this.migrationPromise
    try {
      await pending
    } catch (error) {
      if (this.migrationPromise === pending) this.migrationPromise = null
      throw error
    }
  }

  private async migrateLegacyRecords(): Promise<void> {
    if (!this.legacyStorage) {
      this.migrationComplete = true
      return
    }
    const raw = this.legacyStorage.getItem(LEGACY_STORAGE_KEY)
    if (raw === null) {
      this.migrationComplete = true
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      throw new Error('旧运行记录格式损坏，已保留浏览器数据，请检查后重试')
    }
    if (!Array.isArray(parsed)) {
      throw new Error('旧运行记录格式无效，已保留浏览器数据，请检查后重试')
    }

    const temporaryStorage = new MemoryStorage()
    temporaryStorage.setItem(LEGACY_STORAGE_KEY, raw)
    const normalized = await new LocalRunRecordService(temporaryStorage, this.now, this.idFactory).list()
    const records = [...new Map(normalized.map((record) => [record.id, record])).values()]
    const { response, payload } = await this.request('/run-records/migrations/local-storage-v1', {
      method: 'POST',
      body: JSON.stringify({ records }),
    })
    this.assertOk(response, payload)
    const result = migrationFromPayload(payload)
    const confirmedIds = new Set([...result.importedIds, ...result.skippedIds])
    const fullyConfirmed = result.importedCount === result.importedIds.length
      && result.skippedCount === result.skippedIds.length
      && result.importedCount + result.skippedCount === records.length
      && records.every((record) => confirmedIds.has(record.id))
    if (!fullyConfirmed) throw new Error('Runner 未完整确认旧运行记录迁移，浏览器数据已保留')

    this.legacyStorage.removeItem(LEGACY_STORAGE_KEY)
    this.migrationComplete = true
  }

  private async request(path: string, init: RequestInit = {}): Promise<{ response: Response; payload: unknown }> {
    let response: Response
    try {
      response = await this.fetcher(joinUrl(this.runnerBaseUrl, path), {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...init.headers,
        },
      })
    } catch (error) {
      const detail = error instanceof Error ? `：${error.message}` : ''
      throw new Error(`无法连接本地 Playwright Runner（${this.runnerBaseUrl}）${detail}`)
    }
    const payload = await response.json().catch(() => null) as unknown
    return { response, payload }
  }

  private assertOk(response: Response, payload: unknown): void {
    if (response.ok) return
    const message = isObject(payload) && typeof payload.error === 'string'
      ? payload.error
      : `Runner 返回 HTTP ${response.status}`
    const code = isObject(payload) && typeof payload.code === 'string' ? payload.code : undefined
    throw new RunRecordHttpError(message, response.status, code)
  }
}
