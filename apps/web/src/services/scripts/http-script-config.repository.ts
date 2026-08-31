import { runtimeConfig } from '@/config/runtime'
import type { ScriptConfig, ScriptConfigRepository } from './script-config-repository'

interface ScriptConfigResponse {
  script?: ScriptConfig
  error?: string
}

interface ScriptConfigListResponse {
  scripts?: ScriptConfig[]
  error?: string
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`
}

export class HttpScriptConfigRepository implements ScriptConfigRepository {
  constructor(
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly runnerBaseUrl = runtimeConfig.runnerBaseUrl,
  ) {}

  async list(): Promise<ScriptConfig[]> {
    const payload = await this.request<ScriptConfigListResponse>('/script-configs', {
      method: 'GET',
    }, '读取脚本配置')
    if (!Array.isArray(payload.scripts)) throw new Error('Runner 返回的脚本配置列表格式无效')
    return structuredClone(payload.scripts)
  }

  async get(id: string): Promise<ScriptConfig | null> {
    const path = `/script-configs/${encodeURIComponent(id)}`
    let response: Response
    try {
      response = await this.fetcher(joinUrl(this.runnerBaseUrl, path), { method: 'GET' })
    } catch (error) {
      throw this.connectionError('读取脚本配置', error)
    }
    if (response.status === 404) return null
    const payload = await this.parse<ScriptConfigResponse>(response)
    if (!response.ok) throw new Error(payload.error || `Runner 返回 HTTP ${response.status}`)
    if (!payload.script) throw new Error('Runner 返回的脚本配置格式无效')
    return structuredClone(payload.script)
  }

  async create(config: ScriptConfig): Promise<ScriptConfig> {
    const payload = await this.request<ScriptConfigResponse>('/script-configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: config }),
    }, '新增脚本配置')
    if (!payload.script) throw new Error('Runner 返回的脚本配置格式无效')
    return structuredClone(payload.script)
  }

  async update(
    config: ScriptConfig,
    expectedRevision: number,
    expectedUpdatedAt: string,
  ): Promise<ScriptConfig> {
    const payload = await this.request<ScriptConfigResponse>(
      `/script-configs/${encodeURIComponent(config.id)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: config, expectedRevision, expectedUpdatedAt }),
      },
      '更新脚本配置',
    )
    if (!payload.script) throw new Error('Runner 返回的脚本配置格式无效')
    return structuredClone(payload.script)
  }

  async remove(id: string, expectedRevision: number, expectedUpdatedAt: string): Promise<void> {
    await this.request<Record<string, never>>(
      `/script-configs/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision, expectedUpdatedAt }),
      },
      '删除脚本配置',
      true,
    )
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    action: string,
    allowEmpty = false,
  ): Promise<T> {
    let response: Response
    try {
      response = await this.fetcher(joinUrl(this.runnerBaseUrl, path), init)
    } catch (error) {
      throw this.connectionError(action, error)
    }
    if (allowEmpty && response.ok && response.status === 204) return {} as T
    const payload = await this.parse<T & { error?: string }>(response)
    if (!response.ok) throw new Error(payload.error || `Runner 返回 HTTP ${response.status}`)
    return payload
  }

  private async parse<T>(response: Response): Promise<T> {
    try {
      return await response.json() as T
    } catch {
      throw new Error(`Runner 返回了无法解析的数据（HTTP ${response.status}）`)
    }
  }

  private connectionError(action: string, error: unknown): Error {
    const detail = error instanceof Error && error.message ? `：${error.message}` : ''
    return new Error(`无法连接本地 Playwright Runner（${this.runnerBaseUrl}），${action}失败${detail}`)
  }
}
