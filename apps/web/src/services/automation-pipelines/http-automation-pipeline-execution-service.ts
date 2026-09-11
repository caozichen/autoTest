import { runtimeConfig } from '@/config/runtime'
import type { AutomationPipeline } from '@/domain/automation-pipeline'
import type { RunRecord } from '@/domain/run-record'
import type { PipelineExecutionSnapshot, AutomationPipelineExecutionDependencies, AutomationPipelineExecutionService, AutomationPipelineStopResult } from './automation-pipeline-execution-service'

interface Options { fetcher?: typeof fetch; runnerBaseUrl?: string; pollIntervalMs?: number; requestTimeoutMs?: number; idFactory?: () => string }

class RunnerRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export class HttpAutomationPipelineExecutionService implements AutomationPipelineExecutionService {
  private readonly fetcher: typeof fetch
  private readonly baseUrl: string
  private readonly pollInterval: number
  private readonly timeout: number
  private readonly idFactory: () => string
  private active = new Map<string, PipelineExecutionSnapshot>()
  private readonly submitting = new Map<string, PipelineExecutionSnapshot>()
  private readonly stops = new Map<string, Promise<AutomationPipelineStopResult>>()

  constructor(private readonly dependencies: AutomationPipelineExecutionDependencies, options: Options = {}) {
    this.fetcher = (options.fetcher ?? globalThis.fetch).bind(globalThis)
    this.baseUrl = (options.runnerBaseUrl ?? runtimeConfig.runnerBaseUrl).replace(/\/+$/, '')
    this.pollInterval = options.pollIntervalMs ?? 1_000
    this.timeout = options.requestTimeoutMs ?? 15_000
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID())
  }
  getActiveExecutions(): PipelineExecutionSnapshot[] {
    return [...new Map([...this.active, ...this.submitting]).values()]
  }
  private matches(execution: PipelineExecutionSnapshot, pipelineId: string, environmentId?: string): boolean {
    return execution.pipelineId === pipelineId && (!environmentId || !execution.environment?.id || execution.environment.id === environmentId)
  }
  isRunning(pipelineId: string, environmentId?: string): boolean {
    return this.getActiveExecutions().some(execution => this.matches(execution, pipelineId, environmentId))
  }
  async refresh(): Promise<void> {
    const payload = await this.request<{ executions: PipelineExecutionSnapshot[] }>('/pipeline-executions')
    this.active = new Map(payload.executions.map(execution => [execution.id, execution]))
  }
  run(pipeline: AutomationPipeline, environmentId?: string): Promise<RunRecord> {
    const targetEnvironmentId = environmentId ?? pipeline.environmentId
    if (this.isRunning(pipeline.id, targetEnvironmentId)) throw new Error(`自动化配置“${pipeline.name}”在当前环境正在运行`)
    const executionId = this.idFactory()
    this.submitting.set(executionId, { id: executionId, pipelineId: pipeline.id, pipelineName: pipeline.name,
      environment: { id: targetEnvironmentId ?? '', name: '', code: '', apiBaseUrl: '' },
      phase: 'submitting', scriptIds: pipeline.steps.map(step => step.scriptId) })
    return this.submit(pipeline, targetEnvironmentId, executionId).finally(() => {
      this.submitting.delete(executionId)
    })
  }
  private async submit(pipeline: AutomationPipeline, environmentId: string | undefined, executionId: string): Promise<RunRecord> {
    const environment = (await this.dependencies.environments.list()).find(item => item.id === environmentId)
    if (!environment || !environment.enabled) throw new Error('请选择可用的运行环境')
    const session = environment.auth.strategy === 'reuse-session' ? this.dependencies.environmentSessions?.get(environment) : undefined
    if (environment.auth.strategy === 'reuse-session' && !session) throw new Error('当前环境没有匹配的登录态，请到环境管理导入')
    const execution: PipelineExecutionSnapshot = { id: executionId, pipelineId: pipeline.id, pipelineName: pipeline.name,
      environment: { id: environment.id, name: environment.name, code: environment.code, apiBaseUrl: environment.apiBaseUrl },
      phase: 'submitting', scriptIds: pipeline.steps.map(step => step.scriptId) }
    this.submitting.set(executionId, execution)
    const body = JSON.stringify({ executionId, pipeline, environment, ...(session ? { session } : {}),
      runtimeVariables: this.dependencies.runtimeVariables.list().filter(variable => variable.sourceEnvironmentId === environment.id)
        .map(({ key, value, secret }) => ({ key, value, secret })),
    })
    let record: RunRecord
    try {
      record = (await this.request<{ record: RunRecord }>('/pipeline-executions', { method: 'POST', body })).record
    } catch (failure) {
      // Recover an accepted request by its original ID; never submit a second run.
      const existing = await this.dependencies.runRecords.get(executionId).catch(() => null)
      if (!existing) {
        if (failure instanceof RunnerRequestError) throw failure
        this.active.set(executionId, execution)
        throw new Error('提交结果暂时无法确认，任务可能已被 Runner 接收，请到运行记录查看；不要重复启动')
      }
      record = existing
    }
    this.submitting.delete(executionId)
    if (record.status !== 'running') return record
    this.active.set(record.id, { ...execution, id: record.id, phase: 'running' })
    let failures = 0
    while (record.status === 'running') {
      await new Promise(resolve => setTimeout(resolve, this.pollInterval))
      try {
        const current = await this.dependencies.runRecords.get(record.id)
        if (!current) throw new Error('运行记录不存在，请检查 Runner')
        record = current
        failures = 0
      } catch {
        if (++failures >= 3) throw new Error('与 Runner 的状态连接暂时中断，任务可能仍在后台运行，请到运行记录查看；不要重复启动')
      }
    }
    this.active.delete(record.id)
    return record
  }
  async stop(pipelineId: string, environmentId?: string): Promise<AutomationPipelineStopResult> {
    if (![...this.submitting.values()].some(execution => this.matches(execution, pipelineId, environmentId))) await this.refresh()
    const matches = this.getActiveExecutions().filter(execution => this.matches(execution, pipelineId, environmentId))
    if (matches.length > 1) throw new Error('该配置有多个运行批次，请选择环境或从运行记录停止指定批次')
    return matches[0] ? this.stopByRecordId(matches[0].id) : { stopped: false, runnerFound: false, cancelledRunIds: [] }
  }
  stopByRecordId(recordId: string): Promise<AutomationPipelineStopResult> {
    const pending = this.stops.get(recordId)
    if (pending) return pending
    const request = this.stopRecord(recordId).finally(() => this.stops.delete(recordId))
    this.stops.set(recordId, request)
    return request
  }
  private async stopRecord(recordId: string): Promise<AutomationPipelineStopResult> {
    const current = await this.dependencies.runRecords.get(recordId)
    const submitting = this.submitting.has(recordId) || this.active.has(recordId)
    if ((!current && !submitting) || (current && current.status !== 'running')) return { stopped: false, runnerFound: false, cancelledRunIds: [] }
    const result = await this.request<{ cancelledRunIds: string[]; cleanupTimedOutRunIds?: string[]; pipelineFound?: boolean }>(
      `/executions/${encodeURIComponent(recordId)}/cancel`, { method: 'POST', body: JSON.stringify({ reason: '用户已强制停止运行批次' }) }, Math.max(this.timeout, 20_000),
    )
    // Legacy single-script batches still use the existing record transition.
    if (current && !result.pipelineFound && current.execution?.kind !== 'pipeline') await this.dependencies.runRecords.interrupt(recordId, '用户已强制停止运行批次')
    return { stopped: true, runnerFound: result.pipelineFound === true || result.cancelledRunIds.length > 0,
      cancelledRunIds: result.cancelledRunIds, cleanupTimedOutRunIds: result.cleanupTimedOutRunIds }
  }
  private async request<T>(path: string, init: RequestInit = {}, timeoutMs = this.timeout): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, signal: controller.signal,
        headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })
      const result = await response.json()
      if (!response.ok) throw new RunnerRequestError(result.error || `Runner 返回 HTTP ${response.status}`, response.status)
      return result as T
    } finally { clearTimeout(timer) }
  }
}
