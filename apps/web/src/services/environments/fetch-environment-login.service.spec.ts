import { describe, expect, it, vi } from 'vitest'

import { defaultSessionCheck, type TestEnvironment } from '@/domain/environment'
import { FetchEnvironmentLoginService } from './fetch-environment-login.service'

function testEnvironment(): TestEnvironment {
  return {
    id: 'env-testing',
    name: '测试环境',
    code: 'TEST',
    description: '登录测试环境',
    baseUrl: 'https://lx.admin.lingxi.tech/',
    apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
    ignoreHTTPSErrors: true,
    enabled: true,
    active: true,
    auth: {
      mode: 'mobile-code',
      method: 'POST',
      timeoutMs: 45_000,
      loginPath: '/be/login/mobile',
      requestBody: JSON.stringify({
        mobile: '13800000000',
        verify_code: '123456',
      }),
      username: '',
      password: '',
      mobile: '13800000000',
      verifyCode: '123456',
      successPath: 'code',
      successValue: '0',
      tokenPath: 'data.token',
      tokenVariable: 'AUTH_TOKEN',
      tokenTypePath: 'data.token_type',
      tokenTypeFallback: 'Bearer',
    },
    variables: [],
    updatedAt: '2026-08-11 15:30',
  }
}

describe('FetchEnvironmentLoginService', () => {
  it('invokes fetch with the browser global as its receiver', async () => {
    const fetcher = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      return Promise.resolve(new Response('{"code":0}', { status: 200 }))
    }) as unknown as typeof fetch
    const service = new FetchEnvironmentLoginService({ fetcher })

    const result = await service.login(testEnvironment())

    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
  })

  it('joins the API base URL and sends the configured mobile-code payload', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: { token: 'token-value', token_type: 'Bearer' },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const service = new FetchEnvironmentLoginService({ fetcher })

    const result = await service.login(testEnvironment())

    expect(fetcher).toHaveBeenCalledOnce()
    const [url, options] = fetcher.mock.calls[0] ?? []
    expect(url).toBe('https://lx.admin.lingxi.tech/api/be/login/mobile')
    expect(options?.method).toBe('POST')
    expect(JSON.parse(String(options?.body))).toEqual({
      mobile: '13800000000',
      verify_code: '123456',
    })
    expect(result).toMatchObject({
      ok: true,
      businessSuccess: true,
      status: 200,
      extractedToken: 'token-value',
      extractedTokenType: 'Bearer',
    })
  })

  it('sends nested values from the configured JSON request body without rebuilding it', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"code":0}', { status: 200 }))
    const environment = testEnvironment()
    environment.auth.requestBody = JSON.stringify({
      mobile: '13671153204',
      verify_code: '666666',
      client: { platform: 'web', remember: true },
    })
    const service = new FetchEnvironmentLoginService({ fetcher })

    await service.login(environment)

    const [, options] = fetcher.mock.calls[0] ?? []
    expect(JSON.parse(String(options?.body))).toEqual({
      mobile: '13671153204',
      verify_code: '666666',
      client: { platform: 'web', remember: true },
    })
  })

  it('keeps non-success response bodies available for inspection', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      message: '验证码错误',
    }), {
      status: 422,
      statusText: 'Unprocessable Content',
    }))
    const service = new FetchEnvironmentLoginService({ fetcher })

    const result = await service.login(testEnvironment())

    expect(result.ok).toBe(false)
    expect(result.businessSuccess).toBe(false)
    expect(result.status).toBe(422)
    expect(result.responseBody).toEqual({ message: '验证码错误' })
    expect(result.rawResponse).toContain('验证码错误')
  })

  it('does not mark an HTTP 200 response as a business success when code is non-zero', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      code: 1001,
      message: '验证码已失效',
      data: { token: 'must-not-apply' },
    }), { status: 200 }))
    const service = new FetchEnvironmentLoginService({ fetcher })

    const result = await service.login(testEnvironment())

    expect(result.ok).toBe(true)
    expect(result.businessSuccess).toBe(false)
  })

  it('uses the environment timeout and reports aborted requests', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>((_input, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const environment = testEnvironment()
    environment.auth.timeoutMs = 5_000
    const service = new FetchEnvironmentLoginService({ fetcher })

    const resultPromise = service.login(environment)
    await vi.advanceTimersByTimeAsync(5_000)
    const result = await resultPromise
    vi.useRealTimers()

    expect(result.status).toBeNull()
    expect(result.error).toContain('5 秒')
  })

  it('keeps HTTP metadata when reading the response body fails', async () => {
    const response = new Response('body', { status: 200, statusText: 'OK' })
    vi.spyOn(response, 'text').mockRejectedValue(new Error('stream closed'))
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response)
    const service = new FetchEnvironmentLoginService({ fetcher })

    const result = await service.login(testEnvironment())

    expect(result.ok).toBe(false)
    expect(result.status).toBe(200)
    expect(result.error).toContain('stream closed')
  })
})


