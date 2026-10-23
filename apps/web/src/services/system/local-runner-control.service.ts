import { parseRunnerResources, type RunnerResourceSnapshot } from './runner-resources'

import type {
  RunnerControlService,
  RunnerServiceState,
  RunnerStartResult,
} from './runner-control-service'

const RUNNER_HEALTH_URL = 'http://127.0.0.1:4310/health'
const RUNNER_START_URL = 'http://127.0.0.1:4311/runner/start'

export class LocalRunnerControlService implements RunnerControlService {
  constructor(
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly healthUrl = RUNNER_HEALTH_URL,
    private readonly startUrl = RUNNER_START_URL,
    private readonly healthTimeoutMs = 2_000,
  ) {}

  async getStatus(): Promise<RunnerServiceState> {
    const controller = new AbortController()
    const timeout = globalThis.setTimeout(() => controller.abort(), this.healthTimeoutMs)
    let online = false
    try {
      const response = await this.fetcher(this.healthUrl, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
      if (response.ok) {
        const body = await response.json() as { ok?: unknown }
        online = body.ok === true
      }
    } catch {
      online = false
    } finally {
      globalThis.clearTimeout(timeout)
    }

    return {
      status: online ? 'online' : 'offline',
      endpoint: this.healthUrl,
      checkedAt: new Date().toISOString(),
    }
  }

  async getResources(): Promise<RunnerResourceSnapshot> {
    const controller = new AbortController()
    const timeout = globalThis.setTimeout(() => controller.abort(), this.healthTimeoutMs)
    try {
      const response = await this.fetcher(new URL('/runner/resources', this.healthUrl).href, {
        headers: { Accept: 'application/json' }, signal: controller.signal, cache: 'no-store',
      })
      if (!response.ok) throw new Error(`资源采集失败（HTTP ${response.status}），请检查 Runner 版本及状态`)
      return parseRunnerResources(await response.json())
    } catch (error) {
      if (controller.signal.aborted) throw new Error('资源采集超时，请稍后手动刷新')
      if (error instanceof TypeError) throw new Error('无法连接 Runner，资源数据不可用')
      throw error
    } finally { globalThis.clearTimeout(timeout) }
  }

  async start(): Promise<RunnerStartResult> {
    let response: Response
    try {
      response = await this.fetcher(this.startUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'X-Autotest-Control': 'start-runner',
        },
      })
    } catch {
      throw new Error('无法连接本地服务管理器（127.0.0.1:4311），请重新启动 AutoTest Supervisor')
    }
    const body = await response.json().catch(() => null) as {
      ok?: unknown
      status?: unknown
      pid?: unknown
      error?: unknown
    } | null
    if (!response.ok || body?.ok !== true) {
      throw new Error(typeof body?.error === 'string' ? body.error : `Runner 启动失败（HTTP ${response.status}）`)
    }
    if (body.status !== 'started' && body.status !== 'already-running') {
      throw new Error('Runner 启动接口返回了无法识别的状态')
    }
    return {
      status: body.status,
      ...(typeof body.pid === 'number' ? { pid: body.pid } : {}),
    }
  }
}
