import { describe, expect, it } from 'vitest'

import type { RunRecord } from '@/domain/run-record'
import { LocalRunRecordService } from './local-run-record.service'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

class FailingStorage extends MemoryStorage {
  failWrites = false
  override setItem(key: string, value: string): void {
    if (this.failWrites) throw new DOMException('Quota exceeded', 'QuotaExceededError')
    super.setItem(key, value)
  }
}

class RaceStorage extends MemoryStorage {
  reads = 0
  beforeRead: ((read: number) => void) | null = null
  override getItem(key: string): string | null {
    this.reads += 1
    this.beforeRead?.(this.reads)
    return super.getItem(key)
  }
}

const firstTime = new Date('2026-08-12T08:00:00.000Z')
const secondTime = new Date('2026-08-12T08:00:03.000Z')
const thirdTime = new Date('2026-08-12T08:00:05.000Z')

function idFactory(values: string[]) {
  return () => values.shift() ?? `id-${values.length}`
}

function nowFactory(values: Date[]) {
  return () => values.shift() ?? thirdTime
}

function startDraft() {
  return {
    environment: {
      id: 'env-testing',
      name: '测试环境',
      code: 'TEST',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
    },
    scripts: [
      {
        id: 'login-regression',
        name: '登录与权限回归',
        directory: 'D:\\tests',
        entryFile: 'tests/login.spec.ts',
        tags: ['P0'],
      },
    ],
  }
}

function startDraftFor(id: string, name = id) {
  const draft = startDraft()
  draft.scripts[0] = { ...draft.scripts[0]!, id, name }
  return draft
}

function twoScriptDraft() {
  const draft = startDraft()
  draft.scripts.push({ id: 'api-smoke', name: 'API smoke', directory: 'D:\\tests', entryFile: 'tests/api.spec.ts', tags: ['P1'] })
  return draft
}

