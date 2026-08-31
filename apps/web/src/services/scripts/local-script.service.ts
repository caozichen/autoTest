import {
  MAX_SCRIPT_TIMEOUT_MS,
  MIN_SCRIPT_TIMEOUT_MS,
  type AutomationScript,
  type ScriptDraft,
  type ScriptApiResponse,
  type ScriptRunContext,
  type ScriptRunResult,
} from '@/domain/script'
import type { ScriptAssertionResult } from '@/domain/assertion'
import { runtimeConfig } from '@/config/runtime'
import {
  normalizeScriptRequestPath,
  resolveScriptRequestPath,
} from '@/domain/script-request-url'
import {
  normalizeScriptInputParameters,
  scriptInputParameterDefaults,
} from './script-input-parameters'
import {
  extractScriptResponseVariables,
  normalizeScriptResponseVariableBindings,
} from './script-response-variables'
import type {
  ScriptRunProgressHandler,
  ScriptService,
  ScriptStopResult,
} from './script-service'
import { HttpScriptConfigRepository } from './http-script-config.repository'
import type { ScriptConfig, ScriptConfigRepository } from './script-config-repository'

const CANCEL_REQUEST_TIMEOUT_MS = 5_000

type CancellationTarget = 'run' | 'script'

function cloneScripts(scripts: AutomationScript[]): AutomationScript[] {
  return structuredClone(scripts)
}

