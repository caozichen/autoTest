import { describe, expect, it, vi } from 'vitest'

import { CANCEL_REQUEST_TIMEOUT_MS, LocalScriptService } from './local-script.service'
import type { ScriptConfig, ScriptConfigRepository } from './script-config-repository'

const timestamp = '2026-08-31T08:00:00.000Z'
const liveArtifact = {
  executionId: 'execution-001',
  stepId: 'form-contact-publish',
  attemptId: 'attempt-live-001',
  absolutePath: '/tmp/autotest/execution-001/form-contact-publish/attempt-live-001/live.png',
  relativePath: 'live.png',
  type: 'screenshot',
  mimeType: 'image/png',
  sizeBytes: 128,
  createdAt: '2026-08-12T10:00:00.500Z',
}
const finalArtifact = {
  executionId: 'execution-001',
  stepId: 'form-contact-publish',
  attemptId: 'attempt-final-001',
  absolutePath: '/tmp/autotest/execution-001/form-contact-publish/attempt-final-001/trace.zip',
  relativePath: 'trace.zip',
  type: 'trace',
  mimeType: 'application/zip',
  sizeBytes: 512,
  createdAt: '2026-08-12T10:00:01.000+00:00',
}

function config(
  value: Pick<ScriptConfig, 'id' | 'name' | 'entryFile'> & Partial<ScriptConfig>,
): ScriptConfig {
  return {
    schemaVersion: 1,
    revision: 1,
    description: '自动化测试脚本',
    directory: 'scripts',
    timeoutMs: 300_000,
    enabled: true,
    tags: ['Playwright', 'UI', 'P0'],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...value,
  }
}

function initialConfigs(): ScriptConfig[] {
  return [
    config({
      id: 'form-lpxavn-submit',
      name: 'lpXAVN 全题型表单填写并提交',
      description: '根据所选环境公开域名与可配置 URL 路径拼接请求地址，校验全题型三页表单的发布契约、必填与格式边界、跨页答案保持及结构化提交载荷。',
      entryFile: 'form-lpxavn-submit.ui.spec.mjs',
      requestPath: '/form/?id={{FORM_ID}}',
    }),
    config({
      id: 'form-all-fields-submit',
      name: '已发布全题型表单填写并提交',
      entryFile: 'form-all-fields-submit.ui.spec.mjs',
      requestPath: '/form/?id={{FORM_ID}}',
    }),
    config({
      id: 'form-submission-reply-edit',
      name: '表单提交记录回复编辑',
      entryFile: 'form-submission-reply-edit.ui.spec.mjs',
      requestPath: '/form-activity/submission/preview/reply/{{SUBMISSION_ID}}?fid={{FORM_ID}}',
      inputParameters: [
        { id: 'reply-submission-id', key: 'SUBMISSION_ID', value: 'lpXAWZ', description: '提交记录 ID' },
        { id: 'reply-form-id', key: 'FORM_ID', value: 'lg2bkk', description: '表单 ID' },
        { id: 'reply-submission-assertions', key: 'SUBMISSION_ASSERTIONS', value: '{}', description: '断言 JSON' },
        { id: 'reply-submission-edit-values', key: 'SUBMISSION_EDIT_VALUES', value: '{}', description: '修改 JSON' },
      ],
    }),
    config({
      id: 'form-all-fields-publish',
      name: '表单全题型三页发布',
      entryFile: 'form-all-fields-publish.ui.spec.mjs',
      responseVariableBindings: [
        { id: 'published-form-id', variableName: 'FORM_ID', responsePath: 'formId', secret: false },
        { id: 'published-form-contract', variableName: 'FORM_CONTRACT', responsePath: 'formContract', secret: false },
      ],
    }),
    config({
      id: 'form-contact-publish',
      name: '表单联系人收录并发布',
      entryFile: 'form-contact-publish.ui.spec.mjs',
      responseVariableBindings: [
        { id: 'contact-form-id', variableName: 'FORM_ID', responsePath: 'formId', secret: false },
        { id: 'contact-form-contract', variableName: 'FORM_CONTRACT', responsePath: 'formContract', secret: false },
      ],
    }),
    config({
      id: 'form-multilingual-translation-publish',
      name: '表单多语言 AI 翻译、发布与分享校验',
      description: 'Chrome 无头模式打开可配置表单的多语言翻译页，执行一键 AI 翻译，校验保存、完成、发布、预览及分享界面的三语言配置与内容。',
      entryFile: 'form-multilingual-translation-publish.ui.spec.mjs',
      timeoutMs: 600_000,
      requestPath: '/form-activity/translation?id={{FORM_ID}}',
      inputParameters: [
        { id: 'translation-form-id', key: 'FORM_ID', value: '4J027Q', description: '待翻译、完成并发布的表单 ID' },
        { id: 'translation-ai-timeout-ms', key: 'AI_TRANSLATION_TIMEOUT_MS', value: '120000', description: '一键 AI 翻译完成等待超时，默认 2 分钟' },
        { id: 'translation-expectations', key: 'TRANSLATION_EXPECTATIONS', value: '{}', description: '可选关键译文精确断言 JSON' },
      ],
    }),
  ]
}

