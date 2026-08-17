import { describe, expect, it, vi } from 'vitest'

import type { RunRecord } from '@/domain/run-record'
import type { EnvironmentService } from '@/services/environments/environment-service'
import type { RunRecordService } from '@/services/run-records/run-record-service'
import type { ScriptService } from '@/services/scripts/script-service'
import { LocalDashboardService } from './local-dashboard.service'

function dependencies(records: RunRecord[] = []) {
  const scripts = {
    list: vi.fn(async () => [{
      id: 'form-contact-publish',
      name: '表单联系人收录并发布',
      description: '真实脚本',
      directory: 'D:\\CursorCode\\autotest',
      entryFile: 'scripts/form-contact-publish.ui.spec.mjs',
      tags: ['Playwright'],
      status: 'ready',
      updatedAt: '暂无数据',
      lastRunAt: null,
      lastDuration: null,
    }]),
  } as unknown as ScriptService
  const environments = {
    list: vi.fn(async () => [{
      id: 'env-testing',
      name: '测试环境',
      active: true,
    }]),
  } as unknown as EnvironmentService
  const runRecords = {
    list: vi.fn(async () => structuredClone(records)),
  } as unknown as RunRecordService
  return { scripts, environments, runRecords }
}

function completedRecord(): RunRecord {
  const startedAt = '2026-08-11T02:00:00.000Z'
  const finishedAt = '2026-08-11T02:00:03.000Z'
  return {
    schemaVersion: 1,
    revision: 1,
    id: 'real-run-001',
    displayId: 'RUN-20260811-000001',
    name: '表单联系人收录并发布',
    status: 'failed',
    trigger: 'manual',
    browser: 'Chromium',
    environment: {
      id: 'env-testing',
      name: '测试环境',
      code: 'TEST',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
    },
    startedAt,
    updatedAt: finishedAt,
    finishedAt,
    durationMs: 3_000,
    failureStage: 'script',
    error: '断言未通过',
    counts: { total: 2, passed: 1, failed: 1, skipped: 0 },
    scripts: [],
    logs: [],
    analysis: {
      passRate: 50,
      averageDurationMs: 1_500,
      slowestScriptRecordId: null,
      logCounts: { info: 0, success: 0, warning: 0, error: 0 },
      failureGroups: [],
    },
  }
}

describe('LocalDashboardService', () => {
  it('shows real configuration counts and no-data metrics without run records', async () => {
    const { scripts, environments, runRecords } = dependencies()
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const service = new LocalDashboardService(scripts, environments, runRecords, {
      fetcher: fetcher as typeof fetch,
      now: () => new Date('2026-08-12T08:00:00.000Z'),
    })

    const snapshot = await service.getSnapshot()

    expect(snapshot.metrics.map((metric) => [metric.id, metric.value])).toEqual([
      ['scripts', 1],
      ['pass-rate', null],
      ['running', null],
      ['failed', null],
    ])
    expect(snapshot.trend).toEqual([])
    expect(snapshot.recentRuns).toEqual([])
    expect(snapshot.runner).toMatchObject({
      status: 'online',
      browser: null,
      activeEnvironment: '测试环境',
    })
  })

  it('derives metrics, trend and recent runs from persisted run records', async () => {
    const record = completedRecord()
    const { scripts, environments, runRecords } = dependencies([record])
    const service = new LocalDashboardService(scripts, environments, runRecords, {
      fetcher: vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch,
      now: () => new Date('2026-08-12T08:00:00.000Z'),
    })

    const snapshot = await service.getSnapshot()

    expect(snapshot.metrics.find((metric) => metric.id === 'pass-rate')?.value).toBe(50)
    expect(snapshot.metrics.find((metric) => metric.id === 'running')?.value).toBe(0)
    expect(snapshot.metrics.find((metric) => metric.id === 'failed')?.value).toBe(1)
    expect(snapshot.trend).toEqual([{ date: '08/11', passed: 1, failed: 1 }])
    expect(snapshot.recentRuns).toEqual([{
      id: record.displayId,
      name: record.name,
      environmentName: '测试环境',
      status: 'failed',
      scriptCount: 2,
      durationMs: 3_000,
      startedAt: record.startedAt,
    }])
    expect(snapshot.runner.browser).toBe('Chromium')
  })

  it('reports the runner offline when the health request fails', async () => {
    const { scripts, environments, runRecords } = dependencies()
    const service = new LocalDashboardService(scripts, environments, runRecords, {
      fetcher: vi.fn(async () => { throw new TypeError('connection refused') }) as typeof fetch,
    })

    expect((await service.getSnapshot()).runner.status).toBe('offline')
  })
})
