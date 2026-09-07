import { describe, expect, it, vi } from 'vitest'

import type { AutomationPipeline } from '@/domain/automation-pipeline'
import type { EnvironmentLoginResult } from '@/domain/environment-login'
import type { TestEnvironment } from '@/domain/environment'
import type {
  AutomationScript,
  ScriptResponseVariableBinding,
  ScriptRunContext,
  ScriptRunResult,
} from '@/domain/script'
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
      requestBody: '{"mobile":"13000000000","verify_code":"123456"}',
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

function script(
  id: string,
  result?: ScriptRunResult,
  responseVariableBindings: ScriptResponseVariableBinding[] = [],
): AutomationScript {
  return {
    id,
    name: id,
    description: '',
    directory: 'D:\\tests',
    entryFile: `${id}.spec.ts`,
    responseVariableBindings: structuredClone(responseVariableBindings),
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

const formArtifact = {
  executionId: 'run-record-0001',
  stepId: 'create',
  attemptId: 'runner-run-0001',
  absolutePath: '/workspace/outputs/artifacts/run-record-0001/create/runner-run-0001/form.json',
  relativePath: 'form.json',
  type: 'fixture',
  mimeType: 'application/json',
  sizeBytes: 256,
  createdAt: '2026-08-12T10:00:01.000Z',
}

function failed(message: string): ScriptRunResult {
  return {
    ok: false,
    durationMs: 50,
    logs: [{ timestamp: '2026-08-12T10:00:02.000Z', level: 'error', message }],
    error: message,
  }
}

type ScriptExecutionOutcome = ScriptRunResult | Error

function cancelled(): ScriptRunResult {
  return {
    ok: false,
    cancelled: true,
    durationMs: 25,
    logs: [{ timestamp: '2026-08-12T10:00:02.000Z', level: 'warning', message: 'cancelled' }],
    error: '脚本已由用户强制停止',
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
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
        parameterMappings: [
          { sourceScriptId: 'create', sourcePath: 'data.form.code', targetKey: 'FORM_CODE' },
          { sourceScriptId: 'create', sourcePath: 'data.form.contract', targetKey: 'FORM_CONTRACT' },
        ],
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
  results: Record<string, ScriptExecutionOutcome>,
  contexts: Array<{ id: string; context: ScriptRunContext }>,
  responseBindings: Record<string, ScriptResponseVariableBinding[]> = {},
): ScriptService {
  const scripts = ['create', 'publish', 'verify'].map((id) => script(id, undefined, responseBindings[id]))
  return {
    list: vi.fn(async () => structuredClone(scripts)),
    create: vi.fn(async () => { throw new Error('not implemented') }),
    update: vi.fn(async () => { throw new Error('not implemented') }),
    remove: vi.fn(async () => undefined),
    stop: vi.fn(async () => ({ runnerFound: false, cancelledRunIds: [] })),
    stopExecution: vi.fn(async () => ({ runnerFound: false, cancelledRunIds: [] })),
    run: vi.fn(async (ids, context) => {
      const id = ids[0]
      if (!id) throw new Error('missing script id')
      contexts.push({ id, context: structuredClone(context) })
      const result = results[id]
      if (!result) throw new Error(`missing result for ${id}`)
      if (result instanceof Error) throw result
      return [script(id, result, responseBindings[id])]
    }),
  }
}

function executionFixture(
  results: Record<string, ScriptExecutionOutcome>,
  login = loginResult(),
  responseBindings: Record<string, ScriptResponseVariableBinding[]> = {},
) {
  const contexts: Array<{ id: string; context: ScriptRunContext }> = []
  const runtimeVariables = new SessionRuntimeVariableService(new MemoryStorage())
  let id = 0
  const runRecords = new LocalRunRecordService(
    new MemoryStorage(),
    () => new Date(`2026-08-12T10:00:0${Math.min(id, 9)}.000Z`),
    () => `id-${++id}`,
  )
  const scripts = fakeScriptService(results, contexts, responseBindings)
  const environmentLogin = loginService(login)
  const service = new LocalAutomationPipelineExecutionService({
    environments: environmentService(),
    environmentLogin,
    runtimeVariables,
    scripts,
    runRecords,
  })
  return { service, contexts, runtimeVariables, scripts, environmentLogin, runRecords }
}

function seedRuntimeVariable(runtimeVariables: SessionRuntimeVariableService): void {
  runtimeVariables.upsert({
    key: 'STALE_VALUE',
    value: 'remove-after-run',
    secret: false,
    sourceEnvironmentId: 'env-testing',
    sourcePath: 'data.stale',
  })
}

async function startStoredPipelineRecord(fixture: ReturnType<typeof executionFixture>) {
  const target = pipeline()
  const value = environment()
  const record = await fixture.runRecords.start({
    name: `自动化配置 · ${target.name}`,
    environment: {
      id: value.id,
      name: value.name,
      code: value.code,
      apiBaseUrl: value.apiBaseUrl,
    },
    scripts: target.steps.map(({ scriptId }) => {
      const snapshot = script(scriptId)
      return {
        id: snapshot.id,
        name: snapshot.name,
        directory: snapshot.directory,
        entryFile: snapshot.entryFile,
        tags: snapshot.tags,
      }
    }),
  })
  await fixture.runRecords.updateScriptProgress(record.id, {
    scriptId: 'create',
    status: 'passed',
    durationMs: 100,
    logs: [],
    output: { data: { form: { id: '123', code: 'FORM-001', contract: {} } } },
  })
  await fixture.runRecords.updateScriptProgress(record.id, {
    scriptId: 'publish',
    status: 'running',
    durationMs: 50,
    logs: [],
  })
  return (await fixture.runRecords.get(record.id))!
}

describe('LocalAutomationPipelineExecutionService', () => {
  it('logs in once, runs steps in order and injects mapped output variables', async () => {
    const createResult = success({ data: { form: { id: 123, code: 'FORM-001', contract: { fieldKeys: { username: 'username_dynamic' } } } } })
    createResult.artifacts = [formArtifact]
    const fixture = executionFixture({
      create: createResult,
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
    expect(fixture.contexts.every((item) => item.context.executionId === record.id)).toBe(true)
    expect(fixture.contexts[1]?.context.variables).toMatchObject({
      AUTH_TOKEN: 'runtime-token',
      TEAM_ID: '10000',
      FORM_ID: '123',
    })
    expect(fixture.contexts[2]?.context.variables).toMatchObject({
      AUTH_TOKEN: 'runtime-token',
      FORM_CODE: 'FORM-001',
      FORM_CONTRACT: '{"fieldKeys":{"username":"username_dynamic"}}',
    })
    expect(record.scripts[0]?.artifacts).toEqual([formArtifact])
    expect(fixture.runtimeVariables.list()).toEqual([])
  })

  it('persists a running script snapshot before the pipeline step completes', async () => {
    const fixture = executionFixture({
      create: success({ data: { form: { id: 123, code: 'FORM-001', contract: {} } } }),
      publish: success(),
      verify: success(),
    })
    const releaseFirstStep = deferred<void>()
    const progressStored = deferred<void>()
    vi.mocked(fixture.scripts.run).mockImplementation(async (ids, context, onProgress) => {
      const id = ids[0]
      if (!id) throw new Error('missing script id')
      fixture.contexts.push({ id, context: structuredClone(context) })
      const result = id === 'create'
        ? success({ data: { form: { id: 123, code: 'FORM-001', contract: {} } } })
        : success()
      if (id === 'create') {
        const liveScript = script(id)
        liveScript.status = 'running'
        liveScript.lastRunResult = {
          ok: false,
          durationMs: 450,
          logs: [{
            timestamp: '2026-08-12T10:00:00.500Z',
            level: 'info',
            message: '正在执行创建步骤',
          }],
        }
        await onProgress?.(liveScript)
        progressStored.resolve(undefined)
        await releaseFirstStep.promise
      }
      return [script(id, result)]
    })

    const task = fixture.service.run(pipeline())
    await progressStored.promise

    const runningRecord = (await fixture.runRecords.list())[0]
    expect(runningRecord?.status).toBe('running')
    expect(runningRecord?.scripts[0]).toMatchObject({
      id: 'create',
      status: 'running',
      durationMs: 450,
      logs: [{ message: '正在执行创建步骤' }],
    })

    releaseFirstStep.resolve(undefined)
    await expect(task).resolves.toMatchObject({ status: 'passed' })
  })

  it('stores configured response variables and injects them into later pipeline steps', async () => {
    const fixture = executionFixture({
      create: success({ data: { form: { id: 123, code: 'FORM-001', contract: { fieldKeys: { username: 'username_dynamic' } } } } }),
      publish: success({ status: 'published' }),
      verify: success({ visible: true }),
    }, loginResult(), {
      create: [{
        id: 'auto-form-id',
        variableName: 'AUTO_FORM_ID',
        responsePath: 'data.form.id',
        secret: false,
      }],
    })

    await fixture.service.run(pipeline())

    expect(fixture.contexts[1]?.context.variables).toMatchObject({ AUTO_FORM_ID: '123' })
    expect(fixture.contexts[2]?.context.variables).toMatchObject({ AUTO_FORM_ID: '123' })
    expect(fixture.runtimeVariables.list()).toEqual([])
  })

  it('stops after an unmarked failed result and marks remaining scripts as skipped', async () => {
    const fixture = executionFixture({
      create: success({ data: { form: { id: '123', code: 'FORM-001' } } }),
      publish: failed('publish execution failed'),
      verify: success(),
    })

    const record = await fixture.service.run(pipeline())

    expect(fixture.contexts.map((item) => item.id)).toEqual(['create', 'publish'])
    expect(record).toMatchObject({
      status: 'partial',
      counts: { total: 3, passed: 1, failed: 1, skipped: 1 },
      scripts: [
        { id: 'create', status: 'passed' },
        { id: 'publish', status: 'failed', error: 'publish execution failed' },
        { id: 'verify', status: 'skipped', error: '前序步骤失败，未执行' },
      ],
    })
    expect(fixture.runtimeVariables.list()).toEqual([])
  })

  it('records a network assertion failure and continues when Runner explicitly allows it', async () => {
    const fixture = executionFixture({
      create: {
        ...failed('资源加载健康检查失败'),
        continuePipeline: true,
        output: { data: { form: { id: '123', code: 'FORM-001', contract: { version: 1 } } } },
      },
      publish: success({ status: 'published' }),
      verify: success({ visible: true }),
    })

    const record = await fixture.service.run(pipeline())

    expect(fixture.contexts.map((item) => item.id)).toEqual(['create', 'publish', 'verify'])
    expect(fixture.contexts[1]?.context.variables).toMatchObject({ FORM_ID: '123' })
    expect(fixture.contexts[2]?.context.variables).toMatchObject({
      FORM_CODE: 'FORM-001',
      FORM_CONTRACT: '{"version":1}',
    })
    expect(record).toMatchObject({
      status: 'partial',
      counts: { total: 3, passed: 2, failed: 1, skipped: 0 },
      scripts: [
        { id: 'create', status: 'failed', error: '资源加载健康检查失败' },
        { id: 'publish', status: 'passed' },
        { id: 'verify', status: 'passed' },
      ],
    })
  })

  it('records a business assertion failure and continues when Runner explicitly allows it', async () => {
    const fixture = executionFixture({
      create: success({
        data: { form: { id: '123', code: 'FORM-001', contract: { version: 1 } } },
      }),
      publish: {
        ...failed('表单提交业务断言失败'),
        continuePipeline: true,
      },
      verify: success({ visible: true }),
    })

    const record = await fixture.service.run(pipeline())

    expect(fixture.contexts.map((item) => item.id)).toEqual(['create', 'publish', 'verify'])
    expect(record).toMatchObject({
      status: 'partial',
      counts: { total: 3, passed: 2, failed: 1, skipped: 0 },
      scripts: [
        { id: 'create', status: 'passed' },
        { id: 'publish', status: 'failed', error: '表单提交业务断言失败' },
        { id: 'verify', status: 'passed' },
      ],
    })
  })

  it('continues through consecutive assertion failures without skipping the final step', async () => {
    const fixture = executionFixture({
      create: {
        ...failed('创建步骤业务断言失败'),
        continuePipeline: true,
        output: {
          data: { form: { id: '123', code: 'FORM-001', contract: { version: 1 } } },
        },
      },
      publish: {
        ...failed('发布步骤接口断言失败'),
        continuePipeline: true,
      },
      verify: success({ visible: true }),
    })

    const record = await fixture.service.run(pipeline())

    expect(fixture.contexts.map((item) => item.id)).toEqual(['create', 'publish', 'verify'])
    expect(fixture.contexts[1]?.context.variables).toMatchObject({ FORM_ID: '123' })
    expect(fixture.contexts[2]?.context.variables).toMatchObject({ FORM_CODE: 'FORM-001' })
    expect(record).toMatchObject({
      status: 'partial',
      counts: { total: 3, passed: 1, failed: 2, skipped: 0 },
      scripts: [
        { id: 'create', status: 'failed', error: '创建步骤业务断言失败' },
        { id: 'publish', status: 'failed', error: '发布步骤接口断言失败' },
        { id: 'verify', status: 'passed' },
      ],
    })
  })

  it('stops after a timed-out step even when the Runner also marks it as continuable', async () => {
    const fixture = executionFixture({
      create: {
        ...failed('脚本执行超过 300000 ms，已自动终止'),
        timedOut: true,
        continuePipeline: true,
        output: {
          data: { form: { id: '123', code: 'FORM-001', contract: { version: 1 } } },
        },
      },
      publish: success({ status: 'published' }),
      verify: success({ visible: true }),
    })

    const record = await fixture.service.run(pipeline())

    expect(fixture.contexts.map((item) => item.id)).toEqual(['create'])
    expect(record).toMatchObject({
      status: 'failed',
      counts: { total: 3, passed: 0, failed: 1, skipped: 2 },
      scripts: [
        { id: 'create', status: 'failed', error: '脚本执行超过 300000 ms，已自动终止' },
        { id: 'publish', status: 'skipped' },
        { id: 'verify', status: 'skipped' },
      ],
    })
  })

  it('stops at the next mapped step when a continuable assertion failure omits its required output', async () => {
    const fixture = executionFixture({
      create: {
        ...failed('创建步骤业务断言失败'),
        continuePipeline: true,
        output: { data: { form: {} } },
      },
      publish: success({ status: 'published' }),
      verify: success({ visible: true }),
    })

    const record = await fixture.service.run(pipeline())

    expect(fixture.contexts.map((item) => item.id)).toEqual(['create'])
    expect(record).toMatchObject({
      status: 'failed',
      counts: { total: 3, passed: 0, failed: 2, skipped: 1 },
      scripts: [
        { id: 'create', status: 'failed', error: '创建步骤业务断言失败' },
        { id: 'publish', status: 'failed', error: expect.stringContaining('data.form.id') },
        { id: 'verify', status: 'skipped' },
      ],
    })
  })

  it('clears assertion continuation when applying a response variable throws', async () => {
    const fixture = executionFixture({
      create: {
        ...failed('创建步骤业务断言失败'),
        continuePipeline: true,
        output: { data: { form: { id: '123', code: 'FORM-001', contract: {} } } },
      },
      publish: success({ status: 'published' }),
      verify: success({ visible: true }),
    }, loginResult(), {
      create: [{
        id: 'required-form-id',
        variableName: 'AUTO_FORM_ID',
        responsePath: 'data.form.id',
        secret: false,
      }],
    })
    const upsert = fixture.runtimeVariables.upsert.bind(fixture.runtimeVariables)
    vi.spyOn(fixture.runtimeVariables, 'upsert').mockImplementation((draft) => {
      if (draft.key === 'AUTO_FORM_ID') throw new Error('响应变量配置写入失败')
      return upsert(draft)
    })

    const record = await fixture.service.run(pipeline())

    expect(fixture.contexts.map((item) => item.id)).toEqual(['create'])
    expect(record).toMatchObject({
      status: 'failed',
      counts: { total: 3, passed: 0, failed: 1, skipped: 2 },
      scripts: [
        { id: 'create', status: 'failed', error: '响应变量配置写入失败' },
        { id: 'publish', status: 'skipped' },
        { id: 'verify', status: 'skipped' },
      ],
    })
  })

  it('stops before later steps when a configured response variable path is missing', async () => {
    const fixture = executionFixture({
      create: success({ data: { form: { code: 'FORM-001' } } }),
      publish: success({ status: 'published' }),
      verify: success({ visible: true }),
    }, loginResult(), {
      create: [{
        id: 'required-form-id',
        variableName: 'AUTO_FORM_ID',
        responsePath: 'data.form.id',
        secret: false,
      }],
    })

    const record = await fixture.service.run(pipeline())

    expect(fixture.contexts.map((item) => item.id)).toEqual(['create'])
    expect(record).toMatchObject({
      status: 'failed',
      counts: { total: 3, passed: 0, failed: 1, skipped: 2 },
      scripts: [
        {
          id: 'create',
          status: 'failed',
          error: expect.stringContaining('AUTO_FORM_ID (data.form.id)'),
        },
        { id: 'publish', status: 'skipped' },
        { id: 'verify', status: 'skipped' },
      ],
    })
    expect(fixture.runtimeVariables.get('AUTO_FORM_ID')).toBeNull()
  })

  it('stops after a script execution exception and marks remaining scripts as skipped', async () => {
    const fixture = executionFixture({
      create: success({ data: { form: { id: '123', code: 'FORM-001' } } }),
      publish: new Error('Runner connection closed unexpectedly'),
      verify: success(),
    })

    const record = await fixture.service.run(pipeline())

    expect(fixture.contexts.map((item) => item.id)).toEqual(['create', 'publish'])
    expect(record).toMatchObject({
      status: 'partial',
      counts: { total: 3, passed: 1, failed: 1, skipped: 1 },
      scripts: [
        { id: 'create', status: 'passed' },
        { id: 'publish', status: 'failed', error: 'Runner connection closed unexpectedly' },
        { id: 'verify', status: 'skipped', error: '前序步骤失败，未执行' },
      ],
    })
  })

  it('records a login failure and does not start scripts', async () => {
    const fixture = executionFixture({}, loginResult(false))
    seedRuntimeVariable(fixture.runtimeVariables)

    const record = await fixture.service.run(pipeline())

    expect(fixture.contexts).toEqual([])
    expect(record).toMatchObject({
      status: 'failed',
      failureStage: 'login',
      counts: { total: 3, passed: 0, failed: 0, skipped: 3 },
    })
    expect(fixture.runtimeVariables.list()).toEqual([])
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

  it('locks a pipeline immediately, rejects duplicate starts and unlocks after completion', async () => {
    const fixture = executionFixture({
      create: success({ data: { form: { id: 123, code: 'FORM-001', contract: {} } } }),
      publish: success(),
      verify: success(),
    })
    const target = pipeline()

    const task = fixture.service.run(target)

    expect(fixture.service.isRunning(target.id)).toBe(true)
    expect(() => fixture.service.run(target)).toThrow('正在运行')
    await task
    expect(fixture.service.isRunning(target.id)).toBe(false)
  })

  it('stops before login when cancellation is requested immediately after start', async () => {
    const fixture = executionFixture({})
    seedRuntimeVariable(fixture.runtimeVariables)
    const target = pipeline()

    const task = fixture.service.run(target)
    const stopResult = await fixture.service.stop(target.id)
    const record = await task

    expect(stopResult).toEqual({ stopped: true, runnerFound: false, cancelledRunIds: [] })
    expect(fixture.environmentLogin.login).not.toHaveBeenCalled()
    expect(fixture.contexts).toEqual([])
    expect(record).toMatchObject({
      status: 'interrupted',
      error: '用户已强制停止自动化配置“表单发布回归”',
      counts: { total: 3, passed: 0, failed: 0, skipped: 3 },
    })
    expect(fixture.service.isRunning(target.id)).toBe(false)
    expect(fixture.runtimeVariables.list()).toEqual([])
  })

  it('interrupts a pending login and does not start the first script after login returns', async () => {
    const fixture = executionFixture({})
    const pendingLogin = deferred<EnvironmentLoginResult>()
    vi.mocked(fixture.environmentLogin.login).mockImplementation(() => pendingLogin.promise)
    vi.mocked(fixture.scripts.stopExecution).mockRejectedValue(
      new Error('Runner should not be needed before a script starts'),
    )
    const target = pipeline()

    const task = fixture.service.run(target)
    await vi.waitFor(() => expect(fixture.environmentLogin.login).toHaveBeenCalledOnce())
    const stopResult = await fixture.service.stop(target.id)
    expect((await fixture.runRecords.list())[0]?.status).toBe('interrupted')
    pendingLogin.resolve(loginResult())
    const record = await task

    expect(stopResult).toEqual({ stopped: true, runnerFound: false, cancelledRunIds: [] })
    expect(fixture.scripts.stopExecution).not.toHaveBeenCalled()
    expect(fixture.scripts.stop).not.toHaveBeenCalled()
    expect(fixture.scripts.run).not.toHaveBeenCalled()
    expect(fixture.contexts).toEqual([])
    expect(record.status).toBe('interrupted')
  })

  it('force stops the current script and never starts later pipeline steps', async () => {
    const fixture = executionFixture({
      create: success(),
      publish: success(),
      verify: success(),
    })
    const scriptResult = deferred<ScriptRunResult>()
    vi.mocked(fixture.scripts.run).mockImplementation(async (ids, context) => {
      const id = ids[0]
      if (!id) throw new Error('missing script id')
      fixture.contexts.push({ id, context: structuredClone(context) })
      return [script(id, await scriptResult.promise)]
    })
    vi.mocked(fixture.scripts.stopExecution).mockResolvedValue({
      runnerFound: true,
      cancelledRunIds: ['runner-run-1'],
      cleanupTimedOutRunIds: ['runner-run-1'],
    })
    const target = pipeline()

    const task = fixture.service.run(target)
    await vi.waitFor(() => expect(fixture.contexts.map((item) => item.id)).toEqual(['create']))
    const activeRecord = (await fixture.runRecords.list())[0]!
    const stopResult = await fixture.service.stop(target.id)
    scriptResult.resolve(cancelled())
    const record = await task

    expect(fixture.scripts.stopExecution).toHaveBeenCalledOnce()
    expect(fixture.scripts.stopExecution).toHaveBeenCalledWith(activeRecord.id)
    expect(fixture.scripts.stop).not.toHaveBeenCalled()
    expect(stopResult).toEqual({
      stopped: true,
      runnerFound: true,
      cancelledRunIds: ['runner-run-1'],
      cleanupTimedOutRunIds: ['runner-run-1'],
    })
    expect(fixture.contexts.map((item) => item.id)).toEqual(['create'])
    expect(record).toMatchObject({
      status: 'interrupted',
      scripts: [
        { id: 'create', status: 'skipped' },
        { id: 'publish', status: 'skipped' },
        { id: 'verify', status: 'skipped' },
      ],
    })
    expect(fixture.runtimeVariables.list()).toEqual([])
  })

  it('stops an active pipeline by record id and interrupts only its current script', async () => {
    const fixture = executionFixture({
      create: success(),
      publish: success(),
      verify: success(),
    })
    const pendingScript = deferred<AutomationScript[]>()
    vi.mocked(fixture.scripts.run).mockImplementation(async (ids, context) => {
      const id = ids[0]
      if (!id) throw new Error('missing script id')
      fixture.contexts.push({ id, context: structuredClone(context) })
      return pendingScript.promise
    })
    vi.mocked(fixture.scripts.stopExecution).mockResolvedValue({
      runnerFound: true,
      cancelledRunIds: ['runner-run-active'],
    })
    const interrupt = vi.spyOn(fixture.runRecords, 'interrupt')

    const runTask = fixture.service.run(pipeline())
    await vi.waitFor(() => expect(fixture.contexts.map(({ id }) => id)).toEqual(['create']))
    const activeRecord = (await fixture.runRecords.list())[0]!

    await expect(fixture.service.stopByRecordId(activeRecord.id)).resolves.toEqual({
      stopped: true,
      runnerFound: true,
      cancelledRunIds: ['runner-run-active'],
    })
    pendingScript.resolve([script('create', cancelled())])
    const completed = await runTask

    expect(fixture.scripts.stopExecution).toHaveBeenCalledOnce()
    expect(fixture.scripts.stopExecution).toHaveBeenCalledWith(activeRecord.id)
    expect(fixture.scripts.stop).not.toHaveBeenCalled()
    expect(interrupt).toHaveBeenCalledOnce()
    expect(completed.status).toBe('interrupted')
    expect((await fixture.runRecords.get(activeRecord.id))?.status).toBe('interrupted')
  })

  it('stops a stored execution by record id after an application restart', async () => {
    const fixture = executionFixture({})
    const storedRecord = await startStoredPipelineRecord(fixture)
    vi.mocked(fixture.scripts.stopExecution).mockResolvedValue({
      runnerFound: true,
      cancelledRunIds: ['runner-run-restored'],
      cleanupTimedOutRunIds: ['runner-run-restored'],
    })
    const interrupt = vi.spyOn(fixture.runRecords, 'interrupt')

    await expect(fixture.service.stopByRecordId(storedRecord.id)).resolves.toEqual({
      stopped: true,
      runnerFound: true,
      cancelledRunIds: ['runner-run-restored'],
      cleanupTimedOutRunIds: ['runner-run-restored'],
    })

    expect(fixture.scripts.stopExecution).toHaveBeenCalledOnce()
    expect(fixture.scripts.stopExecution).toHaveBeenCalledWith(storedRecord.id)
    expect(fixture.scripts.stop).not.toHaveBeenCalled()
    expect(interrupt).toHaveBeenCalledOnce()
    expect(interrupt).toHaveBeenCalledWith(
      storedRecord.id,
      `用户已从运行记录强制停止批次 ${storedRecord.displayId}`,
    )
    expect((await fixture.runRecords.get(storedRecord.id))?.status).toBe('interrupted')
  })

  it('keeps a stored record running when its Runner stop request fails', async () => {
    const fixture = executionFixture({})
    const storedRecord = await startStoredPipelineRecord(fixture)
    vi.mocked(fixture.scripts.stopExecution).mockRejectedValue(new Error('fixture stop failure'))
    const interrupt = vi.spyOn(fixture.runRecords, 'interrupt')

    await expect(fixture.service.stopByRecordId(storedRecord.id)).rejects.toThrow(
      'fixture stop failure',
    )

    expect(fixture.scripts.stopExecution).toHaveBeenCalledOnce()
    expect(fixture.scripts.stopExecution).toHaveBeenCalledWith(storedRecord.id)
    expect(fixture.scripts.stop).not.toHaveBeenCalled()
    expect(interrupt).not.toHaveBeenCalled()
    expect((await fixture.runRecords.get(storedRecord.id))?.status).toBe('running')
  })

  it('does not stop scripts for a terminal or missing record', async () => {
    const fixture = executionFixture({})
    const storedRecord = await startStoredPipelineRecord(fixture)
    await fixture.runRecords.interrupt(storedRecord.id, 'fixture completed elsewhere')
    const interrupt = vi.spyOn(fixture.runRecords, 'interrupt')

    const expected = { stopped: false, runnerFound: false, cancelledRunIds: [] }
    await expect(fixture.service.stopByRecordId(storedRecord.id)).resolves.toEqual(expected)
    await expect(fixture.service.stopByRecordId('missing-record')).resolves.toEqual(expected)

    expect(fixture.scripts.stopExecution).not.toHaveBeenCalled()
    expect(fixture.scripts.stop).not.toHaveBeenCalled()
    expect(interrupt).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent stop requests for the same record id', async () => {
    const fixture = executionFixture({})
    const storedRecord = await startStoredPipelineRecord(fixture)
    await fixture.runRecords.updateScriptProgress(storedRecord.id, {
      scriptId: 'verify',
      status: 'passed',
      durationMs: 25,
      logs: [],
    })
    const pendingStop = deferred<{ runnerFound: boolean; cancelledRunIds: string[] }>()
    vi.mocked(fixture.scripts.stopExecution).mockImplementation(() => pendingStop.promise)
    const interrupt = vi.spyOn(fixture.runRecords, 'interrupt')

    const first = fixture.service.stopByRecordId(storedRecord.id)
    const second = fixture.service.stopByRecordId(storedRecord.id)
    expect(second).toBe(first)
    await vi.waitFor(() => expect(fixture.scripts.stopExecution).toHaveBeenCalledOnce())
    pendingStop.resolve({ runnerFound: true, cancelledRunIds: ['runner-run-shared'] })

    await expect(Promise.all([first, second])).resolves.toEqual([
      { stopped: true, runnerFound: true, cancelledRunIds: ['runner-run-shared'] },
      { stopped: true, runnerFound: true, cancelledRunIds: ['runner-run-shared'] },
    ])
    expect(fixture.scripts.stopExecution).toHaveBeenCalledOnce()
    expect(fixture.scripts.stopExecution).toHaveBeenCalledWith(storedRecord.id)
    expect(fixture.scripts.stop).not.toHaveBeenCalled()
    expect(interrupt).toHaveBeenCalledOnce()
  })

  it('reports that an inactive pipeline cannot be stopped', async () => {
    const fixture = executionFixture({})

    await expect(fixture.service.stop('pipeline-1')).resolves.toEqual({
      stopped: false,
      runnerFound: false,
      cancelledRunIds: [],
    })
  })
})
