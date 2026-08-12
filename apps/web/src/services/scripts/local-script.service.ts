import type { AutomationScript, ScriptDraft, ScriptRunContext, ScriptRunResult } from '@/domain/script'
import type { ScriptService } from './script-service'

const RUNNER_URL = 'http://127.0.0.1:4310'

const initialScripts: AutomationScript[] = [
  {
    id: 'form-contact-publish',
    name: '表单联系人收录并发布',
    description: 'API-only 创建表单草稿，开启联系人收录（忽略、不替换），发布并校验已发布列表。',
    directory: 'scripts',
    entryFile: 'form-contact-publish.api.spec.mjs',
    tags: ['Playwright', 'API', '表单活动', 'P0'],
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

interface RunnerResponse {
  ok: boolean
  durationMs: number
  logs: ScriptRunResult['logs']
  result?: Record<string, unknown>
  error?: string
}

function normalizeRunnerResponse(value: RunnerResponse): ScriptRunResult {
  return {
    ok: value.ok === true,
    durationMs: Number.isFinite(value.durationMs) ? value.durationMs : 0,
    logs: Array.isArray(value.logs) ? value.logs : [],
    ...(value.result ? { output: value.result } : {}),
    ...(value.error ? { error: value.error } : {}),
  }
}

export class LocalScriptService implements ScriptService {
  private scripts = cloneScripts(initialScripts)

  constructor(
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly runnerUrl = RUNNER_URL,
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

  async run(ids: string[], context: ScriptRunContext): Promise<AutomationScript[]> {
    if (!context.environmentId) throw new Error('运行脚本前必须选择环境')
    const runnable = this.scripts.filter((script) => ids.includes(script.id) && script.status !== 'disabled')
    if (runnable.length === 0) throw new Error('请选择可运行的脚本')

    runnable.forEach((script) => {
      script.status = 'running'
      script.lastRunAt = '刚刚'
      script.lastDuration = null
    })

    for (const script of runnable) {
      let result: ScriptRunResult
      try {
        const response = await this.fetcher(`${this.runnerUrl}/runs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scriptId: script.id,
            context: {
              apiBaseUrl: context.apiBaseUrl,
              ignoreHTTPSErrors: context.ignoreHTTPSErrors,
              variables: context.variables,
              authorizationOrigin: context.authorizationOrigin,
              extraHTTPHeaders: context.extraHTTPHeaders,
            },
          }),
        })
        const payload = await response.json() as RunnerResponse
        if (!response.ok) throw new Error(payload.error || `Runner 返回 HTTP ${response.status}`)
        result = normalizeRunnerResponse(payload)
      } catch (error) {
        result = failedRunResult(error instanceof TypeError
          ? new Error(`无法连接本地 Playwright Runner（${this.runnerUrl}），请确认 npm run dev 已同时启动 Web 和 Runner`)
          : error)
      }

      script.lastRunResult = result
      script.status = result.ok ? 'passed' : 'failed'
      script.lastDuration = formatDuration(result.durationMs)
    }
    return cloneScripts(runnable)
  }
}
