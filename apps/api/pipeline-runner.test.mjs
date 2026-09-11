import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { PipelineRunner } from './pipeline-runner.mjs'
import { RunRecordFileStore } from './run-record-store.mjs'
import { createRunnerServer } from './server.mjs'

const success = (result = {}, status = 'passed') => ({ ok: status === 'passed', status, durationMs: 12, logs: [], result })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const input = (id = 'pipeline-run-0001') => ({ executionId: id,
  pipeline: { id: 'pipeline-1', name: '本地模拟流水线', steps: [
    { scriptId: 'first', parameterMappings: [] },
    { scriptId: 'second', parameterMappings: [{ sourceScriptId: 'first', sourcePath: 'formId', targetKey: 'FORM_ID' }] },
    { scriptId: 'third', parameterMappings: [] },
  ] },
  environment: { id: 'env-test', name: '本地模拟', code: 'TEST', enabled: true,
    baseUrl: 'http://127.0.0.1:1', apiBaseUrl: 'http://127.0.0.1:1/api',
    variables: [{ key: 'ORDER', value: 'environment', enabled: true }],
    auth: { method: 'POST', loginPath: '/login', requestBody: '{}', timeoutMs: 100,
      tokenVariable: 'AUTH_TOKEN', tokenPath: 'data.token', tokenTypePath: '', successPath: 'code', successValue: '0' } },
})
const configList = () => ['first', 'second', 'third'].map(id => ({ id, name: id, directory: 'scripts', entryFile: `${id}.mjs`,
  enabled: true, inputParameters: [{ key: 'ORDER', value: 'default' }], responseVariableBindings: [],
  ...(id === 'second' ? { requestPath: '/form?id={{FORM_ID}}' } : {}) }))
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'autotest-pipeline-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const records = new RunRecordFileStore({ directory })
  const configs = configList()
  const calls = []
  const runner = new PipelineRunner({ records, configs: { get: async id => configs.find(config => config.id === id) },
    login: async () => ({ token: 'fixture-token-123', scheme: 'Bearer' }),
    executeStep: async (payload, signal) => { calls.push(payload); return success({ formId: 'new-form' }) }, ...options })
  records.setRunnerActivityProvider(() => runner.list().map(item => ({ executionId: item.id, settled: false })))
  return { runner, records, configs, calls, directory }
}
async function finish(runner, records, data = input()) {
  const submitted = await runner.start(data)
  await runner.active.get(data.executionId)?.completion
  return { submitted, record: await records.get(data.executionId) }
}

test('Runner authenticates once, executes all steps with output mappings and input precedence', async t => {
  let logins = 0
  const { runner, records, calls, configs, directory } = await fixture(t, { login: async () => { logins++; return { token: 'fixture-token-123', scheme: 'Bearer' } } })
  configs[0].responseVariableBindings = [{ variableName: 'BOUND', responsePath: 'formId', secret: false }]
  const data = input(); data.runtimeVariables = [{ key: 'ORDER', value: 'runtime' }]
  const { record, submitted } = await finish(runner, records, data)
  assert.equal(submitted.accepted, true); assert.equal(logins, 1)
  assert.deepEqual(calls.map(call => call.scriptId), ['first', 'second', 'third'])
  assert.equal(calls[1].context.variables.FORM_ID, 'new-form')
  assert.equal(calls[1].context.variables.BOUND, 'new-form')
  assert.equal(calls[1].context.variables.ORDER, 'runtime')
  assert.equal(calls[1].context.requestPath, '/form?id=new-form')
  assert.equal(calls[2].context.environmentId, 'env-test')
  assert.equal(record.status, 'passed'); assert.equal(record.counts.passed, 3)
  assert.equal(runner.list().length, 0)
  const disk = await readFile(join(directory, `${record.id}.json`), 'utf8')
  assert.ok(!disk.includes('fixture-token-123')); assert.ok(!disk.includes('requestBody'))
  const replay = await runner.start(data)
  assert.equal(replay.accepted, false); assert.equal(calls.length, 3)
  data.pipeline.name = 'other'
  await assert.rejects(runner.start(data), { statusCode: 409 })
  await assert.rejects(records.update(record.id, { ...record, revision: record.revision + 1 }, { expectedRevision: record.revision, expectedUpdatedAt: record.updatedAt }), /Runner 管理/)
})

