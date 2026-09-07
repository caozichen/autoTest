import { describe, expect, it, vi } from 'vitest'

import type { RunRecord, StartRunRecordDraft } from '@/domain/run-record'
import { LocalRunRecordService } from './local-run-record.service'
import { HttpRunRecordService } from './http-run-record.service'

const STORAGE_KEY = 'autotest.run-records.v1'
const NOW = new Date('2026-08-31T08:00:00.000Z')

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  failRemoveCount = 0

  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void {
    if (this.failRemoveCount > 0) {
      this.failRemoveCount -= 1
      throw new Error('remove failed')
    }
    this.values.delete(key)
  }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

interface FakeRunnerState {
  records: Map<string, RunRecord>
  migrationRequests: number
  migrationFailure: boolean
  incompleteMigrationConfirmation: boolean
  patchConflicts: number
  patchExpectedRevisions: number[]
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function recordSummary(record: RunRecord): RunRecord {
  return {
    ...structuredClone(record),
    logs: [],
    scripts: record.scripts.map(({ output: _output, ...script }) => ({
      ...structuredClone(script),
      logs: [],
      assertions: [],
      apiResponses: [],
    })),
  }
}

function createFakeRunner() {
  const state: FakeRunnerState = {
    records: new Map(),
    migrationRequests: 0,
    migrationFailure: false,
    incompleteMigrationConfirmation: false,
    patchConflicts: 0,
    patchExpectedRevisions: [],
  }
  const fetcher = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const method = init.method ?? 'GET'
    const path = url.pathname
    const body = init.body === undefined ? null : JSON.parse(String(init.body)) as Record<string, unknown>

    if (path === '/run-records/migrations/local-storage-v1' && method === 'POST') {
      state.migrationRequests += 1
      if (state.migrationFailure) {
        return jsonResponse({ code: 'MIGRATION_FAILED', error: 'migration failed' }, 500)
      }
      if (state.incompleteMigrationConfirmation) {
        return jsonResponse({ importedCount: 0, skippedCount: 0, importedIds: [], skippedIds: [] })
      }
      const records = (body?.records ?? []) as RunRecord[]
      const importedIds: string[] = []
      const skippedIds: string[] = []
      for (const record of records) {
        if (state.records.has(record.id)) {
          skippedIds.push(record.id)
        } else {
          state.records.set(record.id, structuredClone(record))
          importedIds.push(record.id)
        }
      }
      return jsonResponse({
        importedCount: importedIds.length,
        skippedCount: skippedIds.length,
        importedIds,
        skippedIds,
      })
    }

    if (path === '/run-records' && method === 'GET') {
      return jsonResponse({ records: [...state.records.values()].map(recordSummary) })
    }
    if (path === '/run-records' && method === 'POST') {
      const record = structuredClone(body?.record) as RunRecord
      if (state.records.has(record.id)) return jsonResponse({ error: 'record exists' }, 409)
      state.records.set(record.id, record)
      return jsonResponse({ record: structuredClone(record) }, 201)
    }

    const detailMatch = path.match(/^\/run-records\/([^/]+)$/)
    if (detailMatch) {
      const id = decodeURIComponent(detailMatch[1] ?? '')
      const current = state.records.get(id)
      if (!current) return jsonResponse({ error: 'not found' }, 404)
      if (method === 'GET') return jsonResponse({ record: structuredClone(current) })
      if (method === 'PATCH') {
        const expectedRevision = body?.expectedRevision as number
        const expectedUpdatedAt = body?.expectedUpdatedAt as string
        state.patchExpectedRevisions.push(expectedRevision)
        if (state.patchConflicts > 0) {
          state.patchConflicts -= 1
          const external = structuredClone(current)
          external.revision += 1
          external.updatedAt = '2026-08-31T08:00:01.000Z'
          external.logs.push({
            id: 'external-log',
            timestamp: external.updatedAt,
            level: 'info',
            scope: 'runner',
            message: '其它页面写入',
          })
          state.records.set(id, external)
          return jsonResponse({ code: 'RUN_RECORD_CONFLICT', error: 'conflict' }, 409)
        }
        if (current.revision !== expectedRevision || current.updatedAt !== expectedUpdatedAt) {
          return jsonResponse({ code: 'RUN_RECORD_CONFLICT', error: 'conflict' }, 409)
        }
        const record = structuredClone(body?.record) as RunRecord
        state.records.set(id, record)
        return jsonResponse({ record: structuredClone(record) })
      }
    }

    return jsonResponse({ error: 'not found' }, 404)
  }) as unknown as typeof fetch
  return { state, fetcher }
}

