import { describe, expect, it, vi } from 'vitest'

import { LocalScriptService } from './local-script.service'

describe('LocalScriptService', () => {
  it('starts with the all-fields submission script and keeps both publishing scripts', async () => {
    const scripts = await new LocalScriptService().list()

    expect(scripts).toHaveLength(3)
    expect(scripts[0]).toMatchObject({
      id: 'form-all-fields-submit',
      name: '已发布全题型表单填写并提交',
      directory: 'scripts',
      entryFile: 'form-all-fields-submit.ui.spec.mjs',
    })
    expect(scripts[1]).toMatchObject({
      id: 'form-all-fields-publish',
      name: '表单全题型三页发布',
      directory: 'scripts',
      entryFile: 'form-all-fields-publish.ui.spec.mjs',
    })
    expect(scripts[2]).toMatchObject({
      id: 'form-contact-publish',
      name: '表单联系人收录并发布',
      directory: 'scripts',
      entryFile: 'form-contact-publish.ui.spec.mjs',
    })
  })

  it('creates and updates a script without exposing internal state', async () => {
    const service = new LocalScriptService()
    const created = await service.create({
      name: '新增回归脚本',
      description: '用于测试本地服务',
      directory: 'D:\\tests\\demo',
      entryFile: 'tests/demo.spec.ts',
      tags: ['回归'],
      enabled: true,
    })

    created.name = '外部修改'
    const stored = (await service.list()).find((script) => script.id === created.id)
    expect(stored?.name).toBe('新增回归脚本')

    const updated = await service.update(created.id, {
      name: '修改后的脚本',
      description: '更新简介',
      directory: 'D:\\tests\\demo',
      entryFile: 'tests/updated.spec.ts',
      tags: ['P0'],
      enabled: false,
    })
    expect(updated.status).toBe('disabled')
    expect(updated.entryFile).toBe('tests/updated.spec.ts')
  })

  it('runs the registered form script through the local runner', async () => {
    let resolveRun: ((response: Response) => void) | null = null
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/runs/')) {
        return new Response(JSON.stringify({
          status: 'running',
          durationMs: 600,
          logs: [{ timestamp: '2026-08-12T10:00:00.000Z', level: 'info', message: '正在执行 UI 步骤' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Promise<Response>((resolve) => {
        resolveRun = resolve
      })
    })
    const service = new LocalScriptService(fetcher as typeof fetch, 'http://127.0.0.1:4310', 1)
    const runTask = service.run(['form-contact-publish'], {
      environmentId: 'env-testing',
      siteBaseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: false,
      variables: { AUTH_TOKEN: 'runtime-token' },
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: { Authorization: 'Bearer runtime-token' },
    })

    expect((await service.list()).find((script) => script.id === 'form-contact-publish')?.status).toBe('running')
    await new Promise((resolve) => setTimeout(resolve, 10))
    const runningScript = (await service.list()).find((script) => script.id === 'form-contact-publish')
    expect(runningScript?.lastRunResult?.logs[0]?.message).toBe('正在执行 UI 步骤')
    expect(runningScript?.lastDuration).toBe('00:01')
    resolveRun?.(new Response(JSON.stringify({
      ok: true,
      durationMs: 1250,
      logs: [{ timestamp: '2026-08-12T10:00:01.000Z', level: 'success', message: '全部断言通过' }],
      result: { formId: '123', status: 'published' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await runTask
    const script = (await service.list()).find((item) => item.id === 'form-contact-publish')
    expect(script?.status).toBe('passed')
    expect(script?.lastDuration).toBe('00:01')
    expect(script?.lastRunResult?.output).toEqual({ formId: '123', status: 'published' })
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:4310/runs', expect.objectContaining({ method: 'POST' }))
    const runCall = fetcher.mock.calls.find(([url]) => String(url) === 'http://127.0.0.1:4310/runs')
    const request = runCall?.[1]
    expect(JSON.parse(String(request?.body))).toMatchObject({
      context: {
        siteBaseUrl: 'https://lx.admin.lingxi.tech/',
        variables: { AUTH_TOKEN: 'runtime-token' },
      },
    })
  })

  it('force stops an active runner request and keeps the late result interrupted', async () => {
    let resolveRun: ((response: Response) => void) | null = null
    let activeRunId = ''
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === 'http://127.0.0.1:4310/runs') {
        activeRunId = JSON.parse(String(init?.body)).runId
        return new Promise<Response>((resolve) => {
          resolveRun = resolve
        })
      }
      if (url === `http://127.0.0.1:4310/runs/${activeRunId}/cancel`) {
        return new Response(JSON.stringify({
          ok: true,
          cancelledRunIds: [activeRunId],
          runs: [],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      expect(init).toBeUndefined()
      return new Response(JSON.stringify({
        status: 'running',
        ok: false,
        durationMs: 300,
        logs: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    const service = new LocalScriptService(fetcher as typeof fetch, 'http://127.0.0.1:4310', 1)
    const runTask = service.run(['form-contact-publish'], {
      environmentId: 'env-testing',
      siteBaseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: false,
      variables: {},
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: {},
    })

    const stopped = await service.stop('form-contact-publish')
    expect(stopped).toEqual({ runnerFound: true, cancelledRunIds: [activeRunId] })
    expect((await service.list()).find((script) => script.id === 'form-contact-publish')).toMatchObject({
      status: 'interrupted',
      lastRunResult: { ok: false, cancelled: true },
    })

    resolveRun?.(new Response(JSON.stringify({
      ok: false,
      cancelled: true,
      status: 'interrupted',
      durationMs: 450,
      error: '用户强制停止运行',
      logs: [{ timestamp: '2026-08-14T10:00:00.000Z', level: 'warning', message: '用户强制停止运行' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const completed = await runTask

    expect(completed[0]).toMatchObject({
      status: 'interrupted',
      lastRunResult: { ok: false, cancelled: true, durationMs: 450 },
    })
    expect((await service.list()).find((script) => script.id === 'form-contact-publish')?.status).toBe('interrupted')
    expect(fetcher).toHaveBeenCalledWith(
      `http://127.0.0.1:4310/runs/${activeRunId}/cancel`,
      expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
    )
    expect(fetcher).not.toHaveBeenCalledWith(
      'http://127.0.0.1:4310/scripts/form-contact-publish/cancel',
      expect.anything(),
    )
  })

  it('allows a stale local run to be unlocked when the runner returns 404', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: '该脚本没有正在运行的任务' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    }))
    const service = new LocalScriptService(fetcher as typeof fetch)

    await expect(service.stop('form-all-fields-publish')).resolves.toEqual({
      runnerFound: false,
      cancelledRunIds: [],
    })
    expect((await service.list()).find((script) => script.id === 'form-all-fields-publish')).toMatchObject({
      status: 'interrupted',
      lastRunResult: { cancelled: true },
    })
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:4310/scripts/form-all-fields-publish/cancel',
      expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
    )
  })

  it('rejects an unknown 404 without unlocking the local run state', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: '接口不存在' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    }))
    const service = new LocalScriptService(fetcher as typeof fetch)

    await expect(service.stop('form-all-fields-publish')).rejects.toThrow('接口不存在')
    expect((await service.list()).find((script) => script.id === 'form-all-fields-publish')?.status).toBe('ready')
  })

  it('times out a hanging cancellation request and keeps the local state unchanged', async () => {
    let requestSignal: AbortSignal | undefined
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined
      return new Promise<Response>(() => {})
    })
    const service = new LocalScriptService(fetcher as typeof fetch, 'http://127.0.0.1:4310', 1, 10)

    await expect(service.stop('form-all-fields-publish')).rejects.toThrow(
      'Runner 强制停止请求超时（10ms），请确认 Runner 服务正常后重试',
    )
    expect(requestSignal?.aborted).toBe(true)
    expect((await service.list()).find((script) => script.id === 'form-all-fields-publish')?.status).toBe('ready')
  })

  it('does not report a stop when the runner cancellation request fails', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: 'Runner 内部错误' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }))
    const service = new LocalScriptService(fetcher as typeof fetch)

    await expect(service.stop('form-all-fields-publish')).rejects.toThrow('Runner 内部错误')
    expect((await service.list()).find((script) => script.id === 'form-all-fields-publish')?.status).toBe('ready')
  })
})
