import {
  MAX_SCRIPT_TIMEOUT_MS,
  MIN_SCRIPT_TIMEOUT_MS,
  type AutomationScript,
  type ScriptDraft,
  type ScriptApiResponse,
  type ScriptArtifact,
  type ScriptNetworkSummary,
  type ScriptResourceResponse,
  type ScriptRunContext,
  type ScriptRunResult,
  type ScriptRunStatus,
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

export const CANCEL_REQUEST_TIMEOUT_MS = 20_000
const LIVE_REQUEST_TIMEOUT_MS = 5_000
const RUN_REQUEST_GRACE_MS = 30_000
const RUN_REGISTRATION_GRACE_MS = 3_000
const LIVE_PROGRESS_INTERVAL_MS = 2_000
const PROGRESS_NOTIFICATION_TIMEOUT_MS = 20_000
const ARTIFACT_SCOPE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/
const ARTIFACT_TYPE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/

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
    createdAt: config.createdAt,
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
    status: 'failed',
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
    status: 'interrupted',
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
  continuePipeline?: boolean
  durationMs: number
  logs: ScriptRunResult['logs']
  assertions?: ScriptAssertionResult[]
  apiResponses?: ScriptApiResponse[]
  resourceResponses?: ScriptResourceResponse[]
  networkSummary?: ScriptNetworkSummary
  artifacts?: unknown
  cancelled?: boolean
  timedOut?: boolean
  status?: ScriptRunStatus
  result?: Record<string, unknown>
  error?: string
}

interface RunnerLiveResponse extends RunnerResponse {
  status: ScriptRunStatus
}

interface RunnerCancelResponse {
  ok?: boolean
  status?: 'interrupted'
  pendingRegistration?: boolean
  cancelledRunIds?: unknown
  cleanupTimedOutRunIds?: unknown
  run?: RunnerLiveResponse
  error?: string
}

interface ActiveExecution {
  runId: string | null
  executionId: string
  cancelRequested: boolean
  cancellationConfirmed: boolean
  requestController: AbortController | null
  script: AutomationScript
}

interface LocalScriptServiceOptions {
  liveRequestTimeoutMs?: number
  runRequestGraceMs?: number
  runRegistrationGraceMs?: number
  liveProgressIntervalMs?: number
  progressNotificationTimeoutMs?: number
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

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs))
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout?: () => void,
): Promise<T> {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(new Error(message))
      onTimeout?.()
    }, timeoutMs)
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId)
  }
}

async function fetchJsonWithTimeout<T>(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  controller: AbortController,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<{ response: Response; payload: T }> {
  const operation = (async () => {
    const response = await fetcher(input, { ...init, signal: controller.signal })
    const payload = await response.json() as T
    return { response, payload }
  })()
  let removeAbortListener: () => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    const rejectAborted = () => reject(new Error('Runner 请求已取消'))
    if (controller.signal.aborted) {
      rejectAborted()
      return
    }
    controller.signal.addEventListener('abort', rejectAborted, { once: true })
    removeAbortListener = () => controller.signal.removeEventListener('abort', rejectAborted)
  })
  try {
    return await withTimeout(
      Promise.race([operation, aborted]),
      timeoutMs,
      timeoutMessage,
      () => controller.abort(),
    )
  } finally {
    removeAbortListener()
  }
}