class MemoryScriptConfigRepository implements ScriptConfigRepository {
  private configs = initialConfigs()

  async list(): Promise<ScriptConfig[]> {
    return structuredClone(this.configs)
  }

  async get(id: string): Promise<ScriptConfig | null> {
    return structuredClone(this.configs.find((item) => item.id === id) ?? null)
  }

  async create(value: ScriptConfig): Promise<ScriptConfig> {
    const created = { ...structuredClone(value), revision: 1 }
    this.configs.unshift(created)
    return structuredClone(created)
  }

  async update(
    value: ScriptConfig,
    expectedRevision: number,
    expectedUpdatedAt: string,
  ): Promise<ScriptConfig> {
    const index = this.configs.findIndex((item) => item.id === value.id)
    const current = this.configs[index]
    if (!current) throw new Error('脚本不存在或已被删除')
    if (current.revision !== expectedRevision || current.updatedAt !== expectedUpdatedAt) {
      throw new Error('脚本配置已被其他页面修改')
    }
    const updated = { ...structuredClone(value), revision: current.revision + 1 }
    this.configs[index] = updated
    return structuredClone(updated)
  }

  async remove(id: string, expectedRevision: number, expectedUpdatedAt: string): Promise<void> {
    const index = this.configs.findIndex((item) => item.id === id)
    const current = this.configs[index]
    if (!current) throw new Error('脚本不存在或已被删除')
    if (current.revision !== expectedRevision || current.updatedAt !== expectedUpdatedAt) {
      throw new Error('脚本配置已被其他页面修改')
    }
    this.configs.splice(index, 1)
  }
}