for (const status of ['partial', 'failed', 'timeout', 'throw', 'legacy-partial']) {
  test(`pipeline ${status} preserves evidence and applies continuation rules`, async t => {
    let calls = 0
    const { runner, records } = await fixture(t, { executeStep: async () => {
      calls++
      if (calls !== 1) return success()
      if (status === 'throw') throw new Error('fixture execution crashed')
      const result = success({ formId: 'new-form' }, status === 'partial' ? 'partial' : status === 'failed' ? 'failed' : 'passed')
      result.apiResponses = []
      if (status === 'timeout') result.timedOut = true
      if (status === 'legacy-partial') { delete result.status; result.ok = false; result.continuePipeline = true }
      return result
    } })
    const { record } = await finish(runner, records)
    const partial = ['partial', 'legacy-partial'].includes(status)
    assert.equal(calls, partial ? 3 : 1)
    assert.equal(record.status, partial ? 'partial' : 'failed')
    assert.equal(record.counts.partial, partial ? 1 : 0)
    assert.equal(record.counts.skipped, partial ? 0 : 2)
  })
}

test('missing binding fails current step while retaining output and redacting later secret bindings', async t => {
  const hidden = 'secret-binding-98765'
  const { runner, records, configs, directory } = await fixture(t, { executeStep: async () => ({ ...success({ value: hidden }), logs: [{ timestamp: new Date().toISOString(), level: 'info', message: `got ${hidden}` }] }) })
  configs[0].responseVariableBindings = [
    { variableName: 'MISSING', responsePath: 'missing' }, { variableName: 'CUSTOM', responsePath: 'value', secret: true },
  ]
  const { record } = await finish(runner, records)
  assert.equal(record.status, 'failed'); assert.equal(record.counts.skipped, 2)
  assert.match(record.scripts[0].error, /MISSING/)
  assert.equal(record.scripts[0].output.value, '[REDACTED]')
  assert.ok(!(await readFile(join(directory, `${record.id}.json`), 'utf8')).includes(hidden))
})

test('missing parameter path stops before the dependent script executes', async t => {
  const { runner, records, calls } = await fixture(t)
  const data = input(); data.pipeline.steps[1].parameterMappings[0].sourcePath = 'missing'
  const { record } = await finish(runner, records, data)
  assert.equal(calls.length, 1); assert.equal(record.counts.failed, 1); assert.equal(record.counts.passed, 1)
  assert.match(record.scripts[1].error, /无法从/)
})

test('login failure never executes a step and secrets are absent from history', async t => {
  const { runner, records, calls } = await fixture(t, { login: async () => { throw new Error('password fixture-password') } })
  const data = input(); data.environment.auth.password = 'fixture-password'
  const { record } = await finish(runner, records, data)
  assert.equal(calls.length, 0); assert.equal(record.failureStage, 'login'); assert.equal(record.counts.skipped, 3)
  assert.ok(!JSON.stringify(record).includes('fixture-password'))
})

for (const phase of ['login', 'script']) {
  test(`cancellation during ${phase} prevents later steps`, async t => {
    const started = deferred()
    const wait = (_payload, signal) => new Promise(resolve => {
      started.resolve(); signal.addEventListener('abort', () => resolve(success()), { once: true })
    })
    const { runner, records, calls } = await fixture(t, phase === 'login'
      ? { login: async (env, session, signal) => { await wait(env, signal); return { token: 'fixture-token', scheme: 'Bearer' } } }
      : { executeStep: wait })
    await runner.start(input()); await started.promise
    const completion = runner.active.get(input().executionId).completion
    assert.equal(runner.cancel(input().executionId, 'fixture stop'), true)
    await completion
    const record = await records.get(input().executionId)
    assert.equal(record.status, 'interrupted'); assert.equal(record.counts.skipped, 3)
    assert.equal(calls.length, 0); assert.equal(runner.list().length, 0)
  })
}