describe('reused session validation', () => {
  function fixture() {
    const environment = testEnvironment()
    environment.auth.strategy = 'reuse-session'
    environment.auth.sessionCheck = { ...defaultSessionCheck(), path: '/user/info', successPath: 'data.loggedIn', successValue: 'true' }
    const session = { environmentId: environment.id, siteUrl: environment.baseUrl.replace(/\/+$/, ''),
      apiUrl: environment.apiBaseUrl, token: 'existing-token', scheme: 'Bearer', accountLabel: '', savedAt: '', expiresAt: null }
    return { environment, session }
  }

  it.each([
    [200, '{"data":{"loggedIn":true,"token":"do-not-extract"}}', true],
    [200, '{"data":{"loggedIn":false}}', false],
    [200, '{"code":0}', false],
    [200, '<html>Login</html>', false],
    [401, '{"data":{"loggedIn":true}}', false],
    [500, '{"data":{"loggedIn":true}}', false],
  ])('requires both HTTP success and the configured response rule (%s, %s)', async (status, body, valid) => {
    const { environment, session } = fixture()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status }))
    const result = await new FetchEnvironmentLoginService({ fetcher }).login(environment, session)
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(environment.apiBaseUrl + '/user/info', expect.objectContaining({
      method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer existing-token' }), redirect: 'error',
    }))
    expect(fetcher.mock.calls[0]![1]?.body).toBeUndefined()
    expect(result.businessSuccess).toBe(valid)
    expect(result.extractedToken).toBeUndefined()
    expect(result.rawResponse).toBe(body)
    expect(session.token).toBe('existing-token')
  })

  it('sends the configured validation body instead of login credentials', async () => {
    const { environment, session } = fixture()
    environment.auth.sessionCheck!.method = 'POST'
    environment.auth.sessionCheck!.requestBody = '{"scope":"profile"}'
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"data":{"loggedIn":true}}'))
    await new FetchEnvironmentLoginService({ fetcher }).login(environment, session)
    expect(fetcher.mock.calls[0]![1]?.body).toBe('{"scope":"profile"}')
  })

  it('does not send requests for missing configuration, missing or expired sessions', async () => {
    const { environment, session } = fixture()
    const fetcher = vi.fn<typeof fetch>()
    const service = new FetchEnvironmentLoginService({ fetcher })
    await expect(service.login(environment)).rejects.toThrow('Token')
    await expect(service.login(environment, { ...session, expiresAt: 1 })).rejects.toThrow('已过期')
    environment.auth.sessionCheck!.path = ''
    await expect(service.login(environment, session)).rejects.toThrow('配置接口')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('reports network and timeout failures without validating the session', async () => {
    const { environment, session } = fixture()
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('network unavailable'))
    expect(await new FetchEnvironmentLoginService({ fetcher }).login(environment, session)).toMatchObject({
      businessSuccess: false, status: null, error: 'network unavailable',
    })
    vi.useFakeTimers()
    try {
      environment.auth.sessionCheck!.timeoutMs = 5000
      fetcher.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      }))
      const pending = new FetchEnvironmentLoginService({ fetcher }).login(environment, session)
      await vi.advanceTimersByTimeAsync(5000)
      expect(await pending).toMatchObject({ businessSuccess: false, status: null, error: expect.stringContaining('5 秒') })
    } finally {
      vi.useRealTimers()
    }
  })
})
