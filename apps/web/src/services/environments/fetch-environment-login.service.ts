import type { EnvironmentLoginResult } from '@/domain/environment-login'
import { parseEnvironmentRequestBody, type TestEnvironment } from '@/domain/environment'
import { getValueAtPath } from '@/domain/object-path'
import type { EnvironmentSession } from './local-environment-session.service'
import type { EnvironmentLoginService } from './environment-login-service'

interface FetchEnvironmentLoginServiceOptions {
  fetcher?: typeof fetch
  timeoutMs?: number
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function parseResponse(rawResponse: string): unknown {
  if (!rawResponse) return null
  try {
    return JSON.parse(rawResponse) as unknown
  } catch {
    return rawResponse
  }
}

function matchesExpectedValue(actual: unknown, expected: string): boolean {
  if (!expected.trim()) return Boolean(actual)
  if (typeof actual === 'string') return actual === expected
  try {
    return JSON.stringify(actual) === expected
  } catch {
    return String(actual) === expected
  }
}

export class FetchEnvironmentLoginService implements EnvironmentLoginService {
  private readonly fetcher: typeof fetch
  private readonly timeoutMs: number

  constructor(options: FetchEnvironmentLoginServiceOptions = {}) {
    const fetcher = options.fetcher ?? globalThis.fetch
    this.fetcher = fetcher.bind(globalThis)
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  async login(environment: TestEnvironment, session?: EnvironmentSession | null): Promise<EnvironmentLoginResult> {
    const reuse = environment.auth.strategy === 'reuse-session'
    const check = environment.auth.sessionCheck
    if (reuse) {
      if (!check?.path.trim() || !check.successPath.trim() || !check.successValue.trim()) {
        throw new Error('请先在“登录态校验”中配置接口路径、响应判定路径和期望值')
      }
      if (!session || session.environmentId !== environment.id
        || session.siteUrl !== new URL(environment.baseUrl).href.replace(/\/+$/, '')
        || session.apiUrl !== new URL(environment.apiBaseUrl).href.replace(/\/+$/, '')) {
        throw new Error('请先配置当前环境的登录态 Token')
      }
      if (session.expiresAt !== null && session.expiresAt <= Date.now()) throw new Error('登录态已过期，请更新 Token')
    }
    const path = reuse ? check!.path.trim() : environment.auth.loginPath
    if (reuse && (!path.startsWith('/') || path.startsWith('//') || path.includes('\\'))) {
      throw new Error('校验接口请填写以 / 开头的当前 API 相对路径')
    }
    const targetUrl = joinUrl(environment.apiBaseUrl, path)
    const method = reuse ? check!.method : environment.auth.method
    const requestBody = method === 'GET' ? {} : parseEnvironmentRequestBody(reuse ? check!.requestBody : environment.auth.requestBody)
    const configuredTimeout = reuse ? check!.timeoutMs : environment.auth.timeoutMs
    const timeoutMs = configuredTimeout > 0 ? configuredTimeout : this.timeoutMs
    const successPath = reuse ? check!.successPath : environment.auth.successPath
    const expectedValue = reuse ? check!.successValue : environment.auth.successValue
    const controller = new AbortController()
    const startedAt = performance.now()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await this.fetcher(targetUrl, {
        method,
        headers: {
          Accept: 'application/json',
          ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
          ...(reuse ? { Authorization: `${session!.scheme} ${session!.token}` } : {}),
        },
        credentials: reuse ? 'omit' : 'include',
        ...(method === 'GET' ? {} : { body: JSON.stringify(requestBody) }),
        ...(reuse ? { redirect: 'error' as const } : {}),
        signal: controller.signal,
      })
      let rawResponse: string
      try {
        rawResponse = await response.text()
      } catch (error) {
        return {
          businessSuccess: false,
          ok: false,
          status: response.status,
          statusText: response.statusText,
          targetUrl,
          durationMs: Math.round(performance.now() - startedAt),
          receivedAt: new Date().toISOString(),
          requestBody,
          responseBody: null,
          rawResponse: '',
          responseHeaders: Object.fromEntries(response.headers.entries()),
          error: error instanceof Error ? `响应体读取失败：${error.message}` : '响应体读取失败',
        }
      }
      const responseBody = parseResponse(rawResponse)
      const successValue = getValueAtPath(responseBody, successPath)
      const businessSuccess = response.ok && (
        !successPath.trim() ||
        matchesExpectedValue(successValue, expectedValue)
      )
      const extractedToken = reuse ? undefined : getValueAtPath(responseBody, environment.auth.tokenPath)
      const extractedTokenType = reuse ? undefined : getValueAtPath(responseBody, environment.auth.tokenTypePath)

      return {
        businessSuccess,
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        targetUrl,
        durationMs: Math.round(performance.now() - startedAt),
        receivedAt: new Date().toISOString(),
        requestBody,
        responseBody,
        rawResponse,
        responseHeaders: Object.fromEntries(response.headers.entries()),
        ...(extractedToken === undefined ? {} : { extractedToken }),
        ...(extractedTokenType === undefined ? {} : { extractedTokenType }),
      }
    } catch (error) {
      const message = controller.signal.aborted
        ? `请求超过 ${Math.round(timeoutMs / 1000)} 秒，已自动终止`
        : error instanceof Error ? error.message : '登录请求失败'

      return {
        businessSuccess: false,
        ok: false,
        status: null,
        statusText: '',
        targetUrl,
        durationMs: Math.round(performance.now() - startedAt),
        receivedAt: new Date().toISOString(),
        requestBody,
        responseBody: null,
        rawResponse: '',
        responseHeaders: {},
        error: message,
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}