test('late admission honors a previously reserved cancellation', async t => {
  const { runner, records, calls } = await fixture(t, { pendingCancellation: () => ({ reason: 'stop before registration' }) })
  const { record } = await finish(runner, records)
  assert.equal(calls.length, 0); assert.equal(record.status, 'interrupted')
})

test('admission serializes duplicates, locks shared scripts and rejects malformed forward mappings', async t => {
  const gate = deferred()
  const { runner, records, calls } = await fixture(t, { login: async () => { await gate.promise; return { token: 'fixture-token', scheme: 'Bearer' } } })
  const data = input()
  const replies = await Promise.all([runner.start(data), runner.start(data)])
  assert.deepEqual(replies.map(reply => reply.accepted), [true, false])
  const other = input('pipeline-run-0002'); other.pipeline.id = 'pipeline-2'
  await assert.rejects(runner.start(other), { statusCode: 409 })
  other.pipeline.steps[0].parameterMappings = [{ sourceScriptId: 'third', sourcePath: 'x', targetKey: 'y' }]
  await assert.rejects(runner.start(other), /之前的步骤/)
  gate.resolve(); await runner.active.get(data.executionId).completion
  assert.equal(calls.length, 3); assert.equal((await records.get(data.executionId)).status, 'passed')
})

function environmentInput(code) {
  const data = input(`parallel-${code}-0001`)
  Object.assign(data.environment, { id: `env-${code}`, code, name: code,
    baseUrl: `https://${code.toLowerCase()}.example.test`, apiBaseUrl: `https://${code.toLowerCase()}.example.test/api` })
  return data
}

test('three environments share a configuration concurrently with isolated tokens, outputs and ordered steps', async t => {
  const gate = deferred(); const calls = []; const entered = new Set()
  const f = await fixture(t, {
    login: async env => ({ token: `token-${env.code}`, scheme: 'Bearer' }),
    executeStep: async payload => {
      calls.push(payload)
      if (payload.scriptId === 'first') { entered.add(payload.context.environmentCode); await gate.promise }
      return success({ formId: `form-${payload.context.environmentCode}` })
    },
  })
  f.configs[0].responseVariableBindings = [{ variableName: 'CREATED', responsePath: 'formId', secret: false }]
  const inputs = ['TEST', 'CN_PROD', 'HK_PROD'].map(environmentInput)
  t.after(() => gate.resolve())
  await Promise.all(inputs.map(data => f.runner.start(data)))
  await until(() => entered.size, size => size === 3)
  assert.equal(f.runner.list().length, 3)
  const completions = inputs.map(data => f.runner.active.get(data.executionId).completion)
  // Acceptance uses snapshots, including login and step parameters.
  inputs[0].environment.code = 'CHANGED'
  gate.resolve(); await Promise.all(completions)
  for (const code of ['TEST', 'CN_PROD', 'HK_PROD']) {
    const steps = calls.filter(call => call.context.environmentCode === code)
    assert.deepEqual(steps.map(call => call.scriptId), ['first', 'second', 'third'])
    assert.equal(steps[1].context.variables.FORM_ID, `form-${code}`)
    assert.equal(steps[2].context.variables.CREATED, `form-${code}`)
    assert.equal(steps[2].context.extraHTTPHeaders.Authorization, `Bearer token-${code}`)
    const record = await f.records.get(`parallel-${code}-0001`)
    assert.equal(record.status, 'passed'); assert.equal(record.environment.code, code)
    assert.ok(!JSON.stringify(record).includes(`token-${code}`))
  }
})

