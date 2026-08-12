import { describe, expect, it, vi } from 'vitest'

import type { AutomationPipeline } from '@/domain/automation-pipeline'
import type { EnvironmentLoginResult } from '@/domain/environment-login'
import type { TestEnvironment } from '@/domain/environment'
import type { AutomationScript, ScriptRunContext, ScriptRunResult } from '@/domain/script'
import type { EnvironmentLoginService } from '@/services/environments/environment-login-service'
import type { EnvironmentService } from '@/services/environments/environment-service'
import { LocalRunRecordService } from '@/services/run-records/local-run-record.service'
import { SessionRuntimeVariableService } from '@/services/runtime-variables/session-runtime-variable.service'
import type { ScriptService } from '@/services/scripts/script-service'
import { LocalAutomationPipelineExecutionService } from './automation-pipeline-execution-service'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

function environment(): TestEnvironment {
  return {
    id: 'env-testing',
    name: '测试环境',
    code: 'TEST',
    description: '',
    baseUrl: 'https://example.test/',
    apiBaseUrl: 'https://example.test/api',
    ignoreHTTPSErrors: true,
    enabled: true,
    active: true,
    auth: {
      mode: 'mobile-code',
      method: 'POST',
      timeoutMs: 15_000,
      loginPath: '/login',
      username: '',
      password: '',
      mobile: '13000000000',
      verifyCode: '123456',
      successPath: 'code',
      successValue: '0',
      tokenPath: 'data.token',
      tokenVariable: 'AUTH_TOKEN',
      tokenTypePath: 'data.token_type',
      tokenTypeFallback: 'Bearer',
    },
    variables: [{
      id: 'team',
      key: 'TEAM_ID',
      value: '10000',
      description: '',
      secret: false,
      enabled: true,
    }],
    updatedAt: '2026-08-12 10:00',
  }
}

function loginResult(success = true): EnvironmentLoginResult {
  return {
    businessSuccess: success,
    ok: success,
    status: success ? 200 : 401,
    statusText: success ? 'OK' : 'Unauthorized',
    targetUrl: 'https://example.test/api/login',
    durationMs: 10,
    receivedAt: '2026-08-12T10:00:00.000Z',
    requestBody: {},
    responseBody: success
      ? { code: 0, data: { token: 'runtime-token', token_type: 'Bearer' } }
      : { code: 401, message: 'invalid code' },
    rawResponse: '',
    responseHeaders: {},
  }
}

function script(id: string, result?: ScriptRunResult): AutomationScript {
  return {
    id,
    name: id,
    description: '',
    directory: 'D:\\tests',
    entryFile: `${id}.spec.ts`,
    tags: [],
    status: result ? (result.ok ? 'passed' : 'failed') : 'ready',
    updatedAt: '2026-08-12 10:00',
    lastRunAt: null,
    lastDuration: null,
    ...(result ? { lastRunResult: result } : {}),
  }
}

function success(output?: Record<string, unknown>): ScriptRunResult {
  return {
    ok: true,
    durationMs: 100,
    logs: [{ timestamp: '2026-08-12T10:00:01.000Z', level: 'success', message: 'passed' }],
    ...(output ? { output } : {}),
  }
}

function failed(message: string): ScriptRunResult {
  return {
    ok: false,
    durationMs: 50,
    logs: [{ timestamp: '2026-08-12T10:00:02.000Z', level: 'error', message }],
    error: message,
  }
}

function pipeline(): AutomationPipeline {
  return {
    id: 'pipeline-1',
    name: '表单发布回归',
    description: '',
    environmentId: 'env-testing',
    steps: [
      { scriptId: 'create', parameterMappings: [] },
      {
        scriptId: 'publish',
        parameterMappings: [{ sourceScriptId: 'create', sourcePath: 'data.form.id', targetKey: 'FORM_ID' }],
      },
      {
        scriptId: 'verify',
        parameterMappings: [{ sourceScriptId: 'create', sourcePath: 'data.form.code', targetKey: 'FORM_CODE' }],
      },
    ],
    createdAt: '2026-08-12T09:00:00.000Z',
    updatedAt: '2026-08-12T09:00:00.000Z',
  }
}

function environmentService(value = environment()): EnvironmentService {
  return {
    list: vi.fn(async () => [structuredClone(value)]),
    getActive: vi.fn(async () => structuredClone(value)),
    create: vi.fn(async () => { throw new Error('not implemented') }),
    update: vi.fn(async () => { throw new Error('not implemented') }),
    remove: vi.fn(async () => undefined),
    setActive: vi.fn(async () => structuredClone(value)),
  }
}