function formatUpdatedAt(value: string): string {
  const timestamp = new Date(value)
  if (!Number.isFinite(timestamp.getTime())) return value
  const date = timestamp.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).replace(/\//g, '-')
  const time = timestamp.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${date} ${time}`
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function normalizeScriptTimeoutMs(value: number): number {
  if (!Number.isInteger(value)
    || value < MIN_SCRIPT_TIMEOUT_MS
    || value > MAX_SCRIPT_TIMEOUT_MS) {
    throw new Error(
      `脚本执行超时必须是 ${MIN_SCRIPT_TIMEOUT_MS} 到 ${MAX_SCRIPT_TIMEOUT_MS} 之间的整数毫秒值`,
    )
  }
  return value
}

function configToAutomationScript(
  config: ScriptConfig,
  previous?: AutomationScript,
): AutomationScript {
  const previousStatus = previous?.status
  const status = config.enabled
    ? previousStatus === 'disabled' || previousStatus === undefined ? 'ready' : previousStatus
    : previousStatus === 'running' ? 'running' : 'disabled'
  return {
    id: config.id,
    name: config.name,
    description: config.description,
    directory: config.directory,
    entryFile: config.entryFile,
    timeoutMs: config.timeoutMs,
    ...(config.requestPath === undefined ? {} : { requestPath: config.requestPath }),
    inputParameters: structuredClone(config.inputParameters ?? []),
    responseVariableBindings: structuredClone(config.responseVariableBindings ?? []),
    tags: [...config.tags],
    status,
    updatedAt: formatUpdatedAt(config.updatedAt),
    lastRunAt: previous?.lastRunAt ?? null,
    lastDuration: previous?.lastDuration ?? null,
    ...(previous?.lastRunResult ? { lastRunResult: structuredClone(previous.lastRunResult) } : {}),
  }
}

function draftConfig(
  draft: ScriptDraft,
  options: { id: string; createdAt: string; current?: ScriptConfig },
): ScriptConfig {
  const updatedAt = new Date().toISOString()
  const requestPath = draft.requestPath === undefined
    ? options.current?.requestPath
    : normalizeScriptRequestPath(draft.requestPath)
  return {
    schemaVersion: 1,
    revision: options.current?.revision ?? 0,
    id: options.id,
    name: draft.name.trim(),
    description: draft.description.trim(),
    directory: draft.directory.trim(),
    entryFile: draft.entryFile.trim(),
    timeoutMs: normalizeScriptTimeoutMs(draft.timeoutMs),
    enabled: draft.enabled,
    ...(requestPath === undefined ? {} : { requestPath }),
    inputParameters: normalizeScriptInputParameters(draft.inputParameters),
    responseVariableBindings: normalizeScriptResponseVariableBindings(draft.responseVariableBindings),
    tags: [...draft.tags],
    createdAt: options.createdAt,
    updatedAt,
  }
}

function failedRunResult(error: unknown): ScriptRunResult {
  const message = error instanceof Error ? error.message : 'Runner 请求失败'
  return {
    ok: false,
    durationMs: 0,
    error: message,
    logs: [{ timestamp: new Date().toISOString(), level: 'error', message }],
  }
}

function interruptedRunResult(current?: ScriptRunResult): ScriptRunResult {
  if (current?.cancelled) return current
  const message = '用户强制停止运行'
  return {
    ...current,
    ok: false,
    cancelled: true,
    durationMs: current?.durationMs ?? 0,
    error: message,
    logs: [
      ...(current?.logs ?? []),
      { timestamp: new Date().toISOString(), level: 'warning', message },
    ],
  }
}

interface RunnerResponse {
  ok: boolean
  durationMs: number
  logs: ScriptRunResult['logs']
  assertions?: ScriptAssertionResult[]
  apiResponses?: ScriptApiResponse[]
  cancelled?: boolean
  timedOut?: boolean
  status?: 'running' | 'passed' | 'failed' | 'interrupted'
  result?: Record<string, unknown>
  error?: string
}

interface RunnerLiveResponse extends RunnerResponse {
  status: 'running' | 'passed' | 'failed' | 'interrupted'
}

interface RunnerCancelResponse {
  ok?: boolean
  cancelledRunIds?: unknown
  error?: string
}

interface ActiveExecution {
  runId: string | null
  cancelRequested: boolean
  script: AutomationScript
}

function isKnownStaleCancellation(
  target: CancellationTarget,
  response: Response,
  payload: RunnerCancelResponse,
): boolean {
  if (response.status !== 404) return false
  const expectedError = target === 'run'
    ? '运行任务不存在或已过期'
    : '该脚本没有正在运行的任务'
  return payload.error === expectedError
}

async function fetchWithTimeout(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined
  let timedOut = false
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      timedOut = true
      reject(new Error(`Runner 强制停止请求超时（${timeoutMs}ms），请确认 Runner 服务正常后重试`))
      controller.abort()
    }, timeoutMs)
  })

  try {
    return await Promise.race([
      fetcher(input, { ...init, signal: controller.signal }),
      timeoutPromise,
    ])
  } catch (error) {
    if (timedOut) {
      throw new Error(`Runner 强制停止请求超时（${timeoutMs}ms），请确认 Runner 服务正常后重试`)
    }
    throw error
  } finally {
    if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId)
  }
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs))
}

function normalizeRunnerResponse(value: RunnerResponse): ScriptRunResult {
  const cancelled = value.cancelled === true || value.status === 'interrupted'
  return {
    ok: value.ok === true,
    ...(cancelled ? { cancelled: true } : {}),
    ...(value.timedOut === true ? { timedOut: true } : {}),
    durationMs: Number.isFinite(value.durationMs) ? value.durationMs : 0,
    logs: Array.isArray(value.logs) ? value.logs : [],
    ...(Array.isArray(value.assertions) ? { assertions: value.assertions } : {}),
    ...(Array.isArray(value.apiResponses) ? { apiResponses: value.apiResponses } : {}),
    ...(value.result ? { output: value.result } : {}),
    ...(value.error ? { error: value.error } : {}),
  }
}

export class LocalScriptService implements ScriptService {
  private scripts: AutomationScript[] = []
  private configs = new Map<string, ScriptConfig>()
  private readonly activeExecutions = new Map<string, ActiveExecution>()
  private readonly configRepository: ScriptConfigRepository
  private configMutationVersion = 0
  private configReloadPromise: Promise<void> | null = null

  constructor(
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly runnerUrl = runtimeConfig.runnerBaseUrl,
    private readonly livePollIntervalMs = 500,
    private readonly cancelRequestTimeoutMs = CANCEL_REQUEST_TIMEOUT_MS,
    configRepository?: ScriptConfigRepository,
  ) {
    this.configRepository = configRepository
      ?? new HttpScriptConfigRepository(this.fetcher, this.runnerUrl)
  }

  async list(): Promise<AutomationScript[]> {
    await this.reloadConfigs()
    return cloneScripts(this.scripts)
  }

  async create(draft: ScriptDraft): Promise<AutomationScript> {
    const createdAt = new Date().toISOString()
    const persisted = await this.configRepository.create(draftConfig(draft, {
      id: crypto.randomUUID(),
      createdAt,
    }))
    const script = configToAutomationScript(persisted)
    this.configMutationVersion += 1
    this.configs.set(persisted.id, structuredClone(persisted))
    this.scripts.unshift(script)
    return structuredClone(script)
  }

  async update(id: string, draft: ScriptDraft): Promise<AutomationScript> {
    if (this.activeExecutions.has(id)) throw new Error('脚本正在运行，不能修改配置')
    const currentConfig = await this.requireConfig(id)
    const persisted = await this.configRepository.update(
      draftConfig(draft, {
        id,
        createdAt: currentConfig.createdAt,
        current: currentConfig,
      }),
      currentConfig.revision,
      currentConfig.updatedAt,
    )
    const index = this.scripts.findIndex((script) => script.id === id)
    const currentScript = index >= 0 ? this.scripts[index] : undefined
    const updated = configToAutomationScript(persisted, currentScript)
    this.configMutationVersion += 1
    this.configs.set(id, structuredClone(persisted))
    if (index >= 0) this.scripts[index] = updated
    else this.scripts.unshift(updated)
    return structuredClone(updated)
  }

  async remove(id: string): Promise<void> {
    if (this.activeExecutions.has(id)) throw new Error('脚本正在运行，不能删除配置')
    const current = await this.requireConfig(id)
    await this.configRepository.remove(id, current.revision, current.updatedAt)
    this.configMutationVersion += 1
    this.configs.delete(id)
    this.scripts = this.scripts.filter((script) => script.id !== id)
  }

  async stop(id: string): Promise<ScriptStopResult> {
    let script = this.scripts.find((item) => item.id === id)
    if (!script) {
      await this.reloadConfigs()
      script = this.scripts.find((item) => item.id === id)
    }
    if (!script) throw new Error('脚本不存在或已被删除')

    const execution = this.activeExecutions.get(id)
    const activeRunId = execution?.runId
    if (execution) execution.cancelRequested = true

    if (execution && !activeRunId) {
      this.markInterrupted(id)
      return { runnerFound: false, cancelledRunIds: [] }
    }

    const cancellationTarget: CancellationTarget = activeRunId ? 'run' : 'script'
    const cancellationPath = activeRunId
      ? `/runs/${encodeURIComponent(activeRunId)}/cancel`
      : `/scripts/${encodeURIComponent(id)}/cancel`

    let response: Response
    try {
      response = await fetchWithTimeout(
        this.fetcher,
        `${this.runnerUrl}${cancellationPath}`,
        { method: 'POST' },
        this.cancelRequestTimeoutMs,
      )
    } catch (error) {
      if (execution && this.activeExecutions.get(id) === execution) execution.cancelRequested = false
      throw error instanceof TypeError
        ? new Error(`无法连接本地 Playwright Runner（${this.runnerUrl}），强制停止失败`)
        : error
    }

    const payload = await response.json().catch(() => ({})) as RunnerCancelResponse
    const staleCancellation = isKnownStaleCancellation(cancellationTarget, response, payload)
    if (!response.ok && !staleCancellation) {
      if (execution && this.activeExecutions.get(id) === execution) execution.cancelRequested = false
      throw new Error(payload.error || `Runner 强制停止返回 HTTP ${response.status}`)
    }

    this.markInterrupted(id)
    return {
      runnerFound: !staleCancellation,
      cancelledRunIds: Array.isArray(payload.cancelledRunIds)
        ? payload.cancelledRunIds.filter((runId): runId is string => typeof runId === 'string')
        : [],
    }
  }

  async run(
    ids: string[],
    context: ScriptRunContext,
    onProgress?: ScriptRunProgressHandler,
  ): Promise<AutomationScript[]> {
    if (!context.environmentId) throw new Error('运行脚本前必须选择环境')
    const activeIds = ids.filter((id) => this.activeExecutions.has(id))
    if (activeIds.length > 0) throw new Error('所选脚本正在运行，请先等待当前运行结束或强制停止')
    await this.reloadConfigs()
    const scriptById = new Map(this.scripts.map((script) => [script.id, script]))
    const runnable = ids.flatMap((id) => {
      const script = scriptById.get(id)
      return script && script.status !== 'disabled' ? [script] : []
    })
    if (runnable.length === 0) throw new Error('请选择可运行的脚本')
    const runVariables = { ...context.variables }

    const executions = runnable.map((storedScript): ActiveExecution => {
      const script = structuredClone(storedScript)
      script.status = 'running'
      script.lastRunAt = '刚刚'
      script.lastDuration = null
      script.lastRunResult = { ok: false, durationMs: 0, logs: [] }
      const execution: ActiveExecution = { runId: null, cancelRequested: false, script }
      this.activeExecutions.set(script.id, execution)
      Object.assign(storedScript, structuredClone(script))
      return execution
    })

    for (const execution of executions) {
      const notification = this.notifyProgress(onProgress, execution.script)
      if (notification) await notification
    }

    for (const execution of executions) {
      const { script } = execution
      let result: ScriptRunResult
      if (execution.cancelRequested) {
        result = interruptedRunResult(script.lastRunResult)
        script.lastRunResult = result
        script.status = 'interrupted'
        script.lastDuration = formatDuration(result.durationMs)
        this.finishExecution(execution)
        const notification = this.notifyProgress(onProgress, script)
        if (notification) await notification
        continue
      }

      try {
        const runId = crypto.randomUUID()
        execution.runId = runId
        let requestCompleted = false
        const effectiveVariables = {
          ...scriptInputParameterDefaults(script.inputParameters),
          ...runVariables,
        }
        const requestPath = script.requestPath
          ? resolveScriptRequestPath(script.requestPath, effectiveVariables)
          : undefined
        const responsePromise = this.fetcher(`${this.runnerUrl}/runs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            runId,
            scriptId: script.id,
            context: {
              siteBaseUrl: context.siteBaseUrl,
              apiBaseUrl: context.apiBaseUrl,
              ignoreHTTPSErrors: context.ignoreHTTPSErrors,
              variables: effectiveVariables,
              authorizationOrigin: context.authorizationOrigin,
              extraHTTPHeaders: context.extraHTTPHeaders,
              ...(requestPath ? { requestPath } : {}),
            },
          }),
        })
        const pollTask = (async () => {
          while (!requestCompleted) {
            await wait(this.livePollIntervalMs)
            if (requestCompleted) break
            try {
              const liveResponse = await this.fetcher(`${this.runnerUrl}/runs/${encodeURIComponent(runId)}`)
              if (!liveResponse.ok) continue
              const live = await liveResponse.json() as RunnerLiveResponse
              const liveResult = normalizeRunnerResponse(live)
              script.lastRunResult = liveResult
              script.lastDuration = formatDuration(live.durationMs)
              if (liveResult.cancelled) script.status = 'interrupted'
              this.syncExecution(execution)
              const notification = this.notifyProgress(onProgress, script)
              if (notification) await notification
            } catch {
              // 最终 POST 仍负责报告连接或执行错误，轮询失败只跳过本次刷新。
            }
          }
        })()
        const response = await responsePromise.finally(() => {
          requestCompleted = true
        })
        await pollTask
        const payload = await response.json() as RunnerResponse
        const interrupted = payload.cancelled === true || payload.status === 'interrupted'
        if (!response.ok && !interrupted) throw new Error(payload.error || `Runner 返回 HTTP ${response.status}`)
        result = normalizeRunnerResponse(payload)
      } catch (error) {
        result = execution.cancelRequested
          ? interruptedRunResult(script.lastRunResult)
          : failedRunResult(error instanceof TypeError
            ? new Error(`无法连接本地 Playwright Runner（${this.runnerUrl}），请确认 npm run dev 已同时启动 Web 和 Runner`)
            : error)
      }

      if (execution.cancelRequested && !result.cancelled) result = interruptedRunResult(result)
      const extraction = extractScriptResponseVariables(script, result)
      if (extraction.extracted.length > 0) {
        Object.assign(runVariables, Object.fromEntries(
          extraction.extracted.map(({ binding, value }) => [binding.variableName, value]),
        ))
        result.logs.push({
          timestamp: new Date().toISOString(),
          level: 'success',
          message: `已从运行结果提取 ${extraction.extracted.length} 个变量`,
          details: {
            variables: extraction.extracted.map(({ binding }) => ({
              name: binding.variableName,
              responsePath: binding.responsePath,
              secret: binding.secret,
            })),
          },
        })
      }
      if (extraction.failed.length > 0) {
        result.logs.push({
          timestamp: new Date().toISOString(),
          level: 'warning',
          message: `${extraction.failed.length} 条响应变量规则未提取到可用值，原变量未覆盖`,
          details: {
            variables: extraction.failed.map((binding) => ({
              name: binding.variableName,
              responsePath: binding.responsePath,
            })),
          },
        })
      }
      script.lastRunResult = result
      script.status = result.cancelled ? 'interrupted' : result.ok ? 'passed' : 'failed'
      script.lastDuration = formatDuration(result.durationMs)
      this.finishExecution(execution)
      const notification = this.notifyProgress(onProgress, script)
      if (notification) await notification
    }
    return cloneScripts(executions.map((execution) => execution.script))
  }

  private async requireConfig(id: string): Promise<ScriptConfig> {
    const cached = this.configs.get(id)
    if (cached) return structuredClone(cached)
    const config = await this.configRepository.get(id)
    if (!config) throw new Error('脚本不存在或已被删除')
    this.configs.set(id, structuredClone(config))
    return config
  }

  private async reloadConfigs(): Promise<void> {
    if (this.configReloadPromise) return this.configReloadPromise
    const mutationVersion = this.configMutationVersion
    const reload = (async () => {
      const configs = await this.configRepository.list()
      if (mutationVersion !== this.configMutationVersion) return
      const currentScripts = new Map(this.scripts.map((script) => [script.id, script]))
      const nextScripts = configs.map((config) => {
        const active = this.activeExecutions.get(config.id)
        return active?.script ?? configToAutomationScript(config, currentScripts.get(config.id))
      })
      const configIds = new Set(configs.map((config) => config.id))
      for (const execution of this.activeExecutions.values()) {
        if (!configIds.has(execution.script.id)) nextScripts.push(execution.script)
      }
      this.configs = new Map(configs.map((config) => [config.id, structuredClone(config)]))
      this.scripts = nextScripts
    })()
    this.configReloadPromise = reload
    try {
      await reload
    } finally {
      if (this.configReloadPromise === reload) this.configReloadPromise = null
    }
  }

  private markInterrupted(id: string): void {
    const execution = this.activeExecutions.get(id)
    const script = execution?.script ?? this.scripts.find((item) => item.id === id)
    if (!script) return
    const result = interruptedRunResult(script.lastRunResult)
    script.lastRunResult = result
    script.status = 'interrupted'
    script.lastDuration = formatDuration(result.durationMs)
    if (execution) this.syncExecution(execution)
  }

  private syncExecution(execution: ActiveExecution): void {
    if (this.activeExecutions.get(execution.script.id) !== execution) return
    const index = this.scripts.findIndex((script) => script.id === execution.script.id)
    if (index >= 0) this.scripts[index] = structuredClone(execution.script)
  }

  private finishExecution(execution: ActiveExecution): void {
    this.syncExecution(execution)
    if (this.activeExecutions.get(execution.script.id) === execution) {
      this.activeExecutions.delete(execution.script.id)
    }
  }

  private notifyProgress(
    onProgress: ScriptRunProgressHandler | undefined,
    script: AutomationScript,
  ): Promise<void> | undefined {
    if (!onProgress) return
    try {
      const notification = onProgress(structuredClone(script))
      if (notification) return notification.catch(() => undefined)
    } catch {
      // Progress reporting must not change the script execution result.
    }
  }
}