test('admission preserves same-environment and alias locks, enforces three slots and releases completed slots', async t => {
  const gate = deferred()
  const f = await fixture(t, { login: async () => { await gate.promise; return { token: 'fixture', scheme: 'Bearer' } } })
  t.after(() => gate.resolve())
  const first = environmentInput('TEST')
  await f.runner.start(first)
  const duplicate = { ...first, executionId: 'duplicate-environment-001', pipeline: { ...first.pipeline, id: 'another-config' } }
  await assert.rejects(f.runner.start(duplicate), { statusCode: 409 })
  const alias = structuredClone(duplicate); alias.environment.id = 'alias-environment'
  await assert.rejects(f.runner.start(alias), { statusCode: 409 })
  await Promise.all(['CN_PROD', 'HK_PROD'].map(code => f.runner.start(environmentInput(code))))
  await assert.rejects(f.runner.start(environmentInput('FOURTH')), { statusCode: 429 })
  assert.equal((await f.runner.start(first)).accepted, false)
  const completions = [...f.runner.active.values()].map(execution => execution.completion)
  gate.resolve(); await Promise.all(completions)
  assert.equal((await finish(f.runner, f.records, environmentInput('FOURTH'))).record.status, 'passed')
})

test('ambiguous script stop is rejected; cancellation and failure only affect their own environment', async t => {
  const releases = new Map(); const started = []
  const f = await apiFixture(t, { executeScript: async (payload, { signal }) => {
    started.push(payload)
    if (payload.scriptId === 'first') await new Promise(resolve => {
      releases.set(payload.context.environmentCode, resolve)
      signal.addEventListener('abort', resolve, { once: true })
    })
    return payload.context.environmentCode === 'CN_PROD' ? { ...success(), ok: false, status: 'failed', error: 'fixture business failure' }
      : success({ formId: payload.context.environmentCode })
  } })
  t.after(() => releases.forEach(resolve => resolve()))
  for (const data of ['TEST', 'CN_PROD', 'HK_PROD'].map(environmentInput)) assert.equal((await f.post('/pipeline-executions', data)).status, 202)
  await until(() => releases.size, size => size === 3)
  assert.equal((await f.post('/scripts/first/cancel')).status, 409)
  for (const record of await f.records.list()) assert.equal(record.status, 'running')
  const stopped = await f.post('/executions/parallel-TEST-0001/cancel')
  assert.equal(stopped.status, 200)
  for (const code of ['CN_PROD', 'HK_PROD']) assert.equal((await f.records.get(`parallel-${code}-0001`)).status, 'running')
  releases.get('CN_PROD')(); releases.get('HK_PROD')()
  await until(() => f.records.list(), records => records.every(record => record.status !== 'running'))
  assert.equal((await f.records.get('parallel-TEST-0001')).status, 'interrupted')
  assert.equal((await f.records.get('parallel-CN_PROD-0001')).status, 'failed')
  assert.equal((await f.records.get('parallel-HK_PROD-0001')).status, 'passed')
  assert.deepEqual(started.filter(payload => payload.context.environmentCode === 'HK_PROD').map(payload => payload.scriptId), ['first', 'second', 'third'])
  assert.equal(started.filter(payload => payload.context.environmentCode === 'TEST').length, 1)
})

test('manual runs and pipelines share atomic admission while other environments remain available', async t => {
  const gate = deferred(); const calls = []
  const f = await apiFixture(t, { executeScript: async payload => { calls.push(payload); await gate.promise; return success({ formId: 'fixture' }) } })
  t.after(() => gate.resolve())
  const data = environmentInput('TEST')
  const direct = (code, id) => f.post('/runs', { runId: id, scriptId: 'first', context: {
    environmentId: `env-${code}`, apiBaseUrl: `https://${code.toLowerCase()}.example.test/api` } })
  const manual = direct('TEST', 'manual-first-0001')
  await until(() => calls.length, count => count === 1)
  assert.equal((await f.post('/pipeline-executions', data)).status, 409)
  assert.equal((await f.post('/pipeline-executions', environmentInput('HK_PROD'))).status, 202)
  assert.equal((await direct('HK_PROD', 'manual-conflict-0001')).status, 409)
  gate.resolve(); assert.equal((await manual).status, 200)
  await until(() => f.records.list(), records => records.every(record => record.status !== 'running'))
  assert.equal((await f.post('/pipeline-executions', data)).status, 202)
  await until(() => f.records.get(data.executionId), record => record.status !== 'running')
})