function isTerminalRunnerStatus(
  status: RunnerLiveResponse['status'],
): status is Exclude<RunnerLiveResponse['status'], 'running'> {
  return status === 'passed'
    || status === 'partial'
    || status === 'failed'
    || status === 'interrupted'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isAbsoluteArtifactPath(value: string): boolean {
  return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

function isSafeArtifactRelativePath(value: string): boolean {
  if (!value || value.length > 4_096 || CONTROL_CHARACTER_PATTERN.test(value)) return false
  if (value.includes('\\') || value.startsWith('/') || /^[a-zA-Z]:/.test(value)) return false
  return value.split('/').every((segment) => segment && segment !== '.' && segment !== '..')
}

function normalizeScriptArtifact(value: unknown): ScriptArtifact | null {
  if (!isRecord(value)) return null
  if (
    typeof value.executionId !== 'string'
    || !ARTIFACT_SCOPE_ID_PATTERN.test(value.executionId)
    || typeof value.stepId !== 'string'
    || !ARTIFACT_SCOPE_ID_PATTERN.test(value.stepId)
    || typeof value.attemptId !== 'string'
    || !ARTIFACT_SCOPE_ID_PATTERN.test(value.attemptId)
    || typeof value.absolutePath !== 'string'
    || !value.absolutePath
    || value.absolutePath.length > 4_096
    || CONTROL_CHARACTER_PATTERN.test(value.absolutePath)
    || !isAbsoluteArtifactPath(value.absolutePath)
    || typeof value.relativePath !== 'string'
    || !isSafeArtifactRelativePath(value.relativePath)
    || typeof value.type !== 'string'
    || !ARTIFACT_TYPE_PATTERN.test(value.type)
    || typeof value.mimeType !== 'string'
    || !value.mimeType.trim()
    || value.mimeType.length > 200
    || CONTROL_CHARACTER_PATTERN.test(value.mimeType)
    || typeof value.sizeBytes !== 'number'
    || !Number.isSafeInteger(value.sizeBytes)
    || value.sizeBytes < 0
    || typeof value.createdAt !== 'string'
    || !Number.isFinite(Date.parse(value.createdAt))
  ) return null

  return {
    executionId: value.executionId,
    stepId: value.stepId,
    attemptId: value.attemptId,
    absolutePath: value.absolutePath,
    relativePath: value.relativePath,
    type: value.type,
    mimeType: value.mimeType.trim(),
    sizeBytes: value.sizeBytes,
    createdAt: new Date(value.createdAt).toISOString(),
  }
}

function normalizeRunnerResponse(value: RunnerResponse): ScriptRunResult {
  const cancelled = value.cancelled === true || value.status === 'interrupted'
  const status: ScriptRunStatus = cancelled
    ? 'interrupted'
    : value.timedOut === true
      ? 'failed'
      : value.status === 'running'
        || value.status === 'passed'
        || value.status === 'partial'
        || value.status === 'failed'
        ? value.status
        : value.ok === true
          ? 'passed'
          : value.continuePipeline === true ? 'partial' : 'failed'
  return {
    ok: value.ok === true,
    status,
    ...(value.continuePipeline === true ? { continuePipeline: true } : {}),
    ...(cancelled ? { cancelled: true } : {}),
    ...(value.timedOut === true ? { timedOut: true } : {}),
    durationMs: Number.isFinite(value.durationMs) ? value.durationMs : 0,
    logs: Array.isArray(value.logs) ? value.logs : [],
    ...(Array.isArray(value.assertions) ? { assertions: value.assertions } : {}),
    ...(Array.isArray(value.apiResponses) ? { apiResponses: value.apiResponses } : {}),
    ...(Array.isArray(value.resourceResponses) ? { resourceResponses: value.resourceResponses } : {}),
    ...(isRecord(value.networkSummary)
      ? { networkSummary: structuredClone(value.networkSummary) as unknown as ScriptNetworkSummary }
      : {}),
    ...(Array.isArray(value.artifacts)
      ? { artifacts: value.artifacts.flatMap((artifact) => {
          const normalized = normalizeScriptArtifact(artifact)
          return normalized ? [normalized] : []
        }) }
      : {}),
    ...(value.result ? { output: value.result } : {}),
    ...(value.error ? { error: value.error } : {}),
  }
}

export class LocalScriptService implements ScriptService {
  private scripts: AutomationScript[] = []
  private configs = new Map<string, ScriptConfig>()
  private readonly activeExecutions = new Map<string, ActiveExecution>()
  private readonly configRepository: ScriptConfigRepository
  private readonly liveRequestTimeoutMs: number
  private readonly runRequestGraceMs: number
  private readonly runRegistrationGraceMs: number
  private readonly liveProgressIntervalMs: number
  private readonly progressNotificationTimeoutMs: number
  private configMutationVersion = 0
  private configReloadPromise: Promise<void> | null = null

  constructor(
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly runnerUrl = runtimeConfig.runnerBaseUrl,
    private readonly livePollIntervalMs = 500,
    private readonly cancelRequestTimeoutMs = CANCEL_REQUEST_TIMEOUT_MS,
    configRepository?: ScriptConfigRepository,
    options: LocalScriptServiceOptions = {},
  ) {
    this.configRepository = configRepository
      ?? new HttpScriptConfigRepository(this.fetcher, this.runnerUrl)
    this.liveRequestTimeoutMs = Math.max(1, options.liveRequestTimeoutMs ?? LIVE_REQUEST_TIMEOUT_MS)
    this.runRequestGraceMs = Math.max(1, options.runRequestGraceMs ?? RUN_REQUEST_GRACE_MS)
    this.runRegistrationGraceMs = Math.max(
      1,
      options.runRegistrationGraceMs ?? RUN_REGISTRATION_GRACE_MS,
    )
    this.liveProgressIntervalMs = Math.max(0, options.liveProgressIntervalMs ?? LIVE_PROGRESS_INTERVAL_MS)
    this.progressNotificationTimeoutMs = Math.max(
      1,
      options.progressNotificationTimeoutMs ?? PROGRESS_NOTIFICATION_TIMEOUT_MS,
    )
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
      execution.cancellationConfirmed = true
      this.markInterrupted(id)
      return { runnerFound: false, cancelledRunIds: [] }
    }

    const cancellationTarget: CancellationTarget = activeRunId ? 'run' : 'script'
    const cancellationPath = activeRunId
      ? `/runs/${encodeURIComponent(activeRunId)}/cancel`
      : `/scripts/${encodeURIComponent(id)}/cancel`

    let response: Response
    let payload: RunnerCancelResponse
    try {
      const cancelController = new AbortController()
      ;({ response, payload } = await fetchJsonWithTimeout<RunnerCancelResponse>(
        this.fetcher,
        `${this.runnerUrl}${cancellationPath}`,
        activeRunId
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reserveIfMissing: true }),
            }
          : { method: 'POST' },
        cancelController,
        this.cancelRequestTimeoutMs,
        `Runner 强制停止请求超时（${this.cancelRequestTimeoutMs}ms），请确认 Runner 服务正常后重试`,
      ))
    } catch (error) {
      if (activeRunId) {
        const localScript = execution?.script ?? this.scripts.find((item) => item.id === id)
        if (localScript?.status === 'interrupted' || localScript?.lastRunResult?.cancelled) {
          return { runnerFound: true, cancelledRunIds: [activeRunId] }
        }
        try {
          const liveController = new AbortController()
          const { response: liveResponse, payload: live } = await fetchJsonWithTimeout<RunnerLiveResponse>(
            this.fetcher,
            `${this.runnerUrl}/runs/${encodeURIComponent(activeRunId)}`,
            {},
            liveController,
            this.liveRequestTimeoutMs,
            `Runner 停止状态对账超时（${this.liveRequestTimeoutMs}ms）`,
          )
          if (liveResponse.ok && (live.status === 'interrupted' || live.cancelled === true)) {
            if (execution) execution.cancellationConfirmed = true
            execution?.requestController?.abort()
            this.markInterrupted(id)
            return { runnerFound: true, cancelledRunIds: [activeRunId] }
          }
        } catch {
          // 保留原始停止请求错误，状态对账失败不覆盖更具体的原因。
        }
      }
      if (execution && !execution.cancellationConfirmed) execution.cancelRequested = false
      throw error instanceof TypeError
        ? new Error(`无法连接本地 Playwright Runner（${this.runnerUrl}），强制停止失败`)
        : error
    }

    const staleCancellation = isKnownStaleCancellation(cancellationTarget, response, payload)
    const alreadyInterrupted = Boolean(
      activeRunId
      && response.status === 409
      && (payload.run?.status === 'interrupted' || payload.run?.cancelled === true),
    )
    if (!response.ok && !staleCancellation && !alreadyInterrupted) {
      if (execution && !execution.cancellationConfirmed) execution.cancelRequested = false
      throw new Error(payload.error || `Runner 强制停止返回 HTTP ${response.status}`)
    }
    if (staleCancellation && activeRunId) {
      if (execution && !execution.cancellationConfirmed) execution.cancelRequested = false
      throw new Error('Runner 未确认强制停止：运行任务尚未注册或已过期，请稍后重试')
    }

    if (execution) execution.cancellationConfirmed = true
    execution?.requestController?.abort()
    this.markInterrupted(id)
    const cleanupTimedOutRunIds = Array.isArray(payload.cleanupTimedOutRunIds)
      ? payload.cleanupTimedOutRunIds.filter((runId): runId is string => typeof runId === 'string')
      : []
    return {
      runnerFound: !staleCancellation,
      cancelledRunIds: alreadyInterrupted && activeRunId
        ? [activeRunId]
        : Array.isArray(payload.cancelledRunIds)
          ? payload.cancelledRunIds.filter((runId): runId is string => typeof runId === 'string')
          : [],
      ...(cleanupTimedOutRunIds.length > 0 ? { cleanupTimedOutRunIds } : {}),
    }
  }

  async stopExecution(executionId: string): Promise<ScriptStopResult> {
    if (!ARTIFACT_SCOPE_ID_PATTERN.test(executionId)) {
      throw new Error('运行批次 ID 格式无效')
    }

    const executions = [...this.activeExecutions.values()]
      .filter((execution) => execution.executionId === executionId)
    for (const execution of executions) execution.cancelRequested = true

    let response: Response
    let payload: RunnerCancelResponse
    try {
      const controller = new AbortController()
      ;({ response, payload } = await fetchJsonWithTimeout<RunnerCancelResponse>(
        this.fetcher,
        `${this.runnerUrl}/executions/${encodeURIComponent(executionId)}/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: '用户已从运行记录强制停止运行批次' }),
        },
        controller,
        this.cancelRequestTimeoutMs,
        `Runner 批次停止请求超时（${this.cancelRequestTimeoutMs}ms），请确认 Runner 服务正常后重试`,
      ))
    } catch (error) {
      for (const execution of executions) {
        if (!execution.cancellationConfirmed) execution.cancelRequested = false
      }
      throw error instanceof TypeError
        ? new Error(`无法连接本地 Playwright Runner（${this.runnerUrl}），批次停止失败`)
        : error
    }

    if (!response.ok) {
      for (const execution of executions) {
        if (!execution.cancellationConfirmed) execution.cancelRequested = false
      }
      throw new Error(payload.error || `Runner 批次停止返回 HTTP ${response.status}`)
    }

    for (const execution of executions) {
      execution.cancellationConfirmed = true
      execution.requestController?.abort()
      this.markInterrupted(execution.script.id)
    }
    const cancelledRunIds = Array.isArray(payload.cancelledRunIds)
      ? payload.cancelledRunIds.filter((runId): runId is string => typeof runId === 'string')
      : []
    const cleanupTimedOutRunIds = Array.isArray(payload.cleanupTimedOutRunIds)
      ? payload.cleanupTimedOutRunIds.filter((runId): runId is string => typeof runId === 'string')
      : []
    return {
      runnerFound: cancelledRunIds.length > 0 || cleanupTimedOutRunIds.length > 0,
      cancelledRunIds,
      ...(cleanupTimedOutRunIds.length > 0 ? { cleanupTimedOutRunIds } : {}),
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
      script.lastRunResult = { ok: false, status: 'running', durationMs: 0, logs: [] }
      const execution: ActiveExecution = {
        runId: null,
        executionId: context.executionId ?? '',
        cancelRequested: false,
        cancellationConfirmed: false,
        requestController: null,
        script,
      }
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
      if (execution.cancellationConfirmed) {
        result = interruptedRunResult(script.lastRunResult)
        script.lastRunResult = result
        script.status = 'interrupted'
        script.lastDuration = formatDuration(result.durationMs)
        const notification = this.notifyProgress(onProgress, script)
        if (notification) await notification
        this.finishExecution(execution)
        continue
      }

      try {
        const runId = crypto.randomUUID()
        execution.runId = runId
        const pollState: {
          active: boolean
          controller: AbortController | null
        } = { active: true, controller: null }
        let lastLiveProgressAt = 0
        let runObserved = false
        const runDeadlineMs = script.timeoutMs * (/hk/i.test(context.environmentCode ?? '') ? 3 : 1) + this.runRequestGraceMs
        const runDeadlineAt = Date.now() + runDeadlineMs
        const effectiveVariables = {
          ...scriptInputParameterDefaults(script.inputParameters),
          ...runVariables,
        }
        const requestPath = script.requestPath
          ? resolveScriptRequestPath(script.requestPath, effectiveVariables)
          : undefined
        const acceptLiveSnapshot = async (live: RunnerLiveResponse): Promise<ScriptRunResult | null> => {
          const liveResult = normalizeRunnerResponse(live)
          if (isTerminalRunnerStatus(live.status)) return liveResult
          if (execution.cancelRequested) return null
          script.lastRunResult = liveResult
          script.lastDuration = formatDuration(live.durationMs)
          this.syncExecution(execution)
          const now = Date.now()
          if (lastLiveProgressAt === 0
            || now - lastLiveProgressAt >= this.liveProgressIntervalMs) {
            lastLiveProgressAt = now
            const notification = this.notifyProgress(onProgress, script)
            if (notification) await notification
          }
          return null
        }
        const postController = new AbortController()
        execution.requestController = postController
        const postOutcome = fetchJsonWithTimeout<RunnerResponse>(
          this.fetcher,
          `${this.runnerUrl}/runs`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              runId,
              executionId: context.executionId ?? runId,
              failBatchOnError: context.failBatchOnError === true,
              scriptId: script.id,
              context: {
                environmentCode: context.environmentCode,
                siteBaseUrl: context.siteBaseUrl,
                apiBaseUrl: context.apiBaseUrl,
                ignoreHTTPSErrors: context.ignoreHTTPSErrors,
                variables: effectiveVariables,
                authorizationOrigin: context.authorizationOrigin,
                extraHTTPHeaders: context.extraHTTPHeaders,
                ...(requestPath ? { requestPath } : {}),
              },
            }),
          },
          postController,
          runDeadlineMs,
          `Runner 执行请求超时（${runDeadlineMs}ms）`,
        ).then(({ response, payload }) => {
          const interrupted = payload.cancelled === true || payload.status === 'interrupted'
          if (!response.ok && !interrupted) {
            throw new Error(payload.error || `Runner 返回 HTTP ${response.status}`)
          }
          return normalizeRunnerResponse(payload)
        }).then(
          (postResult) => ({ source: 'post' as const, result: postResult }),
          (error: unknown) => ({ source: 'post' as const, error }),
        )

        let resolveTerminal!: (outcome: {
          source: 'poll'
          result: ScriptRunResult
        }) => void
        const terminalOutcome = new Promise<{
          source: 'poll'
          result: ScriptRunResult
        }>((resolve) => {
          resolveTerminal = resolve
        })
        void (async () => {
          while (pollState.active) {
            await wait(this.livePollIntervalMs)
            if (!pollState.active) break
            const pollController = new AbortController()
            try {
              pollState.controller = pollController
              const { response: liveResponse, payload: live } = await fetchJsonWithTimeout<RunnerLiveResponse>(
                this.fetcher,
                `${this.runnerUrl}/runs/${encodeURIComponent(runId)}`,
                {},
                pollController,
                this.liveRequestTimeoutMs,
                `Runner 运行状态请求超时（${this.liveRequestTimeoutMs}ms）`,
              )
              if (!liveResponse.ok) continue
              if (!pollState.active) break
              runObserved = true
              const terminalResult = await acceptLiveSnapshot(live)
              if (terminalResult) {
                resolveTerminal({ source: 'poll', result: terminalResult })
                break
              }
            } catch {
              // POST 或下次轮询仍可给出结果，本次状态刷新失败不改变脚本结果。
            } finally {
              if (pollState.controller === pollController) pollState.controller = null
            }
          }
        })()

        const outcome = await Promise.race([postOutcome, terminalOutcome])
        pollState.active = false
        pollState.controller?.abort()
        if (outcome.source === 'poll') postController.abort()
        if ('error' in outcome && execution.cancellationConfirmed) {
          result = interruptedRunResult(script.lastRunResult)
        } else if ('error' in outcome) {
          const postError = outcome.error
          let recoveryDeadlineAt = runObserved
            ? runDeadlineAt
            : Math.min(runDeadlineAt, Date.now() + this.runRegistrationGraceMs)
          let firstAttempt = true
          let recoveredResult: ScriptRunResult | null = null
          while (firstAttempt || Date.now() < recoveryDeadlineAt) {
            const deadlineAlreadyReached = Date.now() >= recoveryDeadlineAt
            firstAttempt = false
            const requestTimeoutMs = deadlineAlreadyReached
              ? this.liveRequestTimeoutMs
              : Math.max(1, Math.min(this.liveRequestTimeoutMs, recoveryDeadlineAt - Date.now()))
            const recoveryController = new AbortController()
            try {
              const { response, payload: live } = await fetchJsonWithTimeout<RunnerLiveResponse>(
                this.fetcher,
                `${this.runnerUrl}/runs/${encodeURIComponent(runId)}`,
                {},
                recoveryController,
                requestTimeoutMs,
                `Runner 恢复状态请求超时（${requestTimeoutMs}ms）`,
              )
              if (response.ok) {
                runObserved = true
                recoveryDeadlineAt = runDeadlineAt
                recoveredResult = await acceptLiveSnapshot(live)
                if (recoveredResult) break
              }
            } catch {
              // 请求可能已经由 Runner 接收，继续在注册或执行截止时间内查询终态。
            }
            const remainingMs = recoveryDeadlineAt - Date.now()
            if (remainingMs > 0) await wait(Math.min(this.livePollIntervalMs, remainingMs))
          }
          if (!recoveredResult) {
            if (runObserved && Date.now() >= runDeadlineAt) {
              throw new Error(`Runner 执行在 ${runDeadlineMs}ms 内未返回终态`)
            }
            throw postError
          }
          result = recoveredResult
        } else {
          result = outcome.result
        }
      } catch (error) {
        result = execution.cancellationConfirmed
          ? interruptedRunResult(script.lastRunResult)
          : failedRunResult(error instanceof TypeError
            ? new Error(`无法连接本地 Playwright Runner（${this.runnerUrl}），请确认 npm run dev 已同时启动 Web 和 Runner`)
            : error)
      }

      if (execution.cancellationConfirmed && !result.cancelled) result = interruptedRunResult(result)
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
      script.status = result.cancelled || result.status === 'interrupted'
        ? 'interrupted'
        : result.timedOut
          ? 'failed'
          : result.status === 'partial'
            ? 'partial'
            : result.ok ? 'passed' : 'failed'
      script.lastDuration = formatDuration(result.durationMs)
      const notification = this.notifyProgress(onProgress, script)
      if (notification) await notification
      this.finishExecution(execution)
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
    execution.requestController = null
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
      if (notification) {
        return withTimeout(
          notification,
          this.progressNotificationTimeoutMs,
          `脚本进度上报超时（${this.progressNotificationTimeoutMs}ms）`,
        ).catch(() => undefined)
      }
    } catch {
      // Progress reporting must not change the script execution result.
    }
  }
}
