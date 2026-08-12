import type { DashboardSnapshot } from '@/domain/dashboard'
import type { RunRecord } from '@/domain/run-record'
import type { EnvironmentService } from '@/services/environments/environment-service'
import type { RunRecordService } from '@/services/run-records/run-record-service'
import type { ScriptService } from '@/services/scripts/script-service'
import type { DashboardService } from './dashboard-service'

interface LocalDashboardServiceOptions {
  fetcher?: typeof fetch
  now?: () => Date
  runnerHealthUrl?: string
  runnerHealthTimeoutMs?: number
}

export class LocalDashboardService implements DashboardService {
  private readonly fetcher: typeof fetch
  private readonly now: () => Date
  private readonly runnerHealthUrl: string
  private readonly runnerHealthTimeoutMs: number

  constructor(
    private readonly scripts: ScriptService,
    private readonly environments: EnvironmentService,
    private readonly runRecords: RunRecordService,
    options: LocalDashboardServiceOptions = {},
  ) {
    this.fetcher = (options.fetcher ?? globalThis.fetch).bind(globalThis)
    this.now = options.now ?? (() => new Date())
    this.runnerHealthUrl = options.runnerHealthUrl ?? 'http://127.0.0.1:4310/health'
    this.runnerHealthTimeoutMs = options.runnerHealthTimeoutMs ?? 2_000
  }

  async getSnapshot(): Promise<DashboardSnapshot> {
    const [scripts, environments, records, runnerOnline] = await Promise.all([
      this.scripts.list(),
      this.environments.list(),
      this.runRecords.list(),
      this.isRunnerOnline(),
    ])
    const completedScripts = records.reduce((total, record) => total + record.counts.passed + record.counts.failed, 0)
    const passedScripts = records.reduce((total, record) => total + record.counts.passed, 0)
    const queuedScripts = records
      .filter((record) => record.status === 'running')
      .reduce((total, record) => total + record.scripts.filter((script) => script.status === 'queued').length, 0)
    const latestRecord = [...records].sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))[0]
    const hasRecords = records.length > 0

    return {
      metrics: [
        {
          id: 'scripts',
          label: '自动化脚本',
          value: scripts.length,
          delta: `${scripts.filter((script) => script.status !== 'disabled').length} 个已启用`,
          tone: 'cyan',
        },
        {
          id: 'pass-rate',
          label: '脚本通过率',
          value: completedScripts === 0 ? null : Math.round((passedScripts / completedScripts) * 1_000) / 10,
          suffix: '%',
          delta: completedScripts === 0 ? '暂无已完成脚本' : `${completedScripts} 个已完成脚本`,
          tone: 'green',
        },
        {
          id: 'running',
          label: '正在执行',
          value: hasRecords ? records.filter((record) => record.status === 'running').length : null,
          delta: hasRecords ? `${queuedScripts} 个脚本排队` : '暂无运行记录',
          tone: 'amber',
        },
        {
          id: 'failed',
          label: '待处理失败',
          value: hasRecords
            ? records.filter((record) => ['failed', 'partial', 'interrupted'].includes(record.status)).length
            : null,
          delta: hasRecords ? '失败、部分通过或中断批次' : '暂无运行记录',
          tone: 'red',
        },
      ],
      trend: this.buildTrend(records),
      recentRuns: [...records]
        .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
        .slice(0, 5)
        .map((record) => ({
          id: record.displayId,
          name: record.name,
          environmentName: record.environment.name,
          status: record.status,
          scriptCount: record.counts.total,
          durationMs: record.durationMs,
          startedAt: record.startedAt,
        })),
      runner: {
        status: runnerOnline ? 'online' : 'offline',
        browser: latestRecord?.browser ?? null,
        activeEnvironment: environments.find((environment) => environment.active)?.name ?? null,
        endpoint: this.runnerHealthUrl,
      },
    }
  }

  private buildTrend(records: RunRecord[]): DashboardSnapshot['trend'] {
    const now = this.now()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime()
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
    const points = new Map<string, { timestamp: number; passed: number; failed: number }>()

    for (const record of records) {
      const date = new Date(record.startedAt)
      const timestamp = date.getTime()
      if (!Number.isFinite(timestamp) || timestamp < start || timestamp >= end) continue
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
      const point = points.get(key) ?? {
        timestamp: new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(),
        passed: 0,
        failed: 0,
      }
      point.passed += record.counts.passed
      point.failed += record.counts.failed
      points.set(key, point)
    }

    return [...points.values()]
      .sort((left, right) => left.timestamp - right.timestamp)
      .map((point) => {
        const date = new Date(point.timestamp)
        return {
          date: `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`,
          passed: point.passed,
          failed: point.failed,
        }
      })
  }

  private async isRunnerOnline(): Promise<boolean> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.runnerHealthTimeoutMs)
    try {
      const response = await this.fetcher(this.runnerHealthUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
      if (!response.ok) return false
      const body = await response.json() as { ok?: unknown }
      return body.ok === true
    } catch {
      return false
    } finally {
      clearTimeout(timeout)
    }
  }
}