describe('LocalRunRecordService', () => {
  it('returns an empty list when no run records have been created', async () => {
    const storage = new MemoryStorage()
    const service = new LocalRunRecordService(storage, () => firstTime, () => 'unused')

    expect(await service.list()).toEqual([])
    expect(storage.getItem('autotest.run-records.v1')).toBeNull()
  })

  it('migrates only the three known legacy seed ids and preserves real records', async () => {
    const fixtureStorage = new MemoryStorage()
    const fixtureService = new LocalRunRecordService(
      fixtureStorage,
      nowFactory([firstTime, secondTime]),
      idFactory(['real-run-001', 'start-log', 'failure-log']),
    )
    const started = await fixtureService.start(startDraft())
    const realRecord = await fixtureService.fail(started.id, { stage: 'runner', error: 'fixture failure' })
    const similarIdRecord = structuredClone(realRecord)
    similarIdRecord.id = 'seed-batch-001-real'

    const storage = new MemoryStorage()
    storage.setItem('autotest.run-records.v1', JSON.stringify([
      { ...realRecord, id: 'seed-batch-001' },
      { ...realRecord, id: 'seed-batch-002' },
      { ...realRecord, id: 'seed-batch-003' },
      realRecord,
      similarIdRecord,
    ]))

    const migrated = new LocalRunRecordService(storage, () => thirdTime, () => 'unused')

    expect((await migrated.list()).map((record) => record.id)).toEqual([
      'real-run-001',
      'seed-batch-001-real',
    ])
    expect(storage.getItem('autotest.run-records.v1')).not.toContain('"id":"seed-batch-001"')
    expect(storage.getItem('autotest.run-records.v1')).toContain('"id":"seed-batch-001-real"')
  })

  it('persists a completed batch and restores its snapshots', async () => {
    const storage = new MemoryStorage()
    const service = new LocalRunRecordService(
      storage,
      nowFactory([firstTime, firstTime, secondTime, thirdTime]),
      idFactory(['run-000001', 'start-log', 'login-log', 'script-log', 'finish-log']),
    )

    const started = await service.start(startDraft())
    await service.appendLog(started.id, {
      level: 'success',
      scope: 'login',
      message: '登录成功',
    })
    const completed = await service.complete(started.id, {
      scripts: [{
        scriptId: 'login-regression',
        ok: true,
        durationMs: 1_250,
        logs: [{ timestamp: secondTime.toISOString(), level: 'success', message: '断言通过' }],
        output: { status: 'passed' },
      }],
    })

    expect(completed).toMatchObject({
      id: 'run-000001',
      status: 'passed',
      durationMs: 5_000,
      counts: { total: 1, passed: 1, failed: 0, skipped: 0 },
      environment: { id: 'env-testing', name: '测试环境' },
    })
    expect(completed.scripts[0]).toMatchObject({
      id: 'login-regression',
      name: '登录与权限回归',
      entryFile: 'tests/login.spec.ts',
      durationMs: 1_250,
      output: { status: 'passed' },
    })

    const restored = new LocalRunRecordService(storage, () => thirdTime, () => 'unused')
    expect((await restored.get(started.id))?.scripts[0]?.logs[0]?.message).toBe('断言通过')
  })

  it('appends different runs instead of overwriting history and returns clones', async () => {
    const storage = new MemoryStorage()
    const service = new LocalRunRecordService(
      storage,
      () => firstTime,
      idFactory(['run-first', 'log-first', 'run-second', 'log-second']),
    )

    const first = await service.start(startDraft())
    const second = await service.start(startDraftFor('api-smoke', 'API smoke'))
    const listed = await service.list()

    expect(listed.map((item) => item.id)).toEqual([second.id, first.id])
    listed[0]!.name = '外部篡改'
    listed[0]!.scripts[0]!.name = '外部脚本篡改'
    expect((await service.list())[0]).toMatchObject({
      name: 'API smoke',
      scripts: [{ name: 'API smoke' }],
    })
  })

  it('records a failed login and marks queued scripts as skipped', async () => {
    const service = new LocalRunRecordService(
      new MemoryStorage(),
      nowFactory([firstTime, firstTime, secondTime]),
      idFactory(['run-failed', 'start-log', 'failure-log']),
    )
    const started = await service.start(startDraft())
    const failed = await service.fail(started.id, { stage: 'login', error: '业务 code=1001' })

    expect(failed).toMatchObject({
      status: 'failed',
      failureStage: 'login',
      error: '业务 code=1001',
      counts: { total: 1, passed: 0, failed: 0, skipped: 1 },
      scripts: [{ status: 'skipped' }],
    })
  })

  it('redacts sensitive keys and known secret values before persistence', async () => {
    const storage = new MemoryStorage()
    const service = new LocalRunRecordService(
      storage,
      nowFactory([firstTime, firstTime, secondTime]),
      idFactory(['run-secret', 'start-log', 'script-log', 'finish-log']),
    )
    const started = await service.start(startDraft())
    await service.complete(started.id, {
      secretValues: ['token-value-123', '123456', '13800000000'],
      scripts: [{
        scriptId: 'login-regression',
        ok: false,
        durationMs: 500,
        error: '请求 Bearer token-value-123 失败，手机号 13800000000',
        logs: [{
          timestamp: secondTime.toISOString(),
          level: 'error',
          message: '验证码 123456，Authorization: Bearer token-value-123',
          details: {
            token: 'token-value-123',
            verify_code: '123456',
            mobile: '13800000000',
            nested: { password: 'plain-password', safe: 'visible' },
          },
        }],
        output: { access_token: 'token-value-123', state: 'failed' },
      }],
    })

    const raw = storage.getItem('autotest.run-records.v1') ?? ''
    expect(raw).not.toContain('token-value-123')
    expect(raw).not.toContain('123456')
    expect(raw).not.toContain('13800000000')
    expect(raw).not.toContain('plain-password')
    expect(raw).toContain('[REDACTED]')
    expect(raw).toContain('visible')
  })

  it('keeps recent runs active and recovers only runs stale for more than four hours', async () => {
    const storage = new MemoryStorage()
    const service = new LocalRunRecordService(
      storage,
      () => firstTime,
      idFactory(['run-running', 'start-log']),
    )
    const started = await service.start(startDraft())

    const exactlyFourHours = new Date(firstTime.getTime() + 4 * 60 * 60 * 1_000)
    const stillRunning = new LocalRunRecordService(storage, () => exactlyFourHours, () => 'unused')
    expect((await stillRunning.get(started.id))?.status).toBe('running')

    const staleTime = new Date(exactlyFourHours.getTime() + 1)
    const restored = new LocalRunRecordService(storage, () => staleTime, () => 'interrupt-log')
    const interrupted = await restored.get(started.id)

    expect(interrupted).toMatchObject({
      status: 'interrupted',
      failureStage: 'runner',
      error: '页面或 Runner 在批次完成前中断',
      scripts: [{ status: 'skipped' }],
    })
    expect((await new LocalRunRecordService(storage, () => staleTime, () => 'unused').get(started.id))?.status)
      .toBe('interrupted')
  })

  it('ignores malformed storage entries without crashing', async () => {
    const storage = new MemoryStorage()
    const source = new LocalRunRecordService(storage, () => firstTime, idFactory(['valid', 'start']))
    const valid = await source.start(startDraft())
    storage.setItem('autotest.run-records.v1', JSON.stringify([
      { id: 'broken', status: 'unknown' },
      { ...valid, scripts: [...valid.scripts, { id: 'bad nested script' }], logs: [...valid.logs, { id: 'bad nested log' }] },
    ]))
    const service = new LocalRunRecordService(storage, () => firstTime, () => 'unused')
    const restored = await service.list()
    expect(restored).toHaveLength(1)
    expect(restored[0]?.scripts).toHaveLength(1)
    expect(restored[0]?.logs).toHaveLength(1)

    storage.setItem('autotest.run-records.v1', '{not json')
    expect(await new LocalRunRecordService(storage, () => firstTime, () => 'unused').list()).toEqual([])
  })

  it('derives partial status, counts and analysis from mixed script results', async () => {
    const service = new LocalRunRecordService(new MemoryStorage(), nowFactory([firstTime, secondTime, thirdTime]), idFactory(['run-partial', 'start-log', 'passed-log', 'failed-log', 'finish-log']))
    const started = await service.start(twoScriptDraft())
    const completed = await service.complete(started.id, { scripts: [
      { scriptId: 'login-regression', ok: true, durationMs: 1_000, logs: [{ timestamp: secondTime.toISOString(), level: 'success', message: 'passed' }] },
      { scriptId: 'api-smoke', ok: false, durationMs: 3_000, error: 'assertion failed', logs: [{ timestamp: secondTime.toISOString(), level: 'error', message: 'failed' }] },
    ] })

    expect(completed).toMatchObject({
      status: 'partial',
      counts: { total: 2, passed: 1, failed: 1, skipped: 0 },
      analysis: {
        passRate: 50,
        averageDurationMs: 2_000,
        slowestScriptRecordId: `${started.id}:api-smoke`,
        logCounts: { info: 1, success: 1, warning: 1, error: 1 },
        failureGroups: [{ reason: 'assertion failed', count: 1 }],
      },
    })
  })

  it('uses a custom batch name and preserves explicitly skipped scripts', async () => {
    const service = new LocalRunRecordService(
      new MemoryStorage(),
      nowFactory([firstTime, secondTime]),
      idFactory(['run-pipeline', 'start-log', 'finish-log']),
    )
    const started = await service.start({
      ...twoScriptDraft(),
      name: '自动化配置 · 发布回归',
    })
    const completed = await service.complete(started.id, { scripts: [
      {
        scriptId: 'login-regression',
        status: 'failed',
        durationMs: 500,
        error: 'assertion failed',
        logs: [],
      },
      {
        scriptId: 'api-smoke',
        status: 'skipped',
        durationMs: 0,
        error: '前序步骤失败，未执行',
        logs: [],
      },
    ] })

    expect(completed).toMatchObject({
      name: '自动化配置 · 发布回归',
      status: 'failed',
      counts: { total: 2, passed: 0, failed: 1, skipped: 1 },
      scripts: [
        { status: 'failed', durationMs: 500 },
        { status: 'skipped', durationMs: null },
      ],
    })
  })

  it('rejects invalid state transitions and records script failures with script scope', async () => {
    const service = new LocalRunRecordService(new MemoryStorage(), nowFactory([firstTime, secondTime, thirdTime]), idFactory(['run-state', 'start-log', 'failure-log']))
    const started = await service.start(startDraft())
    const failed = await service.fail(started.id, { stage: 'script', error: 'script failed' })

    expect(failed.logs.at(-1)?.scope).toBe('script')
    await expect(service.appendLog(started.id, { level: 'info', scope: 'batch', message: 'late' })).rejects.toThrow()
    await expect(service.complete(started.id, { scripts: [] })).rejects.toThrow()
    await expect(service.fail('missing', { stage: 'runner', error: 'missing' })).rejects.toThrow()
  })

  it('keeps memory and persisted state unchanged when persistence fails', async () => {
    const storage = new FailingStorage()
    const service = new LocalRunRecordService(storage, nowFactory([firstTime, secondTime, thirdTime]), idFactory(['run-storage', 'start-log', 'new-log']))
    const started = await service.start(startDraft())
    const persistedBefore = storage.getItem('autotest.run-records.v1')
    storage.failWrites = true

    await expect(service.appendLog(started.id, { level: 'info', scope: 'runner', message: 'must roll back' }))
      .rejects.toThrow('Quota exceeded')
    expect(storage.getItem('autotest.run-records.v1')).toBe(persistedBefore)
    expect(await service.get(started.id)).toMatchObject({ revision: 0, logs: [{ id: 'start-log' }] })
  })

  it('merges records across instances and rejects stale concurrent updates', async () => {
    const storage = new RaceStorage()
    const first = new LocalRunRecordService(storage, () => firstTime, idFactory(['run-first', 'start-first']))
    const second = new LocalRunRecordService(storage, () => firstTime, idFactory(['run-second', 'start-second']))
    await first.start(startDraftFor('script-first'))
    await second.start(startDraftFor('script-second'))
    expect((await first.list()).map((record) => record.id)).toEqual(['run-second', 'run-first'])

    const target = (await first.list()).find((record) => record.id === 'run-first')!
    const readsBeforeUpdate = storage.reads
    storage.beforeRead = (read) => {
      if (read !== readsBeforeUpdate + 2) return
      storage.beforeRead = null
      const records = JSON.parse(storage.getItem('autotest.run-records.v1') ?? '[]') as RunRecord[]
      const current = records.find((record) => record.id === target.id)!
      current.revision += 1
      storage.setItem('autotest.run-records.v1', JSON.stringify(records))
    }

    await expect(first.appendLog(target.id, { level: 'info', scope: 'runner', message: 'stale update' })).rejects.toThrow()
    expect((await first.get(target.id))?.logs).toHaveLength(1)
  })

  it('redacts a complete Bearer token containing pipe characters', async () => {
    const storage = new MemoryStorage()
    const service = new LocalRunRecordService(storage, nowFactory([firstTime, secondTime, thirdTime]), idFactory(['run-pipe', 'start-log', 'failure-log']))
    const started = await service.start(startDraft())
    const fakeToken = 'fixture-prefix|fixture-token-value'
    await service.fail(started.id, { stage: 'runner', error: `request failed with Bearer ${fakeToken}` })

    const raw = storage.getItem('autotest.run-records.v1') ?? ''
    expect(raw).not.toContain(fakeToken)
    expect(raw).toContain('Bearer [REDACTED]')
  })
})