function loginService(result = loginResult()): EnvironmentLoginService {
  return { login: vi.fn(async () => structuredClone(result)) }
}

function fakeScriptService(
  results: Record<string, ScriptRunResult>,
  contexts: Array<{ id: string; context: ScriptRunContext }>,
): ScriptService {
  const scripts = ['create', 'publish', 'verify'].map((id) => script(id))
  return {
    list: vi.fn(async () => structuredClone(scripts)),
    create: vi.fn(async () => { throw new Error('not implemented') }),
    update: vi.fn(async () => { throw new Error('not implemented') }),
    remove: vi.fn(async () => undefined),
    run: vi.fn(async (ids, context) => {
      const id = ids[0]
      if (!id) throw new Error('missing script id')
      contexts.push({ id, context: structuredClone(context) })
      const result = results[id]
      if (!result) throw new Error(`missing result for ${id}`)
      return [script(id, result)]
    }),
  }
}

function executionFixture(results: Record<string, ScriptRunResult>, login = loginResult()) {
  const contexts: Array<{ id: string; context: ScriptRunContext }> = []
  const runtimeVariables = new SessionRuntimeVariableService(new MemoryStorage())
  let id = 0
  const runRecords = new LocalRunRecordService(
    new MemoryStorage(),
    () => new Date(`2026-08-12T10:00:0${Math.min(id, 9)}.000Z`),
    () => `id-${++id}`,
  )
  const service = new LocalAutomationPipelineExecutionService({
    environments: environmentService(),
    environmentLogin: loginService(login),
    runtimeVariables,
    scripts: fakeScriptService(results, contexts),
    runRecords,
  })
  return { service, contexts, runtimeVariables }
}

describe('LocalAutomationPipelineExecutionService', () => {
  it('logs in once, runs steps in order and injects mapped output variables', async () => {
    const fixture = executionFixture({
      create: success({ data: { form: { id: 123, code: 'FORM-001' } } }),
      publish: success({ status: 'published' }),
      verify: success({ visible: true }),
    })

    const record = await fixture.service.run(pipeline())

    expect(record).toMatchObject({
      name: '自动化配置 · 表单发布回归',
      status: 'passed',
      counts: { total: 3, passed: 3, failed: 0, skipped: 0 },
    })
    expect(fixture.contexts.map((item) => item.id)).toEqual(['create', 'publish', 'verify'])
    expect(fixture.contexts[1]?.context.variables).toMatchObject({
      AUTH_TOKEN: 'runtime-token',
      TEAM_ID: '10000',
      FORM_ID: '123',
    })
    expect(fixture.contexts[2]?.context.variables).toMatchObject({
      AUTH_TOKEN: 'runtime-token',
      FORM_CODE: 'FORM-001',
    })
    expect(fixture.runtimeVariables.get('FORM_ID')).toBeNull()
    expect(fixture.runtimeVariables.get('FORM_CODE')).toBeNull()
  })

  it('stops after a failed step and marks remaining scripts as skipped', async () => {
    const fixture = executionFixture({
      create: success({ data: { form: { id: '123', code: 'FORM-001' } } }),
      publish: failed('publish assertion failed'),
      verify: success(),
    })

    const record = await fixture.service.run(pipeline())

    expect(fixture.contexts.map((item) => item.id)).toEqual(['create', 'publish'])
    expect(record).toMatchObject({
      status: 'partial',
      counts: { total: 3, passed: 1, failed: 1, skipped: 1 },
      scripts: [
        { id: 'create', status: 'passed' },
        { id: 'publish', status: 'failed', error: 'publish assertion failed' },
        { id: 'verify', status: 'skipped', error: '前序步骤失败，未执行' },
      ],
    })
  })

  it('records a login failure and does not start scripts', async () => {
    const fixture = executionFixture({}, loginResult(false))

    const record = await fixture.service.run(pipeline())

    expect(fixture.contexts).toEqual([])
    expect(record).toMatchObject({
      status: 'failed',
      failureStage: 'login',
      counts: { total: 3, passed: 0, failed: 0, skipped: 3 },
    })
  })

  it('fails the target step when a mapped output path cannot be resolved', async () => {
    const fixture = executionFixture({
      create: success({ data: { form: {} } }),
      publish: success(),
      verify: success(),
    })

    const record = await fixture.service.run(pipeline())

    expect(fixture.contexts.map((item) => item.id)).toEqual(['create'])
    expect(record.scripts).toMatchObject([
      { id: 'create', status: 'passed' },
      { id: 'publish', status: 'failed', error: expect.stringContaining('data.form.id') },
      { id: 'verify', status: 'skipped' },
    ])
  })
})
