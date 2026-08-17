import type { AutomationScript, ScriptDraft, ScriptRunContext, ScriptRunResult } from '@/domain/script'
import type { ScriptService, ScriptStopResult } from './script-service'

const RUNNER_URL = 'http://127.0.0.1:4310'
const CANCEL_REQUEST_TIMEOUT_MS = 5_000

type CancellationTarget = 'run' | 'script'

const initialScripts: AutomationScript[] = [
  {
    id: 'form-all-fields-submit',
    name: '已发布全题型表单填写并提交',
    description: 'Chrome 无头模式访问公开表单 qBM33p，逐题填写三页联系人、通用和高级题型，上传附件、完成签名并提交。',
    directory: 'scripts',
    entryFile: 'form-all-fields-submit.ui.spec.mjs',
    tags: ['Playwright', 'UI', 'Headless Chrome', '表单填写', '全题型', 'P0'],
    status: 'ready',
    updatedAt: '暂无数据',
    lastRunAt: null,
    lastDuration: null,
  },
  {
    id: 'form-all-fields-publish',
    name: '表单全题型三页发布',
    description: 'Chrome 无头模式创建三页表单，加入全部联系人、通用和高级题型，设置可作答题必填，保存、发布并校验列表。',
    directory: 'scripts',
    entryFile: 'form-all-fields-publish.ui.spec.mjs',
    tags: ['Playwright', 'UI', 'Headless Chrome', '表单活动', '全题型', 'P0'],
    status: 'ready',
    updatedAt: '暂无数据',
    lastRunAt: null,
    lastDuration: null,
  },
  {
    id: 'form-contact-publish',
    name: '表单联系人收录并发布',
    description: 'Chrome 无头模式访问管理后台，模拟用户创建表单、收录联系人（忽略、不替换）、保存草稿、发布并校验已发布列表。',
    directory: 'scripts',
    entryFile: 'form-contact-publish.ui.spec.mjs',
    tags: ['Playwright', 'UI', 'Headless Chrome', '表单活动', 'P0'],
    status: 'ready',
    updatedAt: '暂无数据',
    lastRunAt: null,
    lastDuration: null,
  },
]

function cloneScripts(scripts: AutomationScript[]): AutomationScript[] {
  return structuredClone(scripts)
}

function formatNow(): string {
  const now = new Date()
  const date = now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-')
  const time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${date} ${time}`
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
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
  cancelled?: boolean
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
    durationMs: Number.isFinite(value.durationMs) ? value.durationMs : 0,
    logs: Array.isArray(value.logs) ? value.logs : [],
    ...(value.result ? { output: value.result } : {}),
    ...(value.error ? { error: value.error } : {}),
  }
}

export class LocalScriptService implements ScriptService {
  private scripts = cloneScripts(initialScripts)
  private readonly activeExecutions = new Map<string, ActiveExecution>()

  constructor(
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly runnerUrl = RUNNER_URL,
    private readonly livePollIntervalMs = 500,
    private readonly cancelRequestTimeoutMs = CANCEL_REQUEST_TIMEOUT_MS,
  ) {}

  async list(): Promise<AutomationScript[]> {
    return cloneScripts(this.scripts)
  }

  async create(draft: ScriptDraft): Promise<AutomationScript> {
    const script: AutomationScript = {
      id: crypto.randomUUID(),
      name: draft.name.trim(),
      description: draft.description.trim(),
      directory: draft.directory.trim(),
      entryFile: draft.entryFile.trim(),
      tags: [...draft.tags],
      status: draft.enabled ? 'ready' : 'disabled',
      updatedAt: formatNow(),
      lastRunAt: null,
      lastDuration: null,
    }
    this.scripts.unshift(script)
    return structuredClone(script)
  }

  async update(id: string, draft: ScriptDraft): Promise<AutomationScript> {
    const index = this.scripts.findIndex((script) => script.id === id)
    if (index < 0) throw new Error('脚本不存在或已被删除')

    const current = this.scripts[index]
    if (!current) throw new Error('脚本不存在或已被删除')

    const updated: AutomationScript = {
      ...current,
      name: draft.name.trim(),
      description: draft.description.trim(),
      directory: draft.directory.trim(),
      entryFile: draft.entryFile.trim(),
      tags: [...draft.tags],
      status: draft.enabled ? (current.status === 'disabled' ? 'ready' : current.status) : 'disabled',
      updatedAt: formatNow(),
    }
    this.scripts[index] = updated
    return structuredClone(updated)
  }

  async remove(id: string): Promise<void> {
    const initialLength = this.scripts.length
    this.scripts = this.scripts.filter((script) => script.id !== id)
    if (this.scripts.length === initialLength) throw new Error('脚本不存在或已被删除')
  }

  async stop(id: string): Promise<ScriptStopResult> {
    const script = this.scripts.find((item) => item.id === id)
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

  async run(ids: string[], context: ScriptRunContext): Promise<AutomationScript[]> {
    if (!context.environmentId) throw new Error('运行脚本前必须选择环境')
    const activeIds = ids.filter((id) => this.activeExecutions.has(id))
    if (activeIds.length > 0) throw new Error('所选脚本正在运行，请先等待当前运行结束或强制停止')
    const runnable = this.scripts.filter((script) => ids.includes(script.id) && script.status !== 'disabled')
    if (runnable.length === 0) throw new Error('请选择可运行的脚本')

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
      const { script } = execution
      let result: ScriptRunResult
      if (execution.cancelRequested) {
        result = interruptedRunResult(script.lastRunResult)
        script.lastRunResult = result
        script.status = 'interrupted'
        script.lastDuration = formatDuration(result.durationMs)
        this.finishExecution(execution)
        continue
      }

      try {
        const runId = crypto.randomUUID()
        execution.runId = runId
        let requestCompleted = false
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
              variables: context.variables,
              authorizationOrigin: context.authorizationOrigin,
              extraHTTPHeaders: context.extraHTTPHeaders,
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
      script.lastRunResult = result
      script.status = result.cancelled ? 'interrupted' : result.ok ? 'passed' : 'failed'
      script.lastDuration = formatDuration(result.durationMs)
      this.finishExecution(execution)
    }
    return cloneScripts(executions.map((execution) => execution.script))
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
}
