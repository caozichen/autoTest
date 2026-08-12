import { describe, expect, it, vi } from 'vitest'

import { LocalScriptService } from './local-script.service'

describe('LocalScriptService', () => {
  it('starts with only the real form contact publishing script', async () => {
    const scripts = await new LocalScriptService().list()

    expect(scripts).toHaveLength(1)
    expect(scripts[0]).toMatchObject({
      id: 'form-contact-publish',
      name: '表单联系人收录并发布',
      directory: 'scripts',
      entryFile: 'form-contact-publish.api.spec.mjs',
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
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      durationMs: 1250,
      logs: [{ timestamp: '2026-08-12T10:00:00.000Z', level: 'success', message: '全部断言通过' }],
      result: { formId: '123', status: 'published' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const service = new LocalScriptService(fetcher as typeof fetch)
    const runTask = service.run(['form-contact-publish'], {
      environmentId: 'env-testing',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: false,
      variables: { AUTH_TOKEN: 'runtime-token' },
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: { Authorization: 'Bearer runtime-token' },
    })

    expect((await service.list()).find((script) => script.id === 'form-contact-publish')?.status).toBe('running')
    await runTask
    const script = (await service.list()).find((item) => item.id === 'form-contact-publish')
    expect(script?.status).toBe('passed')
    expect(script?.lastDuration).toBe('00:01')
    expect(script?.lastRunResult?.output).toEqual({ formId: '123', status: 'published' })
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:4310/runs', expect.objectContaining({ method: 'POST' }))
    const request = fetcher.mock.calls[0]?.[1]
    expect(JSON.parse(String(request?.body))).toMatchObject({
      context: { variables: { AUTH_TOKEN: 'runtime-token' } },
    })
  })
})
