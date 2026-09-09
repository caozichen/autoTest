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

  it('replaces live script snapshots and does not duplicate their logs on completion', async () => {
    let nextId = 0
    const service = new LocalRunRecordService(
      new MemoryStorage(),
      nowFactory([firstTime, secondTime, thirdTime, thirdTime]),
      () => `live-${++nextId}`,
    )
    const started = await service.start(startDraft())
    const firstLog = {
      timestamp: '2026-08-12T08:00:01.000Z',
      level: 'info' as const,
      message: '开始填写表单',
    }
    const secondLog = {
      timestamp: '2026-08-12T08:00:02.000Z',
      level: 'success' as const,
      message: '表单提交完成',
    }
    const liveResource = {
      sequence: 1,
      timestamp: '2026-08-12T08:00:01.500Z',
      name: 'app.js',
      method: 'GET',
      url: 'https://example.test/app.js',
      resourceType: 'script',
      status: 200,
      ok: true,
      durationMs: 12,
    }

    await service.updateScriptProgress(started.id, {
      scriptId: 'login-regression',
      status: 'running',
      durationMs: 1_000,
      logs: [firstLog],
    })
    const live = await service.updateScriptProgress(started.id, {
      scriptId: 'login-regression',
      status: 'passed',
      durationMs: 2_000,
      logs: [firstLog, secondLog],
      resourceResponses: [liveResource],
      networkSummary: {
        api: { observed: 0, recorded: 0, dropped: 0, passed: 0, failed: 0, warnings: 0 },
        resources: { observed: 1, recorded: 1, dropped: 0, passed: 1, failed: 0, warnings: 0 },
      },
    })

    expect(live.scripts[0]).toMatchObject({ status: 'passed', durationMs: 2_000 })
    expect(live.logs.filter((log) => log.scope === 'script').map((log) => log.message))
      .toEqual(['开始填写表单', '表单提交完成'])

    const completed = await service.complete(started.id, { scripts: [{
      scriptId: 'login-regression',
      ok: true,
      durationMs: 2_000,
      logs: [firstLog, secondLog],
    }] })
    expect(completed.status).toBe('passed')
    expect(completed.logs.filter((log) => log.scope === 'script').map((log) => log.message))
      .toEqual(['开始填写表单', '表单提交完成'])
    expect(completed.scripts[0]?.resourceResponses).toEqual([liveResource])
    expect(completed.scripts[0]?.networkSummary.resources).toMatchObject({ observed: 1, passed: 1 })
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

  it('restores legacy script records without artifact or network metadata using empty defaults', async () => {
    const storage = new MemoryStorage()
    const service = new LocalRunRecordService(
      storage,
      nowFactory([firstTime, secondTime]),
      idFactory(['legacy-run-001', 'start-log', 'failure-log']),
    )
    const started = await service.start(startDraft())
    const completed = await service.fail(started.id, { stage: 'runner', error: 'fixture failure' })
    const legacyRecord = structuredClone(completed) as RunRecord & {
      scripts: Array<RunRecord['scripts'][number] & {
        artifacts?: RunRecord['scripts'][number]['artifacts']
        resourceResponses?: RunRecord['scripts'][number]['resourceResponses']
        networkSummary?: RunRecord['scripts'][number]['networkSummary']
      }>
    }
    delete legacyRecord.scripts[0]?.artifacts
    delete legacyRecord.scripts[0]?.resourceResponses
    delete legacyRecord.scripts[0]?.networkSummary
    storage.setItem('autotest.run-records.v1', JSON.stringify([legacyRecord]))

    const restored = new LocalRunRecordService(storage, () => thirdTime, () => 'unused')

    expect((await restored.get(started.id))?.scripts[0]?.artifacts).toEqual([])
    expect((await restored.get(started.id))?.scripts[0]?.resourceResponses).toEqual([])
    expect((await restored.get(started.id))?.scripts[0]?.networkSummary).toEqual({
      api: { observed: 0, recorded: 0, dropped: 0, passed: 0, failed: 0, warnings: 0 },
      resources: { observed: 0, recorded: 0, dropped: 0, passed: 0, failed: 0, warnings: 0 },
    })
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
        assertions: [{
          sequence: 1,
          timestamp: secondTime.toISOString(),
          name: '单项选择应显示三个选项',
          module: '单项选择',
          matcher: 'toHaveCount',
          status: 'passed',
          durationMs: 8.4,
        }],
        apiResponses: [{
          sequence: 1,
          timestamp: secondTime.toISOString(),
          name: '/api/be/form',
          method: 'POST',
          url: 'https://lx.admin.lingxi.tech/api/be/form',
          status: 200,
          ok: true,
          durationMs: 26,
          requestBody: { title: '完整表单' },
          responseBody: { code: 0, data: { id: 'form-1' } },
          phase: '创建表单',
          pageUrl: 'https://lx.admin.lingxi.tech/forms',
          frameUrl: 'https://lx.admin.lingxi.tech/forms',
          mimeType: 'application/json',
          isFirstParty: true,
          bodyReadError: 'Network.getResponseBody: body released after navigation',
          warning: true,
          incomplete: true,
        }],
        resourceResponses: [{
          sequence: 1,
          timestamp: secondTime.toISOString(),
          name: 'app.js',
          method: 'GET',
          url: 'https://lx.admin.lingxi.tech/assets/app.js',
          resourceType: 'script',
          status: 503,
          ok: false,
          durationMs: 320,
          phase: '页面初始化',
          pageUrl: 'https://lx.admin.lingxi.tech/forms',
          frameUrl: 'https://lx.admin.lingxi.tech/forms',
          mimeType: 'application/javascript',
          error: 'Service Unavailable',
          failureKind: 'http',
          fromCache: false,
          fromServiceWorker: false,
          isFirstParty: true,
        }],
        networkSummary: {
          api: { observed: 1, recorded: 1, dropped: 0, passed: 0, failed: 0, warnings: 1 },
          resources: { observed: 3, recorded: 1, dropped: 2, passed: 2, failed: 1, warnings: 0 },
        },
        artifacts: [{
          executionId: 'run-000001',
          stepId: 'login-regression',
          attemptId: 'runner-run-0001',
          absolutePath: '/workspace/outputs/artifacts/run-000001/login-regression/runner-run-0001/failure.png',
          relativePath: 'failure.png',
          type: 'screenshot',
          mimeType: 'image/png',
          sizeBytes: 512,
          createdAt: secondTime.toISOString(),
        }],
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
    expect((await restored.get(started.id))?.scripts[0]?.assertions).toEqual([{
      sequence: 1,
      timestamp: secondTime.toISOString(),
      name: '单项选择应显示三个选项',
      module: '单项选择',
      matcher: 'toHaveCount',
      status: 'passed',
      durationMs: 8.4,
    }])
    expect((await restored.get(started.id))?.scripts[0]?.apiResponses).toEqual([{
      sequence: 1,
      timestamp: secondTime.toISOString(),
      name: '/api/be/form',
      method: 'POST',
      url: 'https://lx.admin.lingxi.tech/api/be/form',
      status: 200,
      ok: true,
      durationMs: 26,
      requestBody: { title: '完整表单' },
      responseBody: { code: 0, data: { id: 'form-1' } },
      phase: '创建表单',
      pageUrl: 'https://lx.admin.lingxi.tech/forms',
      frameUrl: 'https://lx.admin.lingxi.tech/forms',
      mimeType: 'application/json',
      isFirstParty: true,
      bodyReadError: 'Network.getResponseBody: body released after navigation',
      warning: true,
      incomplete: true,
    }])
    expect((await restored.get(started.id))?.scripts[0]?.resourceResponses).toEqual([{
      sequence: 1,
      timestamp: secondTime.toISOString(),
      name: 'app.js',
      method: 'GET',
      url: 'https://lx.admin.lingxi.tech/assets/app.js',
      resourceType: 'script',
      status: 503,
      ok: false,
      durationMs: 320,
      phase: '页面初始化',
      pageUrl: 'https://lx.admin.lingxi.tech/forms',
      frameUrl: 'https://lx.admin.lingxi.tech/forms',
      mimeType: 'application/javascript',
      error: 'Service Unavailable',
      failureKind: 'http',
      fromCache: false,
      fromServiceWorker: false,
      isFirstParty: true,
    }])
    expect((await restored.get(started.id))?.scripts[0]?.networkSummary).toEqual({
      api: { observed: 1, recorded: 1, dropped: 0, passed: 0, failed: 0, warnings: 1 },
      resources: { observed: 3, recorded: 1, dropped: 2, passed: 2, failed: 1, warnings: 0 },
    })
    expect((await restored.get(started.id))?.scripts[0]?.artifacts).toEqual([{
      executionId: 'run-000001',
      stepId: 'login-regression',
      attemptId: 'runner-run-0001',
      absolutePath: '/workspace/outputs/artifacts/run-000001/login-regression/runner-run-0001/failure.png',
      relativePath: 'failure.png',
      type: 'screenshot',
      mimeType: 'image/png',
      sizeBytes: 512,
      createdAt: secondTime.toISOString(),
    }])
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
        assertions: [{
          sequence: 1,
          timestamp: secondTime.toISOString(),
          name: '手机号 13800000000 对应验证码 123456 应通过',
          module: '手机号',
          matcher: 'toBeTruthy',
          status: 'failed',
          durationMs: 5,
          error: 'Bearer token-value-123 对应断言失败',
        }],
        apiResponses: [{
          sequence: 1,
          timestamp: secondTime.toISOString(),
          name: '提交 token-value-123',
          method: 'POST',
          url: 'https://api.example.test/form?token=token-value-123',
          status: 0,
          ok: false,
          durationMs: 20,
          pageUrl: 'https://example.test/forms/13800000000',
          frameUrl: 'https://example.test/forms/13800000000',
          error: 'Bearer token-value-123 请求失败',
          bodyReadError: '响应正文包含 token-value-123',
        }],
        resourceResponses: [{
          sequence: 1,
          timestamp: secondTime.toISOString(),
          name: 'token-value-123.png',
          method: 'GET',
          url: 'https://cdn.example.test/token-value-123.png',
          resourceType: 'image',
          status: 0,
          ok: false,
          durationMs: 20,
          pageUrl: 'https://example.test/forms/13800000000',
          frameUrl: 'https://example.test/forms/13800000000',
          error: '资源 token-value-123 加载失败',
          diagnostics: ['CORS 拒绝 token-value-123'],
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
    const restoredAssertion = (await new LocalRunRecordService(storage, () => thirdTime, () => 'unused')
      .get(started.id))?.scripts[0]?.assertions[0]
    expect(restoredAssertion).toMatchObject({
      name: '手机号 [REDACTED] 对应验证码 [REDACTED] 应通过',
      error: 'Bearer [REDACTED] 对应断言失败',
    })
    const restoredScript = (await new LocalRunRecordService(storage, () => thirdTime, () => 'unused')
      .get(started.id))?.scripts[0]
    expect(restoredScript?.apiResponses[0]).toMatchObject({
      name: '提交 [REDACTED]',
      url: 'https://api.example.test/form?token=[REDACTED]',
      pageUrl: 'https://example.test/forms/[REDACTED]',
      error: 'Bearer [REDACTED] 请求失败',
      bodyReadError: '响应正文包含 [REDACTED]',
    })
    expect(restoredScript?.resourceResponses[0]).toMatchObject({
      name: '[REDACTED].png',
      url: 'https://cdn.example.test/[REDACTED].png',
      pageUrl: 'https://example.test/forms/[REDACTED]',
      error: '资源 [REDACTED] 加载失败',
      diagnostics: ['CORS 拒绝 [REDACTED]'],
    })
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

  it('immediately interrupts running batches by script id and persists the unlock', async () => {
    const storage = new MemoryStorage()
    const service = new LocalRunRecordService(
      storage,
      nowFactory([firstTime, secondTime, thirdTime]),
      idFactory(['run-force-stop', 'start-log', 'force-stop-log']),
    )
    const started = await service.start(startDraft())

    const interrupted = await service.interruptByScriptId('login-regression')

    expect(interrupted).toHaveLength(1)
    expect(interrupted[0]).toMatchObject({
      id: started.id,
      status: 'interrupted',
      failureStage: 'runner',
      error: '用户已强制停止脚本“登录与权限回归”',
      durationMs: 5_000,
      counts: { total: 1, passed: 0, failed: 0, skipped: 1 },
      scripts: [{ id: 'login-regression', status: 'skipped' }],
    })
    expect(interrupted[0]?.logs.at(-1)).toMatchObject({
      id: 'force-stop-log',
      level: 'warning',
      scope: 'runner',
    })
    expect(await service.interruptByScriptId('login-regression')).toEqual([])
    expect((await new LocalRunRecordService(storage, () => thirdTime, () => 'unused').get(started.id))?.status)
      .toBe('interrupted')
    await expect(service.complete(started.id, { scripts: [] })).rejects.toThrow('已经结束')
  })

  it('interrupts only the requested running batch by record id', async () => {
    const storage = new MemoryStorage()
    const service = new LocalRunRecordService(
      storage,
      nowFactory([firstTime, secondTime, thirdTime]),
      idFactory(['run-target', 'start-log', 'interrupt-log']),
    )
    const started = await service.start(startDraft())

    const interrupted = await service.interrupt(started.id, '用户已强制停止自动化配置“发布回归”')

    expect(interrupted).toMatchObject({
      id: started.id,
      status: 'interrupted',
      failureStage: 'runner',
      error: '用户已强制停止自动化配置“发布回归”',
      counts: { total: 1, passed: 0, failed: 0, skipped: 1 },
      scripts: [{ id: 'login-regression', status: 'skipped' }],
    })
    expect(interrupted.logs.at(-1)).toMatchObject({
      id: 'interrupt-log',
      level: 'warning',
      scope: 'runner',
      message: '用户已强制停止自动化配置“发布回归”',
    })
  })

  it('ignores malformed storage entries without crashing', async () => {
    const storage = new MemoryStorage()
    const source = new LocalRunRecordService(storage, () => firstTime, idFactory(['valid', 'start']))
    const valid = await source.start(startDraft())
    const validScript = valid.scripts[0]!
    storage.setItem('autotest.run-records.v1', JSON.stringify([
      { id: 'broken', status: 'unknown' },
      {
        ...valid,
        scripts: [{
          ...validScript,
          assertions: [
            {
              sequence: 1,
              timestamp: firstTime.toISOString(),
              name: '合法断言',
              module: '基础运行流程',
              matcher: 'toBeTruthy',
              status: 'passed',
              durationMs: 1,
            },
            { sequence: 0, timestamp: 'invalid', status: 'unknown' },
          ],
        }, ...valid.scripts.slice(1), { id: 'bad nested script' }],
        logs: [...valid.logs, { id: 'bad nested log' }],
      },
    ]))
    const service = new LocalRunRecordService(storage, () => firstTime, () => 'unused')
    const restored = await service.list()
    expect(restored).toHaveLength(1)
    expect(restored[0]?.scripts).toHaveLength(1)
    expect(restored[0]?.logs).toHaveLength(1)
    expect(restored[0]?.scripts[0]?.assertions).toHaveLength(1)
    expect(restored[0]?.scripts[0]?.assertions[0]?.name).toBe('合法断言')

    storage.setItem('autotest.run-records.v1', '{not json')
    expect(await new LocalRunRecordService(storage, () => firstTime, () => 'unused').list()).toEqual([])
  })

  it('keeps a batch failed when any script has a hard failure', async () => {
    const service = new LocalRunRecordService(new MemoryStorage(), nowFactory([firstTime, secondTime, thirdTime]), idFactory(['run-failed', 'start-log', 'passed-log', 'failed-log', 'finish-log']))
    const started = await service.start(twoScriptDraft())
    const completed = await service.complete(started.id, { scripts: [
      { scriptId: 'login-regression', ok: true, durationMs: 1_000, logs: [{ timestamp: secondTime.toISOString(), level: 'success', message: 'passed' }] },
      { scriptId: 'api-smoke', ok: false, durationMs: 3_000, error: 'assertion failed', logs: [{ timestamp: secondTime.toISOString(), level: 'error', message: 'failed' }] },
    ] })

    expect(completed).toMatchObject({
      status: 'failed',
      counts: { total: 2, passed: 1, partial: 0, failed: 1, skipped: 0 },
      analysis: {
        passRate: 50,
        averageDurationMs: 2_000,
        slowestScriptRecordId: `${started.id}:api-smoke`,
        logCounts: { info: 1, success: 1, warning: 1, error: 1 },
        failureGroups: [{ reason: 'assertion failed', count: 1 }],
      },
    })
  })

  it('derives partial status, counts and strict pass rate from assertion-only issues', async () => {
    const service = new LocalRunRecordService(
      new MemoryStorage(),
      nowFactory([firstTime, secondTime, thirdTime]),
      idFactory(['run-partial', 'start-log', 'passed-log', 'partial-log', 'finish-log']),
    )
    const started = await service.start(twoScriptDraft())
    const completed = await service.complete(started.id, { scripts: [
      {
        scriptId: 'login-regression',
        status: 'passed',
        durationMs: 1_000,
        logs: [{ timestamp: secondTime.toISOString(), level: 'success', message: 'passed' }],
      },
      {
        scriptId: 'api-smoke',
        status: 'partial',
        durationMs: 3_000,
        error: '脚本已执行完成，共有 1 条断言失败',
        logs: [{ timestamp: secondTime.toISOString(), level: 'warning', message: 'assertion issue' }],
      },
    ] })

    expect(completed).toMatchObject({
      status: 'partial',
      counts: { total: 2, passed: 1, partial: 1, failed: 0, skipped: 0 },
      analysis: {
        passRate: 50,
        averageDurationMs: 2_000,
        slowestScriptRecordId: `${started.id}:api-smoke`,
        failureGroups: [],
      },
      scripts: [
        { status: 'passed' },
        { status: 'partial' },
      ],
    })
  })

  it('migrates only legacy assertion-completion failures to partial', async () => {
    const storage = new MemoryStorage()
    const source = new LocalRunRecordService(
      storage,
      nowFactory([firstTime, secondTime]),
      idFactory(['run-legacy-partial', 'start-log', 'script-log', 'finish-log']),
    )
    const started = await source.start(startDraft())
    await source.complete(started.id, { scripts: [{
      scriptId: 'login-regression',
      status: 'failed',
      durationMs: 500,
      error: '脚本已执行完成，共有 2 条断言失败',
      logs: [],
    }] })

    const restored = await new LocalRunRecordService(storage, () => thirdTime, () => 'unused')
      .get(started.id)

    expect(restored).toMatchObject({
      status: 'partial',
      counts: { total: 1, passed: 0, partial: 1, failed: 0, skipped: 0 },
      scripts: [{ status: 'partial' }],
    })
  })

  it('treats an unfinished completed batch as failed even when another script is partial', async () => {
    const service = new LocalRunRecordService(
      new MemoryStorage(),
      nowFactory([firstTime, secondTime]),
      idFactory(['run-blocked', 'start-log', 'partial-log', 'finish-log']),
    )
    const started = await service.start(twoScriptDraft())
    const completed = await service.complete(started.id, { scripts: [
      {
        scriptId: 'login-regression',
        status: 'partial',
        durationMs: 500,
        error: '脚本已执行完成，共有 1 条断言失败',
        logs: [],
      },
      {
        scriptId: 'api-smoke',
        status: 'skipped',
        durationMs: 0,
        error: '前序步骤阻断，未执行',
        logs: [],
      },
    ] })

    expect(completed).toMatchObject({
      status: 'failed',
      counts: { total: 2, passed: 0, partial: 1, failed: 0, skipped: 1 },
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