function startDraft(scriptId = 'login-regression'): StartRunRecordDraft {
  return {
    environment: {
      id: 'env-testing',
      name: '测试环境',
      code: 'TEST',
      apiBaseUrl: 'https://example.test/api',
    },
    scripts: [{
      id: scriptId,
      name: scriptId,
      directory: 'scripts',
      entryFile: `${scriptId}.spec.mjs`,
      tags: ['P0'],
    }],
  }
}

function sequence(values: string[]): () => string {
  let fallback = 0
  return () => values.shift() ?? `generated-${String(fallback += 1).padStart(8, '0')}`
}

function createService(
  runner: ReturnType<typeof createFakeRunner>,
  storage: Storage = new MemoryStorage(),
): HttpRunRecordService {
  return new HttpRunRecordService({
    fetcher: runner.fetcher,
    runnerBaseUrl: 'http://127.0.0.1:4310',
    legacyStorage: storage,
    now: () => NOW,
    idFactory: sequence(['run-http-0001', 'start-log-0001']),
  })
}

function createServiceWithRequestTimeout(
  fetcher: typeof fetch,
  requestTimeoutMs = 10,
): HttpRunRecordService {
  const options: ConstructorParameters<typeof HttpRunRecordService>[0] & {
    requestTimeoutMs: number
  } = {
    fetcher,
    runnerBaseUrl: 'http://127.0.0.1:4310',
    legacyStorage: new MemoryStorage(),
    now: () => NOW,
    idFactory: sequence(['run-http-0001', 'start-log-0001']),
    requestTimeoutMs,
  }
  return new HttpRunRecordService(options)
}