test('step persistence failure retries saving without replaying business work', async t => {
  const { runner, records, calls } = await fixture(t)
  const save = records.saveRunnerStepResult.bind(records)
  let unavailable = true
  records.saveRunnerStepResult = (...args) => unavailable ? Promise.reject(new Error('fixture disk unavailable')) : save(...args)
  await runner.start(input()); await runner.active.get(input().executionId).completion
  assert.equal(runner.list()[0].phase, 'saving'); assert.equal(calls.length, 1)
  unavailable = false
  await Promise.all([runner.maintain(), runner.maintain()])
  const record = await records.get(input().executionId)
  assert.equal(record.status, 'failed'); assert.equal(record.counts.passed, 1); assert.equal(record.counts.skipped, 2)
  assert.equal(calls.length, 1); assert.equal(runner.list().length, 0)
})

test('terminal persistence failure retains the completed result and cancellation is durable', async t => {
  const { runner, records, calls } = await fixture(t)
  const save = records.finishRunnerPipeline.bind(records)
  let unavailable = true
  records.finishRunnerPipeline = (...args) => unavailable ? Promise.reject(new Error('fixture disk unavailable')) : save(...args)
  await runner.start(input()); await runner.active.get(input().executionId).completion
  assert.equal(calls.length, 3); assert.equal(runner.list()[0].phase, 'saving')
  runner.cancel(input().executionId, 'fixture stop while saving'); unavailable = false
  await runner.maintain()
  assert.equal((await records.get(input().executionId)).status, 'interrupted'); assert.equal(calls.length, 3)
})

test('a failed save retry in one environment cannot starve another batch or replay either one', async t => {
  const f = await fixture(t)
  const save = f.records.finishRunnerPipeline.bind(f.records)
  const unavailable = new Set(['parallel-TEST-0001', 'parallel-HK_PROD-0001'])
  f.records.finishRunnerPipeline = (id, ...args) => unavailable.has(id)
    ? Promise.reject(new Error('fixture batch save unavailable')) : save(id, ...args)
  await Promise.all(['TEST', 'HK_PROD'].map(code => finish(f.runner, f.records, environmentInput(code))))
  assert.equal(f.runner.list().length, 2)
  unavailable.delete('parallel-HK_PROD-0001')
  await f.runner.maintain()
  assert.equal((await f.records.get('parallel-HK_PROD-0001')).status, 'passed')
  assert.equal((await f.records.get('parallel-TEST-0001')).status, 'running')
  unavailable.clear(); await f.runner.maintain()
  assert.equal(f.runner.list().length, 0)
  assert.equal(f.calls.length, 6)
})

test('restart reconciles unfinished login or execution and never invokes business work', async t => {
  const { runner, records, directory } = await fixture(t, { pendingCancellation: () => ({ reason: 'fixture' }) })
  await finish(runner, records)
  const record = await records.get(input().executionId)
  record.status = 'running'; record.finishedAt = null; record.scripts.forEach(script => { script.status = 'queued' })
  record.updatedAt = new Date(Date.now() - 10000).toISOString()
  delete record.runnerTracking
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(directory, `${record.id}.json`), JSON.stringify(record))
  const reloaded = new RunRecordFileStore({ directory, now: () => new Date(Date.now() + 10000) })
  reloaded.setRunnerActivityProvider(() => [], { graceMs: 1 })
  await new Promise(resolve => setTimeout(resolve, 5))
  // Advance deterministic time beyond the startup grace.
  reloaded.now = () => new Date(Date.now() + 20000)
  const recovered = await reloaded.get(record.id)
  assert.equal(recovered.status, 'interrupted'); assert.equal(recovered.counts.skipped, 3)
  assert.match(recovered.logs.at(-1).message, /不会自动重跑/)
})