function createService(
  fetcher: typeof fetch = vi.fn(async () => {
    throw new Error('unexpected runner request')
  }) as typeof fetch,
  livePollIntervalMs = 1,
  cancelRequestTimeoutMs = 5_000,
  options?: ConstructorParameters<typeof LocalScriptService>[5],
): LocalScriptService {
  return new LocalScriptService(
    fetcher,
    'http://127.0.0.1:4310',
    livePollIntervalMs,
    cancelRequestTimeoutMs,
    new MemoryScriptConfigRepository(),
    options,
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function settleWithin<T>(promise: Promise<T>, timeoutMs = 250): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      reject(new Error(`operation did not settle within ${timeoutMs}ms`))
    }, timeoutMs)
    void promise.then(
      (value) => {
        globalThis.clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        globalThis.clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

describe('production cancellation budget', () => {
  it('outlasts the server cancellation wait deadline', () => {
    expect(CANCEL_REQUEST_TIMEOUT_MS).toBe(20_000)
    expect(CANCEL_REQUEST_TIMEOUT_MS).toBeGreaterThan(16_000)
  })
})

function terminalAssertionFailure(): Response {
  return new Response(JSON.stringify({
    status: 'partial',
    ok: false,
    continuePipeline: true,
    durationMs: 21_654,
    logs: [{
      timestamp: '2026-09-04T07:55:54.000Z',
      level: 'error',
      message: '脚本已执行完成，共有 1 条断言失败',
    }],
    assertions: [{
      sequence: 1,
      timestamp: '2026-09-04T07:55:53.000Z',
      name: '提交接口返回成功',
      module: '表单提交',
      matcher: 'toBe(true)',
      status: 'failed',
      durationMs: 1,
      error: 'expected false to be true',
    }],
    error: '脚本已执行完成，共有 1 条断言失败',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('LocalScriptService', () => {
  it('starts with submission, reply editing and publishing scripts', async () => {
    const scripts = await createService().list()

    expect(scripts).toHaveLength(6)
    expect(scripts.slice(0, 5).every((script) => script.timeoutMs === 300_000)).toBe(true)
    expect(scripts[0]).toMatchObject({
      id: 'form-lpxavn-submit',
      name: 'lpXAVN 全题型表单填写并提交',
      description: '根据所选环境公开域名与可配置 URL 路径拼接请求地址，校验全题型三页表单的发布契约、必填与格式边界、跨页答案保持及结构化提交载荷。',
      directory: 'scripts',
      entryFile: 'form-lpxavn-submit.ui.spec.mjs',
      requestPath: '/form/?id={{FORM_ID}}',
    })
    expect(scripts[1]).toMatchObject({
      id: 'form-all-fields-submit',
      name: '已发布全题型表单填写并提交',
      directory: 'scripts',
      entryFile: 'form-all-fields-submit.ui.spec.mjs',
      requestPath: '/form/?id={{FORM_ID}}',
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
      responseVariableBindings: [
        expect.objectContaining({ variableName: 'FORM_ID', responsePath: 'formId' }),
        expect.objectContaining({ variableName: 'FORM_CONTRACT', responsePath: 'formContract' }),
      ],
    })
    expect(scripts[4]).toMatchObject({
      id: 'form-contact-publish',
      name: '表单联系人收录并发布',
      directory: 'scripts',
      entryFile: 'form-contact-publish.ui.spec.mjs',
      responseVariableBindings: [
        expect.objectContaining({ variableName: 'FORM_ID', responsePath: 'formId' }),
        expect.objectContaining({ variableName: 'FORM_CONTRACT', responsePath: 'formContract' }),
      ],
    })
    expect(scripts[5]).toMatchObject({
      id: 'form-multilingual-translation-publish',
      name: '表单多语言 AI 翻译、发布与分享校验',
      directory: 'scripts',
      entryFile: 'form-multilingual-translation-publish.ui.spec.mjs',
      timeoutMs: 600_000,
      requestPath: '/form-activity/translation?id={{FORM_ID}}',
      inputParameters: [
        expect.objectContaining({ key: 'FORM_ID', value: '4J027Q' }),
        expect.objectContaining({ key: 'AI_TRANSLATION_TIMEOUT_MS', value: '120000' }),
        expect.objectContaining({ key: 'TRANSLATION_EXPECTATIONS', value: '{}' }),
      ],
      responseVariableBindings: [],
    })
  })

  it('creates and updates a script without exposing internal state', async () => {
    const service = createService()
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
          artifacts: [
            { ...liveArtifact, ignored: 'runner-only field' },
            { ...liveArtifact, relativePath: '../outside.png' },
            null,
          ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Promise<Response>((resolve) => {
        resolveRun = resolve
      })
    })
    const service = createService(fetcher as typeof fetch)
    const runTask = service.run(['form-contact-publish'], {
      environmentId: 'env-testing',
      executionId: 'execution-001',
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
    expect(runningScript?.lastRunResult?.artifacts).toEqual([liveArtifact])
    expect(progress[0]).toEqual({ status: 'running', logMessages: [] })
    expect(progress).toContainEqual({ status: 'running', logMessages: ['正在执行 UI 步骤'] })
    resolveRun?.(new Response(JSON.stringify({
      ok: true,
      continuePipeline: true,
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
        phase: '创建表单',
        pageUrl: 'https://lx.admin.lingxi.tech/forms',
        mimeType: 'application/json',
        isFirstParty: true,
      }],
      resourceResponses: [{
        sequence: 1,
        timestamp: '2026-08-12T10:00:00.600Z',
        name: 'app.js',
        method: 'GET',
        url: 'https://lx.admin.lingxi.tech/assets/app.js',
        resourceType: 'script',
        status: 200,
        ok: true,
        durationMs: 18,
        phase: '页面初始化',
        mimeType: 'application/javascript',
        isFirstParty: true,
      }],
      networkSummary: {
        api: { observed: 1, recorded: 1, dropped: 0, passed: 1, failed: 0, warnings: 0 },
        resources: { observed: 1, recorded: 1, dropped: 0, passed: 1, failed: 0, warnings: 0 },
      },
      artifacts: [
        { ...finalArtifact, ignored: true },
        { ...finalArtifact, sizeBytes: -1 },
        { ...finalArtifact, createdAt: 'not-a-date' },
        'invalid artifact',
      ],
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
      phase: '创建表单',
    })
    expect(script?.lastRunResult).toMatchObject({
      continuePipeline: true,
      resourceResponses: [{ resourceType: 'script', status: 200, phase: '页面初始化' }],
      networkSummary: {
        api: { observed: 1, recorded: 1, passed: 1 },
        resources: { observed: 1, recorded: 1, passed: 1 },
      },
    })
    expect(script?.lastRunResult?.artifacts).toEqual([{
      ...finalArtifact,
      createdAt: '2026-08-12T10:00:01.000Z',
    }])
    expect(progress.at(-1)?.status).toBe('passed')
    expect(progress.at(-1)?.logMessages).toContain('全部断言通过')
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:4310/runs', expect.objectContaining({ method: 'POST' }))
    const runCall = fetcher.mock.calls.find(([url]) => String(url) === 'http://127.0.0.1:4310/runs')
    const request = runCall?.[1]
    expect(JSON.parse(String(request?.body))).toMatchObject({
      executionId: 'execution-001',
      scriptId: 'form-contact-publish',
      context: {
        siteBaseUrl: 'https://lx.admin.lingxi.tech/',
        variables: { AUTH_TOKEN: 'runtime-token' },
      },
    })
    expect(JSON.parse(String(request?.body)).context).not.toHaveProperty('executionId')
    expect(JSON.parse(String(request?.body))).not.toHaveProperty('timeoutMs')
  })

  it('uses a terminal failed GET snapshot when the POST request never settles', async () => {
    const postResponse = deferred<Response>()
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/runs') && init?.method === 'POST') return postResponse.promise
      if (String(input).includes('/runs/')) return Promise.resolve(terminalAssertionFailure())
      return Promise.reject(new Error(`unexpected request: ${String(input)}`))
    })
    const service = createService(fetcher as typeof fetch)
    const runTask = service.run(['form-contact-publish'], {
      environmentId: 'env-testing',
      siteBaseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: false,
      variables: {},
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: {},
    })

    try {
      const completed = await settleWithin(runTask)

      expect(completed[0]).toMatchObject({
        status: 'partial',
        lastRunResult: {
          ok: false,
          continuePipeline: true,
          durationMs: 21_654,
          error: '脚本已执行完成，共有 1 条断言失败',
          assertions: [{ status: 'failed', module: '表单提交' }],
        },
      })
    } finally {
      postResponse.resolve(terminalAssertionFailure())
      await runTask.catch(() => undefined)
    }
  })

  it('keeps the terminal GET result when the original POST later rejects', async () => {
    const postResponse = deferred<Response>()
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/runs') && init?.method === 'POST') return postResponse.promise
      if (String(input).includes('/runs/')) return Promise.resolve(terminalAssertionFailure())
      return Promise.reject(new Error(`unexpected request: ${String(input)}`))
    })
    const service = createService(fetcher as typeof fetch)
    const runTask = service.run(['form-contact-publish'], {
      environmentId: 'env-testing',
      siteBaseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: false,
      variables: {},
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: {},
    })

    try {
      const completed = await settleWithin(runTask)
      postResponse.reject(new TypeError('POST connection closed after completion'))
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0))

      expect(completed[0]).toMatchObject({
        status: 'partial',
        lastRunResult: {
          ok: false,
          continuePipeline: true,
          error: '脚本已执行完成，共有 1 条断言失败',
        },
      })
      expect((await service.list()).find((script) => script.id === 'form-contact-publish'))
        .toMatchObject({
          status: 'partial',
          lastRunResult: { continuePipeline: true },
        })
    } finally {
      postResponse.reject(new TypeError('release pending POST'))
      await runTask.catch(() => undefined)
    }
  })

  it('checks the terminal GET snapshot once when the POST request fails first', async () => {
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/runs') && init?.method === 'POST') {
        return Promise.reject(new TypeError('POST connection closed'))
      }
      if (String(input).includes('/runs/')) return Promise.resolve(terminalAssertionFailure())
      return Promise.reject(new Error(`unexpected request: ${String(input)}`))
    })
    const service = createService(fetcher as typeof fetch)

    const completed = await settleWithin(service.run(['form-contact-publish'], {
      environmentId: 'env-testing',
      siteBaseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: false,
      variables: {},
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: {},
    }))

    expect(completed[0]).toMatchObject({
      status: 'partial',
      lastRunResult: {
        continuePipeline: true,
        error: '脚本已执行完成，共有 1 条断言失败',
      },
    })
    expect(fetcher.mock.calls.some(([input]) => String(input).includes('/runs/'))).toBe(true)
  })

  it('keeps polling after a failed POST once the Runner reports the run as active', async () => {
    let liveRequestCount = 0
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/runs') && init?.method === 'POST') {
        return Promise.reject(new TypeError('POST connection closed after dispatch'))
      }
      if (String(input).includes('/runs/')) {
        liveRequestCount += 1
        if (liveRequestCount < 3) {
          return Promise.resolve(new Response(JSON.stringify({
            status: 'running',
            durationMs: liveRequestCount * 500,
            logs: [],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        }
        return Promise.resolve(terminalAssertionFailure())
      }
      return Promise.reject(new Error(`unexpected request: ${String(input)}`))
    })
    const service = createService(fetcher as typeof fetch)

    const completed = await settleWithin(service.run(['form-contact-publish'], {
      environmentId: 'env-testing',
      siteBaseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: false,
      variables: {},
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: {},
    }))

    expect(liveRequestCount).toBe(3)
    expect(completed[0]).toMatchObject({
      status: 'partial',
      lastRunResult: { continuePipeline: true },
    })
  })

  it('bounds POST recovery when the Runner never registers the run', async () => {
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/runs') && init?.method === 'POST') {
        return Promise.reject(new TypeError('Runner unavailable'))
      }
      return Promise.resolve(new Response(JSON.stringify({
        ok: false,
        error: '运行任务不存在或已过期',
      }), { status: 404, headers: { 'Content-Type': 'application/json' } }))
    })
    const service = createService(fetcher as typeof fetch, 1, 5_000, {
      liveRequestTimeoutMs: 5,
      runRegistrationGraceMs: 15,
    })

    const completed = await settleWithin(service.run(['form-contact-publish'], {
      environmentId: 'env-testing',
      siteBaseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: false,
      variables: {},
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: {},
    }))

    expect(completed[0]).toMatchObject({
      status: 'failed',
      lastRunResult: { error: expect.stringContaining('无法连接本地 Playwright Runner') },
    })
  })

  it('does not wait for a hanging live response body after the POST result arrives', async () => {
    const postResponse = deferred<Response>()
    const hangingLiveResponse = terminalAssertionFailure()
    vi.spyOn(hangingLiveResponse, 'json').mockImplementation(() => new Promise<never>(() => undefined))
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/runs') && init?.method === 'POST') return postResponse.promise
      if (String(input).includes('/runs/')) return Promise.resolve(hangingLiveResponse)
      return Promise.reject(new Error(`unexpected request: ${String(input)}`))
    })
    const service = createService(fetcher as typeof fetch)
    const runTask = service.run(['form-contact-publish'], {
      environmentId: 'env-testing',
      siteBaseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: false,
      variables: {},
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: {},
    })

    await new Promise((resolve) => globalThis.setTimeout(resolve, 10))
    postResponse.resolve(terminalAssertionFailure())
    const completed = await settleWithin(runTask)

    expect(completed[0]).toMatchObject({
      status: 'partial',
      lastRunResult: { continuePipeline: true },
    })
  })

  it('throttles repeated running snapshots while always reporting the terminal state', async () => {
    const postResponse = deferred<Response>()
    const fivePollsObserved = deferred<void>()
    let pollCount = 0
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/runs') && init?.method === 'POST') return postResponse.promise
      if (String(input).includes('/runs/')) {
        pollCount += 1
        if (pollCount === 5) fivePollsObserved.resolve()
        return Promise.resolve(new Response(JSON.stringify({
          status: 'running',
          durationMs: pollCount * 100,
          logs: [],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      return Promise.reject(new Error(`unexpected request: ${String(input)}`))
    })
    const progressStatuses: string[] = []
    const service = createService(fetcher as typeof fetch, 1, 5_000, {
      liveProgressIntervalMs: 10_000,
    })
    const runTask = service.run(['form-contact-publish'], {
      environmentId: 'env-testing',
      siteBaseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: false,
      variables: {},
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: {},
    }, (script) => {
      progressStatuses.push(script.status)
    })

    await settleWithin(fivePollsObserved.promise)
    postResponse.resolve(new Response(JSON.stringify({
      ok: true,
      durationMs: 600,
      logs: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await settleWithin(runTask)

    expect(pollCount).toBeGreaterThanOrEqual(5)
    expect(progressStatuses).toEqual(['running', 'running', 'passed'])
  })

  it('does not let a never-settling progress callback block the terminal result', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/runs') && init?.method === 'POST') return terminalAssertionFailure()
      throw new Error(`unexpected request: ${String(input)}`)
    })
    const onProgress = vi.fn(() => new Promise<void>(() => undefined))
    const service = createService(fetcher as typeof fetch, 1, 5_000, {
      progressNotificationTimeoutMs: 10,
    })

    const completed = await settleWithin(service.run(['form-contact-publish'], {
      environmentId: 'env-testing',
      siteBaseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: false,
      variables: {},
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: {},
    }, onProgress))

    expect(onProgress).toHaveBeenCalled()
    expect(completed[0]).toMatchObject({
      status: 'partial',
      lastRunResult: {
        ok: false,
        continuePipeline: true,
        error: '脚本已执行完成，共有 1 条断言失败',
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
    const service = createService(fetcher as typeof fetch)

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
    const service = createService(fetcher as typeof fetch)
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
      context: { requestPath: '/form/?id=configured' },
    })
    expect(requestBody).not.toHaveProperty('timeoutMs')
  })

  it('resolves the multilingual translation form ID and passes its scoped defaults to the runner', async () => {
    let requestBody: {
      scriptId: string
      context: { requestPath?: string; variables: Record<string, string> }
    } | undefined
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/runs') && init?.method === 'POST') {
        requestBody = JSON.parse(String(init.body)) as typeof requestBody
      }
      return new Response(JSON.stringify({
        ok: true,
        durationMs: 100,
        logs: [],
        result: { published: true },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    const service = createService(fetcher as typeof fetch)

    await service.run(['form-multilingual-translation-publish'], {
      environmentId: 'env-testing',
      siteBaseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: false,
      variables: { FORM_ID: 'dynamic-form-id', AUTH_TOKEN: 'runtime-token' },
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: { Authorization: 'Bearer runtime-token' },
    })

    expect(requestBody).toMatchObject({
      scriptId: 'form-multilingual-translation-publish',
      context: {
        requestPath: '/form-activity/translation?id=dynamic-form-id',
        variables: {
          FORM_ID: 'dynamic-form-id',
          AI_TRANSLATION_TIMEOUT_MS: '120000',
          TRANSLATION_EXPECTATIONS: '{}',
          AUTH_TOKEN: 'runtime-token',
        },
      },
    })
    expect(requestBody).not.toHaveProperty('timeoutMs')
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
              formContract: { formId: 'dynamic-123', fieldKeys: { username: 'username_dynamic' } },
              status: 'published',
            }
          : { submissionId: 'submission-1', status: 'submitted' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    const service = createService(fetcher as typeof fetch)
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
        requestPath: '/form/?id=dynamic-123',
        variables: {
          FORM_ID: 'dynamic-123',
          FORM_CONTRACT: '{"formId":"dynamic-123","fieldKeys":{"username":"username_dynamic"}}',
        },
      },
    })
    expect(requests[1]?.context.variables).not.toHaveProperty('FORM_CODE')
    expect(completed[0]?.lastRunResult?.logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: 'success', message: '已从运行结果提取 2 个变量' }),
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
    const service = createService(fetcher as typeof fetch)

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

  it('stops every local script in an execution through the execution cancellation endpoint', async () => {
    const runStarted = deferred<void>()
    let activeRunId = ''
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === 'http://127.0.0.1:4310/runs') {
        const request = JSON.parse(String(init?.body)) as { runId: string; executionId: string }
        activeRunId = request.runId
        expect(request.executionId).toBe('execution-001')
        runStarted.resolve()
        return new Promise<Response>(() => undefined)
      }
      if (url === 'http://127.0.0.1:4310/executions/execution-001/cancel') {
        return new Response(JSON.stringify({
          ok: true,
          status: 'interrupted',
          executionId: 'execution-001',
          pendingRegistration: true,
          cancelledRunIds: [activeRunId],
          cleanupTimedOutRunIds: [activeRunId],
          runs: [],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url === `http://127.0.0.1:4310/runs/${activeRunId}`) {
        return new Response(JSON.stringify({
          status: 'running',
          ok: false,
          durationMs: 100,
          logs: [],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      throw new Error(`unexpected runner request: ${url}`)
    })
    const service = createService(fetcher as typeof fetch, 50)
    const runTask = service.run(['form-contact-publish', 'form-all-fields-publish'], {
      environmentId: 'env-testing',
      executionId: 'execution-001',
      siteBaseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: false,
      variables: {},
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: {},
    })
    await settleWithin(runStarted.promise)

    await expect(service.stopExecution('execution-001')).resolves.toEqual({
      runnerFound: true,
      cancelledRunIds: [activeRunId],
      cleanupTimedOutRunIds: [activeRunId],
    })
    await expect(settleWithin(runTask)).resolves.toEqual([
      expect.objectContaining({ id: 'form-contact-publish', status: 'interrupted' }),
      expect.objectContaining({ id: 'form-all-fields-publish', status: 'interrupted' }),
    ])

    const runRequests = fetcher.mock.calls.filter(([input, init]) => (
      String(input) === 'http://127.0.0.1:4310/runs' && init?.method === 'POST'
    ))
    expect(runRequests).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:4310/executions/execution-001/cancel',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('reports an execution cancellation HTTP error from the Runner', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      error: 'Runner 批次停止失败',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } }))
    const service = createService(fetcher as typeof fetch)

    await expect(service.stopExecution('execution-001')).rejects.toThrow('Runner 批次停止失败')
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:4310/executions/execution-001/cancel',
      expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
    )
  })

  it('times out a hanging execution cancellation request', async () => {
    let requestSignal: AbortSignal | undefined
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined
      return new Promise<Response>(() => undefined)
    })
    const service = createService(fetcher as typeof fetch, 1, 10)

    await expect(service.stopExecution('execution-001')).rejects.toThrow(
      'Runner 批次停止请求超时（10ms），请确认 Runner 服务正常后重试',
    )
    expect(requestSignal?.aborted).toBe(true)
  })

  it('keeps a Runner interrupted response as a cancelled script result', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      status: 'interrupted',
      cancelled: true,
      durationMs: 450,
      logs: [{
        timestamp: '2026-09-04T08:00:00.000Z',
        level: 'warning',
        message: '用户已从运行记录强制停止运行批次',
      }],
      error: '用户已从运行记录强制停止运行批次',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const service = createService(fetcher as typeof fetch)

    const completed = await service.run(['form-contact-publish'], {
      environmentId: 'env-testing',
      executionId: 'execution-001',
      siteBaseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: false,
      variables: {},
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: {},
    })

    expect(completed[0]).toMatchObject({
      id: 'form-contact-publish',
      status: 'interrupted',
      lastRunResult: {
        ok: false,
        cancelled: true,
        durationMs: 450,
        error: '用户已从运行记录强制停止运行批次',
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
    const service = createService(fetcher as typeof fetch)
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

    const completed = await settleWithin(runTask)
    resolveRun?.(new Response(JSON.stringify({
      ok: true,
      durationMs: 450,
      logs: [{ timestamp: '2026-08-14T10:00:00.000Z', level: 'success', message: '晚到的成功结果' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await Promise.resolve()

    expect(completed[0]).toMatchObject({
      status: 'interrupted',
      lastRunResult: { ok: false, cancelled: true },
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

  it('reconciles an interrupted run when cancellation succeeds but its response body times out', async () => {
    const runStarted = deferred<void>()
    let activeRunId = ''
    let cancellationCommitted = false
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === 'http://127.0.0.1:4310/runs') {
        activeRunId = JSON.parse(String(init?.body)).runId
        runStarted.resolve()
        return new Promise<Response>(() => {})
      }
      if (url === `http://127.0.0.1:4310/runs/${activeRunId}/cancel`) {
        cancellationCommitted = true
        const response = new Response(JSON.stringify({
          ok: true,
          cancelledRunIds: [activeRunId],
          runs: [],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        vi.spyOn(response, 'json').mockImplementation(() => new Promise<never>(() => undefined))
        return response
      }
      if (url === `http://127.0.0.1:4310/runs/${activeRunId}`) {
        return new Response(JSON.stringify(cancellationCommitted
          ? {
              status: 'interrupted',
              ok: false,
              cancelled: true,
              durationMs: 450,
              error: '用户强制停止运行',
              logs: [],
            }
          : {
              status: 'running',
              ok: false,
              durationMs: 300,
              logs: [],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      throw new Error(`unexpected runner request: ${url}`)
    })
    const service = createService(fetcher as typeof fetch, 50, 10)
    const runTask = service.run(['form-contact-publish'], {
      environmentId: 'env-testing',
      siteBaseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: false,
      variables: {},
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: {},
    })
    await settleWithin(runStarted.promise)

    await expect(settleWithin(service.stop('form-contact-publish'))).resolves.toEqual({
      runnerFound: true,
      cancelledRunIds: [activeRunId],
    })
    await expect(settleWithin(runTask)).resolves.toEqual([
      expect.objectContaining({
        id: 'form-contact-publish',
        status: 'interrupted',
        lastRunResult: expect.objectContaining({ cancelled: true }),
      }),
    ])
  })

  it('settles locally when the Runner reserves cancellation before registering the run', async () => {
    const runStarted = deferred<void>()
    let activeRunId = ''
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === 'http://127.0.0.1:4310/runs') {
        activeRunId = JSON.parse(String(init?.body)).runId
        runStarted.resolve()
        return new Promise<Response>(() => {})
      }
      if (url === `http://127.0.0.1:4310/runs/${activeRunId}/cancel`) {
        return new Response(JSON.stringify({
          ok: true,
          status: 'interrupted',
          pendingRegistration: true,
          cancelledRunIds: [activeRunId],
          runs: [],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      throw new Error(`unexpected runner request: ${url}`)
    })
    const service = createService(fetcher as typeof fetch, 50)
    const runTask = service.run(['form-contact-publish'], {
      environmentId: 'env-testing',
      siteBaseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: false,
      variables: {},
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: {},
    })
    await settleWithin(runStarted.promise)

    await expect(settleWithin(service.stop('form-contact-publish'))).resolves.toEqual({
      runnerFound: true,
      cancelledRunIds: [activeRunId],
    })
    await expect(settleWithin(runTask)).resolves.toEqual([
      expect.objectContaining({ id: 'form-contact-publish', status: 'interrupted' }),
    ])
    expect(fetcher).toHaveBeenCalledWith(
      `http://127.0.0.1:4310/runs/${activeRunId}/cancel`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reserveIfMissing: true }),
      }),
    )
  })

  it('treats an already-interrupted exact run as an idempotent cancellation success', async () => {
    const runStarted = deferred<void>()
    let activeRunId = ''
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === 'http://127.0.0.1:4310/runs') {
        activeRunId = JSON.parse(String(init?.body)).runId
        runStarted.resolve()
        return new Promise<Response>(() => {})
      }
      if (url === `http://127.0.0.1:4310/runs/${activeRunId}/cancel`) {
        return new Response(JSON.stringify({
          ok: false,
          error: '运行任务已结束，无法强制停止',
          run: {
            runId: activeRunId,
            status: 'interrupted',
            ok: false,
            cancelled: true,
            durationMs: 450,
            logs: [],
          },
        }), { status: 409, headers: { 'Content-Type': 'application/json' } })
      }
      throw new Error(`unexpected runner request: ${url}`)
    })
    const service = createService(fetcher as typeof fetch, 50)
    const runTask = service.run(['form-contact-publish'], {
      environmentId: 'env-testing',
      siteBaseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: false,
      variables: {},
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: {},
    })
    await settleWithin(runStarted.promise)

    await expect(settleWithin(service.stop('form-contact-publish'))).resolves.toEqual({
      runnerFound: true,
      cancelledRunIds: [activeRunId],
    })
    await expect(settleWithin(runTask)).resolves.toEqual([
      expect.objectContaining({ id: 'form-contact-publish', status: 'interrupted' }),
    ])
  })

  it('does not report success when an older Runner cannot reserve an active-run cancellation', async () => {
    const runStarted = deferred<void>()
    const runResponse = deferred<Response>()
    let activeRunId = ''
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === 'http://127.0.0.1:4310/runs') {
        activeRunId = JSON.parse(String(init?.body)).runId
        runStarted.resolve()
        return runResponse.promise
      }
      if (url === `http://127.0.0.1:4310/runs/${activeRunId}/cancel`) {
        return new Response(JSON.stringify({ error: '运行任务不存在或已过期' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`unexpected runner request: ${url}`)
    })
    const service = createService(fetcher as typeof fetch, 50)
    const runTask = service.run(['form-contact-publish'], {
      environmentId: 'env-testing',
      siteBaseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: false,
      variables: {},
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: {},
    })
    await settleWithin(runStarted.promise)

    await expect(settleWithin(service.stop('form-contact-publish'))).rejects.toThrow(
      'Runner 未确认强制停止',
    )
    expect((await service.list()).find((script) => script.id === 'form-contact-publish')?.status).toBe('running')

    runResponse.resolve(new Response(JSON.stringify({
      ok: true,
      durationMs: 450,
      logs: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await expect(settleWithin(runTask)).resolves.toEqual([
      expect.objectContaining({ id: 'form-contact-publish', status: 'passed' }),
    ])
  })

  it('keeps a natural success when an unconfirmed cancellation request times out', async () => {
    const runStarted = deferred<void>()
    const cancellationStarted = deferred<void>()
    const runResponse = deferred<Response>()
    let activeRunId = ''
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === 'http://127.0.0.1:4310/runs') {
        activeRunId = JSON.parse(String(init?.body)).runId
        runStarted.resolve()
        return runResponse.promise
      }
      if (url === `http://127.0.0.1:4310/runs/${activeRunId}/cancel`) {
        cancellationStarted.resolve()
        return new Promise<Response>(() => {})
      }
      if (url === `http://127.0.0.1:4310/runs/${activeRunId}`) {
        return new Response(JSON.stringify({
          status: 'passed',
          ok: true,
          durationMs: 450,
          logs: [],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      throw new Error(`unexpected runner request: ${url}`)
    })
    const service = createService(fetcher as typeof fetch, 50, 10)
    const runTask = service.run(['form-contact-publish'], {
      environmentId: 'env-testing',
      siteBaseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: false,
      variables: {},
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: {},
    })
    await settleWithin(runStarted.promise)
    const stopTask = service.stop('form-contact-publish')
    await settleWithin(cancellationStarted.promise)
    runResponse.resolve(new Response(JSON.stringify({
      ok: true,
      durationMs: 450,
      logs: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(settleWithin(runTask)).resolves.toEqual([
      expect.objectContaining({ id: 'form-contact-publish', status: 'passed' }),
    ])
    await expect(settleWithin(stopTask)).rejects.toThrow(
      'Runner 强制停止请求超时（10ms），请确认 Runner 服务正常后重试',
    )
    expect((await service.list()).find((script) => script.id === 'form-contact-publish')?.status).toBe('passed')
  })

  it('keeps a natural success when the concurrent cancellation request fails', async () => {
    const runStarted = deferred<void>()
    const cancellationStarted = deferred<void>()
    const runResponse = deferred<Response>()
    const cancellationResponse = deferred<Response>()
    let activeRunId = ''
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === 'http://127.0.0.1:4310/runs') {
        activeRunId = JSON.parse(String(init?.body)).runId
        runStarted.resolve()
        return runResponse.promise
      }
      if (url === `http://127.0.0.1:4310/runs/${activeRunId}/cancel`) {
        cancellationStarted.resolve()
        return cancellationResponse.promise
      }
      throw new Error(`unexpected runner request: ${url}`)
    })
    const service = createService(fetcher as typeof fetch, 50)
    const runTask = service.run(['form-contact-publish'], {
      environmentId: 'env-testing',
      siteBaseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: false,
      variables: {},
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: {},
    })
    await settleWithin(runStarted.promise)
    const stopTask = service.stop('form-contact-publish')
    await settleWithin(cancellationStarted.promise)
    runResponse.resolve(new Response(JSON.stringify({
      ok: true,
      durationMs: 450,
      logs: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await settleWithin(runTask)
    cancellationResponse.resolve(new Response(JSON.stringify({ error: 'Runner 内部错误' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(settleWithin(stopTask)).rejects.toThrow('Runner 内部错误')
    expect((await service.list()).find((script) => script.id === 'form-contact-publish')?.status).toBe('passed')
  })

  it('keeps the terminal execution active until its final progress update settles', async () => {
    const terminalProgressStarted = deferred<void>()
    const releaseTerminalProgress = deferred<void>()
    let activeRunId = ''
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === 'http://127.0.0.1:4310/runs') {
        activeRunId = JSON.parse(String(init?.body)).runId
        return new Response(JSON.stringify({
          ok: true,
          durationMs: 450,
          logs: [],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url === `http://127.0.0.1:4310/runs/${activeRunId}/cancel`) {
        return new Response(JSON.stringify({ error: '运行任务已结束，无法强制停止' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`unexpected runner request: ${url}`)
    })
    const service = createService(fetcher as typeof fetch)
    const runTask = service.run(['form-contact-publish'], {
      environmentId: 'env-testing',
      siteBaseUrl: 'https://lx.admin.lingxi.tech/',
      apiBaseUrl: 'https://lx.admin.lingxi.tech/api',
      ignoreHTTPSErrors: false,
      variables: {},
      authorizationOrigin: 'https://lx.admin.lingxi.tech',
      extraHTTPHeaders: {},
    }, (script) => {
      if (script.status !== 'passed') return
      terminalProgressStarted.resolve()
      return releaseTerminalProgress.promise
    })
    await settleWithin(terminalProgressStarted.promise)

    await expect(settleWithin(service.stop('form-contact-publish'))).rejects.toThrow(
      '运行任务已结束，无法强制停止',
    )
    expect((await service.list()).find((script) => script.id === 'form-contact-publish')?.status).toBe('passed')

    releaseTerminalProgress.resolve()
    await expect(settleWithin(runTask)).resolves.toEqual([
      expect.objectContaining({ id: 'form-contact-publish', status: 'passed' }),
    ])
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
    const service = createService(fetcher as typeof fetch)

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
    const service = createService(fetcher as typeof fetch)

    await expect(service.stop('form-all-fields-publish')).rejects.toThrow('接口不存在')
    expect((await service.list()).find((script) => script.id === 'form-all-fields-publish')?.status).toBe('ready')
  })

  it('times out a hanging cancellation request and keeps the local state unchanged', async () => {
    let requestSignal: AbortSignal | undefined
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined
      return new Promise<Response>(() => {})
    })
    const service = createService(fetcher as typeof fetch, 1, 10)

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
    const service = createService(fetcher as typeof fetch)

    await expect(service.stop('form-all-fields-publish')).rejects.toThrow('Runner 内部错误')
    expect((await service.list()).find((script) => script.id === 'form-all-fields-publish')?.status).toBe('ready')
  })
})