function settleWithin<T>(promise: Promise<T>, timeoutMs = 250): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      reject(new Error(`operation did not settle within ${timeoutMs}ms`))
    }, timeoutMs)
    void promise.then(
      (value) => {
        globalThis.clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        globalThis.clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

async function createLegacyRecord(): Promise<RunRecord> {
  return new LocalRunRecordService(
    new MemoryStorage(),
    () => NOW,
    sequence(['legacy-run-0001', 'legacy-log-0001']),
  ).start(startDraft())
}

describe('HttpRunRecordService', () => {
  it('creates and reads records through Runner without writing new data to browser storage', async () => {
    const runner = createFakeRunner()
    const storage = new MemoryStorage()
    const service = createService(runner, storage)

    const started = await service.start(startDraft())

    expect(started.id).toBe('run-http-0001')
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
    expect(runner.state.records.get(started.id)).toEqual(started)
    expect((await service.get(started.id))?.id).toBe(started.id)
    expect((await service.list()).map((record) => record.id)).toEqual([started.id])
  })

  it('rejects when the Runner fetch never settles', async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch
    const service = createServiceWithRequestTimeout(fetcher)

    await expect(settleWithin(service.list())).rejects.toThrow(/超时/)
  })

  it('rejects when parsing the Runner response never settles', async () => {
    const response = jsonResponse({ records: [] })
    vi.spyOn(response, 'json').mockImplementation(() => new Promise<never>(() => undefined))
    const fetcher = vi.fn(async () => response) as unknown as typeof fetch
    const service = createServiceWithRequestTimeout(fetcher)

    await expect(settleWithin(service.list())).rejects.toThrow(/超时/)
  })

  it('reconciles a created record when its response body times out after commit', async () => {
    const runner = createFakeRunner()
    let hangCreateResponse = true
    const fetcher = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const response = await runner.fetcher(input, init)
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      if (hangCreateResponse && url.pathname === '/run-records' && init.method === 'POST') {
        hangCreateResponse = false
        vi.spyOn(response, 'json').mockImplementation(() => new Promise<never>(() => undefined))
      }
      return response
    }) as unknown as typeof fetch
    const service = createServiceWithRequestTimeout(fetcher)

    const started = await settleWithin(service.start(startDraft()))

    expect(started).toMatchObject({ id: 'run-http-0001', status: 'running', revision: 0 })
    expect(runner.state.records.get(started.id)).toEqual(started)
  })

  it('reconciles a committed progress PATCH before running the queued completion', async () => {
    const runner = createFakeRunner()
    let hangProgressResponse = false
    const fetcher = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const response = await runner.fetcher(input, init)
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      if (hangProgressResponse && init.method === 'PATCH' && /^\/run-records\/[^/]+$/.test(url.pathname)) {
        hangProgressResponse = false
        vi.spyOn(response, 'json').mockImplementation(() => new Promise<never>(() => undefined))
      }
      return response
    }) as unknown as typeof fetch
    const service = createServiceWithRequestTimeout(fetcher)
    const started = await service.start(startDraft())
    hangProgressResponse = true

    const progressPromise = service.updateScriptProgress(started.id, {
      scriptId: 'login-regression',
      status: 'running',
      durationMs: 100,
      logs: [{ timestamp: NOW.toISOString(), level: 'info', message: '实时步骤' }],
    })
    const completePromise = service.complete(started.id, {
      scripts: [{
        scriptId: 'login-regression',
        ok: true,
        durationMs: 200,
        logs: [{ timestamp: NOW.toISOString(), level: 'success', message: '执行完成' }],
      }],
    })

    await expect(settleWithin(progressPromise)).resolves.toMatchObject({ revision: 1, status: 'running' })
    await expect(settleWithin(completePromise)).resolves.toMatchObject({ revision: 2, status: 'passed' })
    expect(runner.state.patchExpectedRevisions).toEqual([0, 1])
  })

  it('releases a record mutation tail after a request timeout', async () => {
    const runner = createFakeRunner()
    let hangNextDetailRead = false
    const fetcher = vi.fn((input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      const method = init.method ?? 'GET'
      if (hangNextDetailRead && method === 'GET' && /^\/run-records\/[^/]+$/.test(url.pathname)) {
        hangNextDetailRead = false
        return new Promise<Response>(() => undefined)
      }
      return runner.fetcher(input, init)
    }) as unknown as typeof fetch
    const service = createServiceWithRequestTimeout(fetcher)
    const started = await service.start(startDraft())
    hangNextDetailRead = true

    const timedOutMutation = service.appendLog(started.id, {
      level: 'info',
      scope: 'runner',
      message: '该写入应超时',
    })
    const followingMutation = service.appendLog(started.id, {
      level: 'success',
      scope: 'runner',
      message: '超时后继续写入',
    })

    await expect(settleWithin(timedOutMutation)).rejects.toThrow(/超时/)
    await expect(settleWithin(followingMutation)).resolves.toMatchObject({
      revision: 1,
      status: 'running',
    })
    const persistedMessages = (await service.get(started.id))?.logs.map((log) => log.message)
    expect(persistedMessages).toContain('超时后继续写入')
    expect(persistedMessages).not.toContain('该写入应超时')
  })

  it('serializes live progress and completion so the final update cannot overwrite a newer revision', async () => {
    const runner = createFakeRunner()
    const service = createService(runner)
    const started = await service.start(startDraft())
    const liveLog = {
      timestamp: NOW.toISOString(),
      level: 'info' as const,
      message: '实时步骤',
    }

    const progressPromise = service.updateScriptProgress(started.id, {
      scriptId: 'login-regression',
      status: 'running',
      durationMs: 100,
      logs: [liveLog],
    })
    const completePromise = service.complete(started.id, {
      scripts: [{
        scriptId: 'login-regression',
        ok: true,
        durationMs: 200,
        logs: [{ ...liveLog, level: 'success', message: '执行完成' }],
      }],
    })

    await expect(progressPromise).resolves.toMatchObject({ revision: 1, status: 'running' })
    const completed = await completePromise
    expect(runner.state.patchExpectedRevisions).toEqual([0, 1])
    expect(completed).toMatchObject({ revision: 2, status: 'passed' })
    expect(completed.logs.filter((log) => log.message === '执行完成')).toHaveLength(1)
    expect(completed.logs.some((log) => log.message === '实时步骤')).toBe(false)
    expect((await service.list())[0]).toMatchObject({
      id: started.id,
      status: 'passed',
      counts: { passed: 1 },
      logs: [],
      scripts: [{ status: 'passed', logs: [], assertions: [], apiResponses: [] }],
    })
    expect((await service.get(started.id))?.logs.some((log) => log.message === '执行完成')).toBe(true)
  })

  it('reloads and reapplies a mutation after a CAS conflict', async () => {
    const runner = createFakeRunner()
    const service = createService(runner)
    const started = await service.start(startDraft())
    runner.state.patchConflicts = 1

    const updated = await service.appendLog(started.id, {
      level: 'success',
      scope: 'login',
      message: '当前页面写入',
    })

    expect(runner.state.patchExpectedRevisions).toEqual([0, 1])
    expect(updated.revision).toBe(2)
    expect(updated.logs.map((log) => log.message)).toEqual([
      '手动运行批次已创建，等待环境登录',
      '其它页面写入',
      '当前页面写入',
    ])
  })

  it('removes the legacy key only after Runner confirms every migrated record', async () => {
    const runner = createFakeRunner()
    const storage = new MemoryStorage()
    const legacy = await createLegacyRecord()
    storage.setItem(STORAGE_KEY, JSON.stringify([legacy]))
    const service = createService(runner, storage)

    expect((await service.list()).map((record) => record.id)).toEqual([legacy.id])
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
    expect(runner.state.migrationRequests).toBe(1)
  })

  it('keeps legacy data after migration failure and retries successfully later', async () => {
    const runner = createFakeRunner()
    const storage = new MemoryStorage()
    const legacy = await createLegacyRecord()
    const raw = JSON.stringify([legacy])
    storage.setItem(STORAGE_KEY, raw)
    runner.state.migrationFailure = true
    const service = createService(runner, storage)

    await expect(service.list()).rejects.toThrow('migration failed')
    expect(storage.getItem(STORAGE_KEY)).toBe(raw)

    runner.state.migrationFailure = false
    await expect(service.list()).resolves.toHaveLength(1)
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
    expect(runner.state.migrationRequests).toBe(2)
  })

  it('uses the idempotent migration endpoint again when local deletion previously failed', async () => {
    const runner = createFakeRunner()
    const storage = new MemoryStorage()
    const legacy = await createLegacyRecord()
    storage.setItem(STORAGE_KEY, JSON.stringify([legacy]))
    storage.failRemoveCount = 1
    const service = createService(runner, storage)

    await expect(service.list()).rejects.toThrow('remove failed')
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull()
    expect(runner.state.records.has(legacy.id)).toBe(true)

    await expect(service.list()).resolves.toHaveLength(1)
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
    expect(runner.state.migrationRequests).toBe(2)
  })

  it('retains legacy data when the migration confirmation is incomplete', async () => {
    const runner = createFakeRunner()
    const storage = new MemoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify([await createLegacyRecord()]))
    runner.state.incompleteMigrationConfirmation = true
    const service = createService(runner, storage)

    await expect(service.list()).rejects.toThrow('未完整确认')
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull()
  })

  it('interrupts only running records that contain the requested script', async () => {
    const runner = createFakeRunner()
    const firstService = createService(runner)
    const first = await firstService.start(startDraft('script-target'))
    const secondService = new HttpRunRecordService({
      fetcher: runner.fetcher,
      runnerBaseUrl: 'http://127.0.0.1:4310',
      legacyStorage: new MemoryStorage(),
      now: () => NOW,
      idFactory: sequence(['run-http-0002', 'start-log-0002']),
    })
    const second = await secondService.start(startDraft('script-other'))

    const interrupted = await firstService.interruptByScriptId('script-target')

    expect(interrupted).toMatchObject([{ id: first.id, status: 'interrupted' }])
    expect((await firstService.get(second.id))?.status).toBe('running')
  })
})