async function apiFixture(t, options = {}) {
  const f = await fixture(t)
  const server = createRunnerServer({ runRecordStore: f.records, scriptConfigRepository: { get: async id => f.configs.find(config => config.id === id) },
    validateRequest: payload => ({ scriptId: payload.scriptId, executionId: payload.executionId }),
    executeScript: async () => success({ formId: 'new-form' }), pipelineLogin: async () => ({ token: 'fixture-token', scheme: 'Bearer' }),
    recordMaintenanceIntervalMs: 10, cancellationWaitTimeoutMs: 100, ...options })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}`
  const post = (path, data = {}) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
  return { ...f, server, url, post }
}
async function until(read, predicate) {
  for (let i = 0; i < 200; i++) { const value = await read(); if (predicate(value)) return value; await new Promise(r => setTimeout(r, 10)) }
  throw new Error('fixture condition timed out')
}

test('HTTP acceptance detaches from client, streams counts/logs, locks direct runs and completes without polling', async t => {
  const release = deferred(); let calls = 0
  const f = await apiFixture(t, { executeScript: async (payload, { onLog }) => {
    calls++; onLog({ timestamp: new Date().toISOString(), level: 'info', message: 'fixture running' })
    if (calls === 2) await release.promise
    return success({ formId: 'new-form' })
  } })
  const response = await f.post('/pipeline-executions', input())
  assert.equal(response.status, 202); await response.body.cancel()
  const live = await until(() => f.records.get(input().executionId), record => record.counts.passed === 1 && record.scripts[1].logs.length > 0)
  assert.equal(live.status, 'running'); assert.equal(live.scripts[1].status, 'running')
  assert.equal((await f.post('/runs', { runId: 'direct-run-0001', scriptId: 'third', context: {} })).status, 409)
  const active = await (await fetch(f.url + '/pipeline-executions')).json()
  assert.equal(active.executions[0].pipelineId, 'pipeline-1')
  release.resolve()
  const completed = await until(() => f.records.get(input().executionId), record => record.status !== 'running')
  assert.equal(completed.counts.passed, 3); assert.equal(calls, 3)
  assert.equal((await f.post('/pipeline-executions', input())).status, 200)
  assert.equal(calls, 3)
})

test('HTTP cancel before registration and cancel during login persist interruption', async t => {
  let calls = 0
  const f = await apiFixture(t, { pipelineLogin: (env, session, signal) => new Promise((resolve, reject) => {
    calls++; signal.addEventListener('abort', () => reject(new Error('fixture cancelled')), { once: true })
  }) })
  assert.equal((await f.post(`/executions/${input().executionId}/cancel`)).status, 200)
  await f.post('/pipeline-executions', input())
  const stopped = await until(() => f.records.get(input().executionId), record => record.status !== 'running')
  assert.equal(stopped.status, 'interrupted'); assert.equal(calls, 0)
  const data = input('pipeline-run-0002')
  await f.post('/pipeline-executions', data)
  const cancelled = await (await f.post(`/executions/${data.executionId}/cancel`)).json()
  assert.equal(cancelled.pipelineFound, true)
  assert.equal((await f.records.get(data.executionId)).status, 'interrupted')
})

test('HTTP script stop during pipeline login succeeds even without a browser step', async t => {
  const f = await apiFixture(t, { pipelineLogin: (env, session, signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('fixture cancelled')), { once: true })
  }) })
  await f.post('/pipeline-executions', input())
  assert.equal((await f.post('/scripts/third/cancel')).status, 200)
  assert.equal((await until(() => f.records.get(input().executionId), record => record.status !== 'running')).status, 'interrupted')
})

test('API exposes and can stop a persisted orphan pipeline without frontend PATCH or business replay', async t => {
  let executions = 0
  const f = await apiFixture(t, { executeScript: async () => { executions++; return success() }, recordRecoveryGraceMs: 60000 })
  // Create a valid previous-process record, preserving one completed step.
  const { record } = await finish(f.runner, f.records)
  const orphan = structuredClone(record)
  orphan.id = 'orphan-pipeline-0001'; orphan.status = 'running'; orphan.finishedAt = null
  orphan.scripts.forEach((script, index) => { script.recordId = `${orphan.id}:${script.id}`; if (index > 0) script.status = 'queued' })
  await f.records.create(orphan)
  const active = await (await fetch(f.url + '/pipeline-executions')).json()
  assert.equal(active.executions[0].phase, 'recovering')
  const other = input('different-run-0001'); other.pipeline.id = 'different-pipeline'
  assert.equal((await f.post('/pipeline-executions', other)).status, 409)
  assert.equal((await f.post('/runs', { runId: 'direct-run-0001', scriptId: 'third', context: {} })).status, 409)
  const result = await (await f.post(`/executions/${orphan.id}/cancel`)).json()
  assert.equal(result.pipelineFound, true)
  const stopped = await f.records.get(orphan.id)
  assert.equal(stopped.status, 'interrupted'); assert.equal(stopped.counts.passed, 1); assert.equal(stopped.counts.skipped, 2)
  assert.equal(executions, 0)
})

test('an active quiet login lease cannot be recovered as stale', async t => {
  const gate = deferred()
  const { runner, records } = await fixture(t, { login: async () => { await gate.promise; return { token: 'fixture-token', scheme: 'Bearer' } } })
  await runner.start(input())
  const completion = runner.active.get(input().executionId).completion
  records.now = () => new Date(Date.now() + 600000)
  assert.equal((await records.get(input().executionId)).status, 'running')
  runner.cancel(input().executionId, 'fixture stop'); gate.resolve(); await completion
  assert.equal((await records.get(input().executionId)).status, 'interrupted')
})

test('three environments concurrently execute registered fixture modules through the real validator and script executor', async t => {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const { FileScriptConfigRepository } = await import('./script-config-repository.mjs')
  const root = await mkdtemp(join(tmpdir(), 'autotest-pipeline-registered-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const scriptsDirectory = join(root, 'scripts'); const configDirectory = join(root, 'configs')
  await mkdir(scriptsDirectory); await mkdir(configDirectory)
  for (const config of configList()) {
    await writeFile(join(scriptsDirectory, config.entryFile), `export async function run(context) {
      context.logger('info', 'registered fixture executed')
      return { formId: 'registered-form', inheritedForm: context.variables.FORM_ID ?? '', timeoutMs: context.timeoutMs,
        requestPath: context.requestPath ?? '', order: context.variables.ORDER, environmentCode: context.environmentCode }
    }`)
    await writeFile(join(configDirectory, `${config.id}.json`), JSON.stringify({ ...config,
      schemaVersion: 1, revision: 0, timeoutMs: 1000, tags: [], description: '', inputParameters: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }))
  }
  const repository = new FileScriptConfigRepository({ directory: configDirectory, scriptsDirectory })
  const f = await apiFixture(t, { executeScript: undefined, validateRequest: undefined,
    scriptsDirectory, scriptConfigRepository: repository, artifactRootDirectory: join(root, 'artifacts') })
  await Promise.all(['TEST', 'CN_PROD', 'HK_PROD'].map(async code => {
    const data = environmentInput(code)
    const response = await f.post('/pipeline-executions', data)
    assert.equal(response.status, 202, await response.text())
    const record = await until(() => f.records.get(data.executionId), record => record.status !== 'running')
    assert.equal(record.status, 'passed', record.error)
    assert.equal(record.scripts[1].output.requestPath, '/form?id=registered-form')
    assert.equal(record.scripts[2].output.inheritedForm, 'registered-form')
    assert.equal(record.scripts[1].output.timeoutMs, code === 'HK_PROD' ? 3000 : 1000)
    assert.equal(record.scripts[2].output.order, 'environment')
    assert.equal(record.scripts[2].output.environmentCode, code)
    assert.match(record.scripts[0].logs[0].message, /registered fixture/)
  }))
})
