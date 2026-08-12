import type { EnvironmentLoginResult } from '@/domain/environment-login'
import type { TestEnvironment } from '@/domain/environment'
import { getValueAtPath } from '@/domain/object-path'
import type { EnvironmentLoginService } from './environment-login-service'

interface FetchEnvironmentLoginServiceOptions {
  fetcher?: typeof fetch
  timeoutMs?: number
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function buildRequestBody(environment: TestEnvironment): Record<string, string> {
  if (environment.auth.mode === 'mobile-code') {
    return {
      mobile: environment.auth.mobile,
      verify_code: environment.auth.verifyCode,
    }
  }

  return {
    username: environment.auth.username,
    password: environment.auth.password,
  }
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

  async login(environment: TestEnvironment): Promise<EnvironmentLoginResult> {
    const targetUrl = joinUrl(environment.apiBaseUrl, environment.auth.loginPath)
    const requestBody = buildRequestBody(environment)
    const timeoutMs = environment.auth.timeoutMs > 0 ? environment.auth.timeoutMs : this.timeoutMs
    const controller = new AbortController()
    const startedAt = performance.now()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await this.fetcher(targetUrl, {
        method: environment.auth.method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(requestBody),
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
      const successValue = getValueAtPath(responseBody, environment.auth.successPath)
      const businessSuccess = response.ok && (
        !environment.auth.successPath.trim() ||
        matchesExpectedValue(successValue, environment.auth.successValue)
      )
      const extractedToken = getValueAtPath(responseBody, environment.auth.tokenPath)
      const extractedTokenType = getValueAtPath(responseBody, environment.auth.tokenTypePath)

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
