import { describe, expect, it, vi } from 'vitest'

import { LocalScriptService } from './local-script.service'

describe('LocalScriptService', () => {
  it('starts with submission, reply editing and publishing scripts', async () => {
    const scripts = await new LocalScriptService().list()

    expect(scripts).toHaveLength(5)
    expect(scripts.every((script) => script.timeoutMs === 300_000)).toBe(true)
    expect(scripts[0]).toMatchObject({
      id: 'form-lpxavn-submit',
      name: 'lpXAVN 全题型表单填写并提交',
      description: '根据所选环境公开域名与可配置 URL 路径拼接请求地址，校验全题型三页表单的发布契约、必填与格式边界、跨页答案保持及结构化提交载荷。',
      directory: 'scripts',
      entryFile: 'form-lpxavn-submit.ui.spec.mjs',
      requestPath: '/form/?id={{FORM_CODE}}',
    })
    expect(scripts[1]).toMatchObject({
      id: 'form-all-fields-submit',
      name: '已发布全题型表单填写并提交',
      directory: 'scripts',
      entryFile: 'form-all-fields-submit.ui.spec.mjs',
      requestPath: '/form/?id={{FORM_CODE}}',
    })
    expect(scripts[2]).toMatchObject({
      id: 'form-submission-reply-edit',
      name: '表单提交记录回复编辑',
      directory: 'scripts',
      entryFile: 'form-submission-reply-edit.ui.spec.mjs',
      requestPath: '/form-activity/submission/preview/reply/{{SUBMISSION_ID}}?fid={{FORM_ID}}',
      inputParameters: [
        expect.objectContaining({ key: 'SUBMISSION_ID', value: 'lpXAWZ' }),
        expect.objectContaining({ key: 'FORM_ID', value: 'lg2bkk' }),
        expect.objectContaining({ key: 'SUBMISSION_ASSERTIONS', value: '{}' }),
        expect.objectContaining({ key: 'SUBMISSION_EDIT_VALUES', value: '{}' }),
      ],
    })
    expect(scripts[3]).toMatchObject({
      id: 'form-all-fields-publish',
      name: '表单全题型三页发布',
      directory: 'scripts',
      entryFile: 'form-all-fields-publish.ui.spec.mjs',
      responseVariableBindings: expect.arrayContaining([
        expect.objectContaining({ variableName: 'FORM_ID', responsePath: 'formId' }),
        expect.objectContaining({ variableName: 'FORM_CODE', responsePath: 'formCode' }),
        expect.objectContaining({ variableName: 'FORM_CONTRACT', responsePath: 'formContract' }),
      ]),
    })
    expect(scripts[4]).toMatchObject({
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
      timeoutMs: 120_000,
      inputParameters: [{
        id: 'tenant',
        key: ' TENANT_ID ',
        value: ' 10000 ',
        description: ' 租户 ID ',
      }],
      tags: ['回归'],
      enabled: true,
    })

    created.name = '外部修改'
    const stored = (await service.list()).find((script) => script.id === created.id)
    expect(stored?.name).toBe('新增回归脚本')
    expect(stored?.inputParameters).toEqual([{
      id: 'tenant',
      key: 'TENANT_ID',
      value: '10000',
      description: '租户 ID',
    }])

    const updated = await service.update(created.id, {
      name: '修改后的脚本',
      description: '更新简介',
      directory: 'D:\\tests\\demo',
      entryFile: 'tests/updated.spec.ts',
      timeoutMs: 180_000,
      inputParameters: [{
        id: 'tenant',
        key: 'TENANT_ID',
        value: '20000',
        description: '新租户 ID',
      }],
      tags: ['P0'],
      enabled: false,
    })
    expect(updated.status).toBe('disabled')
    expect(updated.entryFile).toBe('tests/updated.spec.ts')
    expect(updated.timeoutMs).toBe(180_000)
    expect(updated.inputParameters?.[0]?.value).toBe('20000')
  })

  it('runs the registered form script through the local runner', async () => {
    let resolveRun: ((response: Response) => void) | null = null
    const progress: Array<{
      status: string
      logMessages: string[]
    }> = []
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
    }, (script) => {
      progress.push({
        status: script.status,
        logMessages: script.lastRunResult?.logs.map((log) => log.message) ?? [],
      })
    })

    expect((await service.list()).find((script) => script.id === 'form-contact-publish')?.status).toBe('running')
    await new Promise((resolve) => setTimeout(resolve, 10))
    const runningScript = (await service.list()).find((script) => script.id === 'form-contact-publish')
    expect(runningScript?.lastRunResult?.logs[0]?.message).toBe('正在执行 UI 步骤')
    expect(runningScript?.lastDuration).toBe('00:01')
    expect(progress[0]).toEqual({ status: 'running', logMessages: [] })
    expect(progress).toContainEqual({ status: 'running', logMessages: ['正在执行 UI 步骤'] })
    resolveRun?.(new Response(JSON.stringify({
      ok: true,
      durationMs: 1250,
      logs: [{ timestamp: '2026-08-12T10:00:01.000Z', level: 'success', message: '全部断言通过' }],
      apiResponses: [{
        sequence: 1,
        timestamp: '2026-08-12T10:00:00.500Z',
        name: '/api/be/form',
        method: 'POST',
        url: 'https://lx.admin.lingxi.tech/api/be/form',
        status: 200,
        ok: true,
        durationMs: 35,
        requestBody: { title: '完整表单' },
        responseBody: { code: 0, data: { id: '123' } },
      }],
      result: { formId: '123', status: 'published' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await runTask
    const script = (await service.list()).find((item) => item.id === 'form-contact-publish')
    expect(script?.status).toBe('passed')
    expect(script?.lastDuration).toBe('00:01')
    expect(script?.lastRunResult?.output).toEqual({ formId: '123', status: 'published' })
    expect(script?.lastRunResult?.apiResponses?.[0]).toMatchObject({
      name: '/api/be/form',
      method: 'POST',
      status: 200,
    })
    expect(progress.at(-1)?.status).toBe('passed')
    expect(progress.at(-1)?.logMessages).toContain('全部断言通过')
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:4310/runs', expect.objectContaining({ method: 'POST' }))
    const runCall = fetcher.mock.calls.find(([url]) => String(url) === 'http://127.0.0.1:4310/runs')
    const request = runCall?.[1]
    expect(JSON.parse(String(request?.body))).toMatchObject({
      timeoutMs: 300_000,
      context: {
        siteBaseUrl: 'https://lx.admin.lingxi.tech/',
        variables: { AUTH_TOKEN: 'runtime-token' },
      },
    })
  })

  it('isolates rejected progress callbacks from the script result', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      durationMs: 100,
      logs: [{ timestamp: '2026-08-12T10:00:00.000Z', level: 'success', message: '执行完成' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const onProgress = vi.fn(async () => {
      throw new Error('进度接收方异常')
    })
    const service = new LocalScriptService(fetcher as typeof fetch, 'http://127.0.0.1:4310', 1)

    const completed = await service.run(['form-contact-publish'], {
      environmentId: 'env-testing',
      siteBaseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: false,
      variables: {},
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: {},
    }, onProgress)

    expect(completed[0]).toMatchObject({
      status: 'passed',
      lastRunResult: { ok: true },
    })
    expect(onProgress).toHaveBeenCalledTimes(2)
  })

  it('persists the lpXAVN request path and passes it to the runner', async () => {
    let requestBody: Record<string, unknown> | undefined
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/runs') && init?.method === 'POST') {
        requestBody = JSON.parse(String(init.body)) as Record<string, unknown>
      }
      return new Response(JSON.stringify({
        ok: true,
        durationMs: 100,
        logs: [],
        result: { submitted: true },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    const service = new LocalScriptService(fetcher as typeof fetch, 'http://127.0.0.1:4310', 1)
    const current = (await service.list()).find((script) => script.id === 'form-lpxavn-submit')
    expect(current).toBeDefined()

    await service.update('form-lpxavn-submit', {
      name: current!.name,
      description: current!.description,
      directory: current!.directory,
      entryFile: current!.entryFile,
      timeoutMs: 123_000,
      requestPath: 'form/?id=configured',
      tags: current!.tags,
      enabled: true,
    })

    expect((await service.list()).find((script) => script.id === 'form-lpxavn-submit')?.requestPath)
      .toBe('/form/?id=configured')
    expect((await service.list()).find((script) => script.id === 'form-lpxavn-submit')?.timeoutMs)
      .toBe(123_000)

    await service.run(['form-lpxavn-submit'], {
      environmentId: 'env-testing',
      siteBaseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: false,
      variables: {},
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: { Authorization: 'Bearer runtime-token' },
    })

    expect(requestBody).toMatchObject({
      scriptId: 'form-lpxavn-submit',
      timeoutMs: 123_000,
      context: { requestPath: '/form/?id=configured' },
    })
  })

  it('injects an extracted response variable into the next script and resolves its URL', async () => {
    const requests: Array<{
      scriptId: string
      context: { requestPath?: string; variables: Record<string, string> }
    }> = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).endsWith('/runs') || init?.method !== 'POST') {
        throw new Error(`unexpected request: ${String(input)}`)
      }
      const request = JSON.parse(String(init.body)) as typeof requests[number]
      requests.push(request)
      return new Response(JSON.stringify({
        ok: true,
        durationMs: 100,
        logs: [],
        result: request.scriptId === 'form-all-fields-publish'
          ? {
              publishResponse: {
                code: 0,
                message: 'success',
                data: { form_id: 'dynamic-123', revision_no: 1, status: 'published' },
              },
              formId: 'dynamic-123',
              formCode: 'dynamic-code',
              formContract: { formCode: 'dynamic-code', fieldKeys: { username: 'username_dynamic' } },
              status: 'published',
            }
          : { submissionId: 'submission-1', status: 'submitted' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    const service = new LocalScriptService(fetcher as typeof fetch, 'http://127.0.0.1:4310', 1)
    const scripts = await service.list()
    const publish = scripts.find((script) => script.id === 'form-all-fields-publish')!
    const submit = scripts.find((script) => script.id === 'form-lpxavn-submit')!

    const completed = await service.run([publish.id, submit.id], {
      environmentId: 'env-testing',
      siteBaseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: false,
      variables: { AUTH_TOKEN: 'runtime-token' },
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: { Authorization: 'Bearer runtime-token' },
    })

    expect(completed.map((script) => script.id)).toEqual([publish.id, submit.id])
    expect(requests).toHaveLength(2)
    expect(requests[1]).toMatchObject({
      scriptId: submit.id,
      context: {
        requestPath: '/form/?id=dynamic-code',
        variables: {
          FORM_ID: 'dynamic-123',
          FORM_CODE: 'dynamic-code',
          FORM_CONTRACT: '{"formCode":"dynamic-code","fieldKeys":{"username":"username_dynamic"}}',
        },
      },
    })
    expect(completed[0]?.lastRunResult?.logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: 'success', message: '已从运行结果提取 3 个变量' }),
    ]))
  })

  it('applies script input defaults locally and lets run variables override them', async () => {
    const requests: Array<{
      scriptId: string
      context: { requestPath?: string; variables: Record<string, string> }
    }> = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).endsWith('/runs') || init?.method !== 'POST') {
        throw new Error(`unexpected request: ${String(input)}`)
      }
      requests.push(JSON.parse(String(init.body)) as typeof requests[number])
      return new Response(JSON.stringify({
        ok: true,
        durationMs: 100,
        logs: [],
        result: { completed: true },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    const service = new LocalScriptService(fetcher as typeof fetch, 'http://127.0.0.1:4310', 1)

    await service.run(['form-submission-reply-edit', 'form-contact-publish'], {
      environmentId: 'env-testing',
      siteBaseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: false,
      variables: { FORM_ID: 'runtime-form-id', AUTH_TOKEN: 'runtime-token' },
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: { Authorization: 'Bearer runtime-token' },
    })

    expect(requests[0]).toMatchObject({
      scriptId: 'form-submission-reply-edit',
      context: {
        requestPath: '/form-activity/submission/preview/reply/lpXAWZ?fid=runtime-form-id',
        variables: {
          SUBMISSION_ID: 'lpXAWZ',
          FORM_ID: 'runtime-form-id',
          SUBMISSION_ASSERTIONS: '{}',
          SUBMISSION_EDIT_VALUES: '{}',
          AUTH_TOKEN: 'runtime-token',
        },
      },
    })
    expect(requests[1]).toMatchObject({
      scriptId: 'form-contact-publish',
      context: { variables: { FORM_ID: 'runtime-form-id', AUTH_TOKEN: 'runtime-token' } },
    })
    expect(requests[1]?.context.variables).not.toHaveProperty('SUBMISSION_ID')
    expect(requests[1]?.context.variables).not.toHaveProperty('SUBMISSION_ASSERTIONS')
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
