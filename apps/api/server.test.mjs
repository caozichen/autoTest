import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { RunRecordFileStore } from './run-record-store.mjs'
import { createRunnerServer } from './server.mjs'

function runPayload(runId, scriptId = 'form-contact-publish') {
  return {
    runId,
    scriptId,
    context: {},
  }
}

function createControlledExecution() {
  const signals = []
  const executeScript = (_payload, { onLog, signal }) => new Promise((resolve) => {
    signals.push(signal)
    signal.addEventListener('abort', () => {
      const reason = typeof signal.reason === 'string' ? signal.reason : '用户强制停止运行'
      const log = {
        timestamp: new Date().toISOString(),
        level: 'warning',
        message: `执行已取消：${reason}`,
      }
      onLog(log)
      resolve({
        ok: false,
        cancelled: true,
        status: 'interrupted',
        durationMs: 1,
        logs: [log],
        error: reason,
      })
    }, { once: true })
  })

  return { executeScript, signals }
}

async function startTestServer(t, {
  controlled = createControlledExecution(),
  runSnapshotTtlMs = 60_000,
  cancellationWaitTimeoutMs = 500,
  artifactPersistenceTimeoutMs,
  artifactRootDirectory,
  runRecordDirectory,
  runRecordStore,
  scriptConfigDirectory,
  scriptsDirectory,
} = {}) {
  const server = createRunnerServer({
    executeScript: controlled.executeScript,
    validateRequest: (payload) => ({
      scriptId: payload.scriptId,
      ...(payload.executionId ? { executionId: payload.executionId } : {}),
    }),
    runSnapshotTtlMs,
    cancellationWaitTimeoutMs,
    ...(artifactPersistenceTimeoutMs ? { artifactPersistenceTimeoutMs } : {}),
    ...(artifactRootDirectory ? { artifactRootDirectory } : {}),
    ...(runRecordDirectory ? { runRecordDirectory } : {}),
    ...(runRecordStore ? { runRecordStore } : {}),
    ...(scriptConfigDirectory ? { scriptConfigDirectory } : {}),
    ...(scriptsDirectory ? { scriptsDirectory } : {}),
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())
  const address = server.address()
  return {
    ...controlled,
    baseUrl: `http://127.0.0.1:${address.port}`,
  }
}

function scriptConfigFixture({
  id = 'server-script',
  revision = 0,
  updatedAt = '2026-08-31T08:00:00.000Z',
} = {}) {
  return {
    schemaVersion: 1,
    revision,
    id,
    name: 'API 脚本配置',
    description: '服务接口持久化测试',
    directory: 'scripts',
    entryFile: 'server-script.ui.spec.mjs',
    timeoutMs: 300_000,
    enabled: true,
    tags: ['Playwright', 'P0'],
    createdAt: '2026-08-31T08:00:00.000Z',
    updatedAt,
  }
}

function storedRecord(runId, responseBody = { ok: true }) {
  const timestamp = '2026-08-31T08:00:00.000Z'
  return {
    schemaVersion: 1,
    revision: 0,
    id: runId,
    displayId: `RUN-${runId}`,
    name: 'API 文件记录',
    status: 'running',
    trigger: 'manual',
    browser: 'Chromium',
    environment: {
      id: 'env-test',
      name: '测试环境',
      code: 'TEST',
      apiBaseUrl: 'https://example.test/api',
    },
    startedAt: timestamp,
    updatedAt: timestamp,
    finishedAt: null,
    durationMs: null,
    counts: { total: 1, passed: 0, failed: 0, skipped: 0 },
    scripts: [{
      recordId: `${runId}:script-001`,
      id: 'script-001',
      name: '示例脚本',
      directory: 'scripts',
      entryFile: 'example.spec.mjs',
      tags: ['P0'],
      status: 'queued',
      durationMs: null,
      logs: [],
      assertions: [],
      apiResponses: [{
        sequence: 1,
        timestamp,
        name: '/api/large',
        method: 'GET',
        url: 'https://example.test/api/large',
        status: 200,
        ok: true,
        durationMs: 10,
        responseBody,
      }],
      output: { code: 'fixture-output' },
    }],
    logs: [],
    analysis: {
      passRate: 0,
      averageDurationMs: 0,
      slowestScriptRecordId: null,
      logCounts: { info: 0, success: 0, warning: 0, error: 0 },
      failureGroups: [],
    },
  }
}

function storedArtifact(executionId, {
  stepId = 'script-001',
  attemptId = 'attempt-001',
  relativePath = 'screenshots/failure.png',
  rootDirectory = join('/tmp', 'autotest-artifacts'),
  absolutePath = join(rootDirectory, executionId, stepId, attemptId, relativePath),
  type = 'screenshot',
  mimeType = 'image/png',
  sizeBytes = 1024,
} = {}) {
  return {
    executionId,
    stepId,
    attemptId,
    absolutePath,
    relativePath,
    type,
    mimeType,
    sizeBytes,
    createdAt: '2026-08-31T08:01:00.000Z',
  }
}

function screenshotUrl(baseUrl, artifact, { relativePath = artifact.relativePath } = {}) {
  const url = new URL(
    `/run-records/${encodeURIComponent(artifact.executionId)}`
      + `/screenshots/${encodeURIComponent(artifact.stepId)}`
      + `/${encodeURIComponent(artifact.attemptId)}`,
    baseUrl,
  )
  url.searchParams.set('path', relativePath)
  return url
}

async function waitForRun(baseUrl, runId) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(`${baseUrl}/runs/${encodeURIComponent(runId)}`)
    if (response.ok) return response.json()
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`运行任务 ${runId} 未进入 Runner`)
}

test('force stops one run by exact runId and retains an interrupted snapshot', async (t) => {
  const { baseUrl, signals } = await startTestServer(t)
  const runId = 'run-exact-001'
  const runResponsePromise = fetch(`${baseUrl}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(runPayload(runId)),
  })

  const running = await waitForRun(baseUrl, runId)
  assert.equal(running.status, 'running')
  assert.equal(running.scriptId, 'form-contact-publish')
  assert.equal(signals[0].aborted, false)

  const cancelResponse = await fetch(`${baseUrl}/runs/${runId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: '用户从脚本操作栏强制停止' }),
  })
  const cancellation = await cancelResponse.json()
  assert.equal(cancelResponse.status, 200)
  assert.deepEqual(cancellation.cancelledRunIds, [runId])
  assert.deepEqual(cancellation.cleanupTimedOutRunIds, [])
  assert.equal(cancellation.runs[0].status, 'interrupted')
  assert.equal(cancellation.runs[0].cancelled, true)
  assert.equal(signals[0].reason, '用户从脚本操作栏强制停止')

  const runResponse = await runResponsePromise
  const result = await runResponse.json()
  assert.equal(runResponse.status, 200)
  assert.equal(result.cancelled, true)
  assert.equal(result.error, '用户从脚本操作栏强制停止')

  const interrupted = await waitForRun(baseUrl, runId)
  assert.equal(interrupted.status, 'interrupted')
  assert.equal(interrupted.ok, false)
  assert.match(interrupted.logs.at(-1)?.message ?? '', /强制停止/)

  const secondCancel = await fetch(`${baseUrl}/runs/${runId}/cancel`, { method: 'POST' })
  assert.equal(secondCancel.status, 409)

  const missingCancel = await fetch(`${baseUrl}/runs/run-missing-001/cancel`, { method: 'POST' })
  const missing = await missingCancel.json()
  assert.equal(missingCancel.status, 404)
  assert.match(missing.error, /不存在或已过期/)
})

test('reserves an exact-run cancellation that arrives before run registration', async (t) => {
  let executionCount = 0
  const controlled = {
    signals: [],
    executeScript: async () => {
      executionCount += 1
      return { ok: true, durationMs: 1, logs: [] }
    },
  }
  const { baseUrl } = await startTestServer(t, { controlled })
  const runId = 'run-reserved-cancel-001'

  const cancelResponse = await fetch(`${baseUrl}/runs/${runId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reserveIfMissing: true,
      reason: '用户在任务注册前停止运行',
    }),
  })
  const cancellation = await cancelResponse.json()
  assert.equal(cancelResponse.status, 200)
  assert.equal(cancellation.pendingRegistration, true)
  assert.deepEqual(cancellation.cancelledRunIds, [runId])

  const reservedSnapshot = await waitForRun(baseUrl, runId)
  assert.equal(reservedSnapshot.status, 'interrupted')
  assert.equal(reservedSnapshot.cancelled, true)
  assert.equal(reservedSnapshot.pendingRegistration, true)

  const runResponse = await fetch(`${baseUrl}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(runPayload(runId)),
  })
  const result = await runResponse.json()
  assert.equal(runResponse.status, 200)
  assert.equal(result.status, 'interrupted')
  assert.equal(result.cancelled, true)
  assert.match(result.error, /注册前停止/)
  assert.equal(executionCount, 0)

  const interruptedSnapshot = await waitForRun(baseUrl, runId)
  assert.equal(interruptedSnapshot.status, 'interrupted')
  assert.equal(interruptedSnapshot.pendingRegistration, undefined)
})

test('force stops every active run for an execution and keeps cancellation idempotent', async (t) => {
  const { baseUrl, signals } = await startTestServer(t)
  const executionId = 'execution-active-001'
  const runIds = ['run-execution-001', 'run-execution-002']
  const runResponses = runIds.map((runId) => fetch(`${baseUrl}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...runPayload(runId), executionId }),
  }))
  await Promise.all(runIds.map((runId) => waitForRun(baseUrl, runId)))

  const cancelResponse = await fetch(`${baseUrl}/executions/${executionId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: '用户从运行记录强制停止批次' }),
  })
  const cancellation = await cancelResponse.json()

  assert.equal(cancelResponse.status, 200)
  assert.equal(cancellation.executionId, executionId)
  assert.equal(cancellation.pendingRegistration, true)
  assert.deepEqual(new Set(cancellation.cancelledRunIds), new Set(runIds))
  assert.deepEqual(cancellation.cleanupTimedOutRunIds, [])
  assert.equal(cancellation.runs.every((run) => run.status === 'interrupted'), true)
  assert.equal(signals.every((signal) => signal.aborted), true)
  assert.equal(signals.every((signal) => signal.reason === '用户从运行记录强制停止批次'), true)
  await Promise.all(runResponses)

  const repeatedResponse = await fetch(`${baseUrl}/executions/${executionId}/cancel`, {
    method: 'POST',
  })
  const repeated = await repeatedResponse.json()
  assert.equal(repeatedResponse.status, 200)
  assert.equal(repeated.pendingRegistration, true)
  assert.deepEqual(repeated.cancelledRunIds, [])
})

test('execution cancellation blocks every later run while its reservation is active', async (t) => {
  let executionCount = 0
  const controlled = {
    signals: [],
    executeScript: async () => {
      executionCount += 1
      return { ok: true, durationMs: 1, logs: [] }
    },
  }
  const { baseUrl } = await startTestServer(t, { controlled })
  const executionId = 'execution-reserved-001'

  const cancelResponse = await fetch(`${baseUrl}/executions/${executionId}/cancel`, {
    method: 'POST',
  })
  const cancellation = await cancelResponse.json()
  assert.equal(cancelResponse.status, 200)
  assert.equal(cancellation.pendingRegistration, true)
  assert.deepEqual(cancellation.cancelledRunIds, [])

  for (const runId of ['run-batch-later-001', 'run-batch-later-002']) {
    const response = await fetch(`${baseUrl}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...runPayload(runId), executionId }),
    })
    const result = await response.json()
    assert.equal(response.status, 200)
    assert.equal(result.status, 'interrupted')
    assert.equal(result.cancelled, true)
  }
  assert.equal(executionCount, 0)
})

test('execution cancellation reservation expires with the run snapshot TTL', async (t) => {
  let executionCount = 0
  const controlled = {
    signals: [],
    executeScript: async () => {
      executionCount += 1
      return { ok: true, durationMs: 1, logs: [] }
    },
  }
  const { baseUrl } = await startTestServer(t, {
    controlled,
    runSnapshotTtlMs: 25,
  })
  const executionId = 'execution-expiring-001'

  const cancelResponse = await fetch(`${baseUrl}/executions/${executionId}/cancel`, {
    method: 'POST',
  })
  assert.equal(cancelResponse.status, 200)

  await new Promise((resolve) => setTimeout(resolve, 50))
  const expiredResponse = await fetch(`${baseUrl}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...runPayload('run-batch-expired-001'), executionId }),
  })
  const expiredResult = await expiredResponse.json()
  assert.equal(expiredResponse.status, 200)
  assert.equal(expiredResult.ok, true)
  assert.equal(expiredResult.cancelled, undefined)
  assert.equal(executionCount, 1)
})

test('rejects invalid execution cancellation IDs without creating a reservation', async (t) => {
  const { baseUrl } = await startTestServer(t)
  const response = await fetch(`${baseUrl}/executions/${encodeURIComponent('../invalid')}/cancel`, {
    method: 'POST',
  })
  const result = await response.json()

  assert.equal(response.status, 400)
  assert.match(result.error, /批次执行 ID 格式无效/)
})

test('force stops every active run for a script and returns 404 when none exist', async (t) => {
  const { baseUrl, signals } = await startTestServer(t)
  const runIds = ['run-script-001', 'run-script-002']
  const runResponses = runIds.map((runId) => fetch(`${baseUrl}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(runPayload(runId, 'form-all-fields-publish')),
  }))
  await Promise.all(runIds.map((runId) => waitForRun(baseUrl, runId)))

  const cancelResponse = await fetch(
    `${baseUrl}/scripts/${encodeURIComponent('form-all-fields-publish')}/cancel`,
    { method: 'POST' },
  )
  const cancellation = await cancelResponse.json()
  assert.equal(cancelResponse.status, 200)
  assert.deepEqual(new Set(cancellation.cancelledRunIds), new Set(runIds))
  assert.equal(signals.every((signal) => signal.aborted), true)
  await Promise.all(runResponses)

  const noMatchResponse = await fetch(
    `${baseUrl}/scripts/${encodeURIComponent('form-all-fields-publish')}/cancel`,
    { method: 'POST' },
  )
  const noMatch = await noMatchResponse.json()
  assert.equal(noMatchResponse.status, 404)
  assert.equal(noMatch.ok, false)
  assert.match(noMatch.error, /没有正在运行的任务/)
})

test('disconnecting the initiating client does not cancel its run', async (t) => {
  const { baseUrl, signals } = await startTestServer(t)
  const runId = 'run-disconnect-001'
  const url = new URL('/runs', baseUrl)
  const request = httpRequest({
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  request.on('error', () => {})
  request.end(JSON.stringify(runPayload(runId)))

  await waitForRun(baseUrl, runId)
  request.destroy()
  await new Promise((resolve) => setTimeout(resolve, 20))

  const running = await waitForRun(baseUrl, runId)
  assert.equal(running.status, 'running')
  assert.equal(signals[0].aborted, false)

  const cancelResponse = await fetch(`${baseUrl}/runs/${runId}/cancel`, { method: 'POST' })
  assert.equal(cancelResponse.status, 200)
  assert.equal(signals[0].aborted, true)
})

test('exposes resource evidence, network summary, and the pipeline continuation signal in run results', async (t) => {
  const resourceResponses = [{
    sequence: 1,
    timestamp: '2026-09-04T08:00:00.000Z',
    name: '/assets/app.js',
    url: 'https://example.test/assets/app.js',
    resourceType: 'script',
    status: 404,
    ok: false,
    durationMs: 10,
    phase: '页面初始化',
    isFirstParty: true,
    error: 'Not Found',
  }]
  const networkSummary = {
    api: { observed: 0, recorded: 0, dropped: 0, passed: 0, failed: 0, warnings: 0 },
    resources: { observed: 1, recorded: 1, dropped: 0, passed: 0, failed: 1, warnings: 0 },
  }
  const controlled = {
    signals: [],
    executeScript: async () => ({
      ok: false,
      status: 'failed',
      continuePipeline: true,
      durationMs: 10,
      logs: [],
      assertions: [],
      apiResponses: [],
      resourceResponses,
      networkSummary,
      error: '网络健康断言失败',
    }),
  }
  const { baseUrl } = await startTestServer(t, { controlled })
  const runId = 'run-network-001'

  const response = await fetch(`${baseUrl}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(runPayload(runId)),
  })
  const result = await response.json()
  const snapshot = await waitForRun(baseUrl, runId)

  assert.equal(response.status, 200)
  assert.equal(result.continuePipeline, true)
  assert.deepEqual(result.resourceResponses, resourceResponses)
  assert.deepEqual(result.networkSummary, networkSummary)
  assert.equal(snapshot.continuePipeline, true)
  assert.deepEqual(snapshot.resourceResponses, resourceResponses)
  assert.deepEqual(snapshot.networkSummary, networkSummary)
})

test('exposes timeout metadata in the terminal run snapshot', async (t) => {
  const controlled = {
    signals: [],
    executeScript: async () => ({
      ok: false,
      timedOut: true,
      durationMs: 1_000,
      logs: [],
      error: '脚本执行超时',
    }),
  }
  const { baseUrl } = await startTestServer(t, { controlled })
  const runId = 'run-timeout-meta-001'

  await fetch(`${baseUrl}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(runPayload(runId)),
  })
  const snapshot = await waitForRun(baseUrl, runId)

  assert.equal(snapshot.status, 'failed')
  assert.equal(snapshot.timedOut, true)
})

test('publishes the terminal run state before bounded artifact persistence finishes', async (t) => {
  let notifyMergeStarted
  const mergeStarted = new Promise((resolve) => {
    notifyMergeStarted = resolve
  })
  const controlled = {
    signals: [],
    executeScript: async () => ({
      ok: true,
      durationMs: 10,
      logs: [],
      artifacts: [{ relativePath: 'trace.zip' }],
    }),
  }
  const runRecordStore = {
    mergeScriptArtifacts: () => {
      notifyMergeStarted()
      return new Promise(() => {})
    },
  }
  const { baseUrl } = await startTestServer(t, {
    controlled,
    runRecordStore,
    artifactPersistenceTimeoutMs: 10,
  })
  const runId = 'run-artifact-timeout-001'

  const responsePromise = fetch(`${baseUrl}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(runPayload(runId)),
  })
  await mergeStarted
  const snapshot = await waitForRun(baseUrl, runId)

  assert.equal(snapshot.status, 'passed')
  assert.equal(snapshot.ok, true)
  const response = await responsePromise
  const result = await response.json()
  assert.equal(response.status, 200)
  assert.ok(result.logs.some((log) => /运行制品写入历史记录失败：超过 10 ms/.test(log.message)))
})

test('persists completed artifacts into run history without a browser-side record patch', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'autotest-server-artifacts-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const record = storedRecord('stored-artifacts-001')
  const artifact = storedArtifact(record.id)
  const runRecordStore = new RunRecordFileStore({
    directory,
    now: () => new Date('2026-08-31T08:02:00.000Z'),
  })
  await runRecordStore.create(record)
  const controlled = {
    signals: [],
    executeScript: async () => ({
      ok: true,
      durationMs: 10,
      logs: [],
      artifacts: [artifact],
      result: { status: 'completed' },
    }),
  }
  const { baseUrl } = await startTestServer(t, { controlled, runRecordStore })

  const runResponse = await fetch(`${baseUrl}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...runPayload('runner-artifact-001', 'script-001'),
      executionId: record.id,
    }),
  })
  const detailResponse = await fetch(`${baseUrl}/run-records/${record.id}`)
  const detail = await detailResponse.json()

  assert.equal(runResponse.status, 200)
  assert.equal(detailResponse.status, 200)
  assert.equal(detail.record.revision, 1)
  assert.deepEqual(detail.record.scripts[0].artifacts, [artifact])
})

test('persists cancelled-run artifacts before the stop response completes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'autotest-server-cancel-artifacts-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const record = storedRecord('stored-cancel-artifacts-001')
  const artifact = storedArtifact(record.id, { relativePath: 'fixtures/input.txt' })
  const runRecordStore = new RunRecordFileStore({
    directory,
    now: () => new Date('2026-08-31T08:02:00.000Z'),
  })
  await runRecordStore.create(record)
  let notifyStarted
  const started = new Promise((resolve) => { notifyStarted = resolve })
  const controlled = {
    signals: [],
    executeScript: (_payload, { signal }) => new Promise((resolve) => {
      controlled.signals.push(signal)
      notifyStarted()
      signal.addEventListener('abort', () => resolve({
        ok: false,
        cancelled: true,
        status: 'interrupted',
        durationMs: 10,
        logs: [],
        artifacts: [artifact],
        error: 'cancelled',
      }), { once: true })
    }),
  }
  const { baseUrl } = await startTestServer(t, { controlled, runRecordStore })
  const runId = 'runner-cancel-artifact-001'
  const runTask = fetch(`${baseUrl}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...runPayload(runId, 'script-001'), executionId: record.id }),
  })
  await started

  const cancelResponse = await fetch(`${baseUrl}/runs/${runId}/cancel`, { method: 'POST' })
  const runResponse = await runTask
  const detailResponse = await fetch(`${baseUrl}/run-records/${record.id}`)
  const detail = await detailResponse.json()

  assert.equal(cancelResponse.status, 200)
  assert.equal(runResponse.status, 200)
  assert.deepEqual(detail.record.scripts[0].artifacts, [artifact])
})

test('serves registered screenshots from the trusted artifact root with safe response headers', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'autotest-server-screenshot-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const artifactRootDirectory = join(root, 'artifacts')
  const runRecordStore = new RunRecordFileStore({ directory: join(root, 'records') })
  const record = storedRecord('stored-screenshot-001')
  const screenshotBody = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  const artifact = storedArtifact(record.id, {
    rootDirectory: artifactRootDirectory,
    relativePath: 'screenshots/failure page.png',
    sizeBytes: screenshotBody.length,
  })
  record.scripts[0].artifacts = [artifact]
  await mkdir(dirname(artifact.absolutePath), { recursive: true })
  await writeFile(artifact.absolutePath, screenshotBody)
  await runRecordStore.create(record)
  const { baseUrl } = await startTestServer(t, { artifactRootDirectory, runRecordStore })

  const response = await fetch(screenshotUrl(baseUrl, artifact), {
    headers: { Origin: 'http://127.0.0.1:5174' },
  })

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/png')
  assert.equal(response.headers.get('content-length'), String(screenshotBody.length))
  assert.equal(response.headers.get('content-disposition'), 'inline')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5174')
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), screenshotBody)

  const rejectedOrigin = await fetch(screenshotUrl(baseUrl, artifact), {
    headers: { Origin: 'https://attacker.example' },
  })
  assert.equal(rejectedOrigin.status, 403)
})

test('rejects unregistered, malformed, non-image, escaped, and linked screenshot targets', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'autotest-server-screenshot-security-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const artifactRootDirectory = join(root, 'trusted-artifacts')
  const outsideRoot = join(root, 'outside-artifacts')
  const runRecordStore = new RunRecordFileStore({ directory: join(root, 'records') })
  const record = storedRecord('stored-screenshot-security-001')

  const nonScreenshot = storedArtifact(record.id, {
    rootDirectory: artifactRootDirectory,
    attemptId: 'attempt-fixture',
    relativePath: 'fixtures/input.png',
    type: 'fixture',
    sizeBytes: 1,
  })
  const unsupportedImage = storedArtifact(record.id, {
    rootDirectory: artifactRootDirectory,
    attemptId: 'attempt-svg',
    relativePath: 'screenshots/vector.svg',
    mimeType: 'image/svg+xml',
    sizeBytes: 1,
  })

  const outsideBody = Buffer.from('outside screenshot data')
  const outsideArtifact = storedArtifact(record.id, {
    rootDirectory: outsideRoot,
    attemptId: 'attempt-outside',
    relativePath: 'screenshots/outside.png',
    sizeBytes: outsideBody.length,
  })
  await mkdir(dirname(outsideArtifact.absolutePath), { recursive: true })
  await writeFile(outsideArtifact.absolutePath, outsideBody)

  const linkedBody = Buffer.from('linked secret data')
  const linkedTarget = join(root, 'linked-secret.png')
  await writeFile(linkedTarget, linkedBody)
  const linkedArtifact = storedArtifact(record.id, {
    rootDirectory: artifactRootDirectory,
    attemptId: 'attempt-file-link',
    relativePath: 'screenshots/linked.png',
    sizeBytes: linkedBody.length,
  })
  await mkdir(dirname(linkedArtifact.absolutePath), { recursive: true })
  await symlink(linkedTarget, linkedArtifact.absolutePath)

  const directoryLinkedBody = Buffer.from('directory-linked secret data')
  const directoryLinkTarget = join(root, 'linked-attempt-target')
  await mkdir(join(directoryLinkTarget, 'screenshots'), { recursive: true })
  await writeFile(join(directoryLinkTarget, 'screenshots', 'linked.png'), directoryLinkedBody)
  const directoryLinkedArtifact = storedArtifact(record.id, {
    rootDirectory: artifactRootDirectory,
    attemptId: 'attempt-directory-link',
    relativePath: 'screenshots/linked.png',
    sizeBytes: directoryLinkedBody.length,
  })
  await mkdir(
    join(artifactRootDirectory, record.id, directoryLinkedArtifact.stepId),
    { recursive: true },
  )
  await symlink(
    directoryLinkTarget,
    join(artifactRootDirectory, record.id, directoryLinkedArtifact.stepId, directoryLinkedArtifact.attemptId),
  )

  record.scripts[0].artifacts = [
    nonScreenshot,
    unsupportedImage,
    outsideArtifact,
    linkedArtifact,
    directoryLinkedArtifact,
  ]
  await runRecordStore.create(record)
  const { baseUrl } = await startTestServer(t, { artifactRootDirectory, runRecordStore })

  for (const artifact of [
    nonScreenshot,
    unsupportedImage,
    outsideArtifact,
    linkedArtifact,
    directoryLinkedArtifact,
  ]) {
    const response = await fetch(screenshotUrl(baseUrl, artifact))
    assert.equal(response.status, 404, artifact.relativePath)
    assert.equal((await response.json()).code, 'SCREENSHOT_NOT_FOUND')
  }

  for (const relativePath of [
    '../outside.png',
    '/etc/passwd',
    'screenshots\\outside.png',
    'screenshots//outside.png',
    'screenshots/./outside.png',
  ]) {
    const response = await fetch(screenshotUrl(baseUrl, outsideArtifact, { relativePath }))
    assert.equal(response.status, 400, relativePath)
  }

  const unregistered = await fetch(screenshotUrl(baseUrl, {
    ...outsideArtifact,
    attemptId: 'attempt-missing',
    relativePath: 'screenshots/missing.png',
  }))
  assert.equal(unregistered.status, 404)

  const duplicatePathUrl = screenshotUrl(baseUrl, outsideArtifact)
  duplicatePathUrl.searchParams.append('path', outsideArtifact.relativePath)
  assert.equal((await fetch(duplicatePathUrl)).status, 400)
})

test('cancel waits for cooperative executor cleanup before responding', async (t) => {
  let cleanupFinished = false
  const controlled = {
    signals: [],
    executeScript: (_payload, { signal }) => new Promise((resolve) => {
      controlled.signals.push(signal)
      signal.addEventListener('abort', () => {
        setTimeout(() => {
          cleanupFinished = true
          resolve({
            ok: false,
            cancelled: true,
            status: 'interrupted',
            durationMs: 30,
            logs: [],
            error: String(signal.reason),
          })
        }, 30)
      }, { once: true })
    }),
  }
  const { baseUrl } = await startTestServer(t, {
    controlled,
    cancellationWaitTimeoutMs: 250,
  })
  const runId = 'run-cleanup-001'
  const runResponsePromise = fetch(`${baseUrl}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(runPayload(runId)),
  })
  await waitForRun(baseUrl, runId)

  const cancelledAt = performance.now()
  const cancelResponse = await fetch(`${baseUrl}/runs/${runId}/cancel`, { method: 'POST' })
  const cancellation = await cancelResponse.json()

  assert.equal(cancelResponse.status, 200)
  assert.equal(cleanupFinished, true)
  assert.ok(performance.now() - cancelledAt >= 20)
  assert.deepEqual(cancellation.cleanupTimedOutRunIds, [])
  await runResponsePromise
})

test('cancel returns within its deadline when an executor ignores AbortSignal', async (t) => {
  let resolveExecution
  const controlled = {
    signals: [],
    executeScript: (_payload, { signal }) => new Promise((resolve) => {
      controlled.signals.push(signal)
      resolveExecution = resolve
    }),
  }
  const { baseUrl } = await startTestServer(t, {
    controlled,
    cancellationWaitTimeoutMs: 25,
  })
  const runId = 'run-timeout-001'
  const runResponsePromise = fetch(`${baseUrl}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(runPayload(runId)),
  })
  await waitForRun(baseUrl, runId)

  const cancelledAt = performance.now()
  const cancelResponse = await fetch(`${baseUrl}/runs/${runId}/cancel`, { method: 'POST' })
  const cancellation = await cancelResponse.json()

  assert.equal(cancelResponse.status, 200)
  assert.ok(performance.now() - cancelledAt < 250)
  assert.deepEqual(cancellation.cleanupTimedOutRunIds, [runId])
  assert.ok(cancellation.runs[0].logs.some((log) => /等待脚本停止清理超过 25 ms/.test(log.message)))

  resolveExecution({ ok: true, durationMs: 50, logs: [], result: { ignoredAbort: true } })
  const runResponse = await runResponsePromise
  const result = await runResponse.json()
  assert.equal(result.ok, false)
  assert.equal(result.cancelled, true)
  assert.equal(result.status, 'interrupted')
})

test('an unexpected executor exception cannot leave a run marked as running', async (t) => {
  const server = createRunnerServer({
    executeScript: async () => {
      throw new Error('执行器意外异常')
    },
    validateRequest: (payload) => ({ scriptId: payload.scriptId }),
    runSnapshotTtlMs: 60_000,
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  const runId = 'run-throws-001'

  const response = await fetch(`${baseUrl}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(runPayload(runId)),
  })
  assert.equal(response.status, 400)

  const snapshot = await waitForRun(baseUrl, runId)
  assert.equal(snapshot.status, 'failed')
  assert.equal(snapshot.ok, false)
  assert.equal(snapshot.error, '执行器意外异常')
  assert.equal(snapshot.logs.at(-1)?.level, 'error')
})

test('serves persistent run-record CRUD, summaries, migration, and PATCH CORS', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'autotest-server-records-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const runRecordStore = new RunRecordFileStore({
    directory,
    now: () => new Date('2026-08-31T08:02:00.000Z'),
  })
  const { baseUrl } = await startTestServer(t, { runRecordStore })
  const record = storedRecord('stored-run-001', { data: 'x'.repeat(1024 * 1024 + 1024) })

  const createResponse = await fetch(`${baseUrl}/run-records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ record }),
  })
  assert.equal(createResponse.status, 201)
  assert.equal((await createResponse.json()).record.id, record.id)

  const listResponse = await fetch(`${baseUrl}/run-records`)
  const list = await listResponse.json()
  assert.equal(listResponse.status, 200)
  assert.equal(list.records.length, 1)
  assert.deepEqual(list.records[0].logs, [])
  assert.deepEqual(list.records[0].scripts[0].apiResponses, [])
  assert.equal(Object.hasOwn(list.records[0].scripts[0], 'output'), false)

  const detailResponse = await fetch(`${baseUrl}/run-records/${record.id}`)
  const detail = await detailResponse.json()
  assert.equal(detailResponse.status, 200)
  assert.equal(detail.record.scripts[0].apiResponses[0].responseBody.data.length, 1024 * 1024 + 1024)

  const updatedAt = '2026-08-31T08:01:00.000Z'
  const updated = {
    ...record,
    revision: 1,
    updatedAt,
    status: 'passed',
    finishedAt: updatedAt,
    durationMs: 60_000,
    counts: { total: 1, passed: 1, failed: 0, skipped: 0 },
    scripts: [{ ...record.scripts[0], status: 'passed', durationMs: 60_000 }],
    analysis: { ...record.analysis, passRate: 100, averageDurationMs: 60_000 },
  }
  const patchResponse = await fetch(`${baseUrl}/run-records/${record.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      record: updated,
      expectedRevision: record.revision,
      expectedUpdatedAt: record.updatedAt,
    }),
  })
  assert.equal(patchResponse.status, 200)
  assert.equal((await patchResponse.json()).record.revision, 1)

  const staleResponse = await fetch(`${baseUrl}/run-records/${record.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      record: updated,
      expectedRevision: record.revision,
      expectedUpdatedAt: record.updatedAt,
    }),
  })
  assert.equal(staleResponse.status, 409)

  const migrationRecord = storedRecord('stored-run-002')
  const migrationPayload = JSON.stringify({ records: [migrationRecord] })
  const firstMigration = await fetch(`${baseUrl}/run-records/migrations/local-storage-v1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: migrationPayload,
  })
  const secondMigration = await fetch(`${baseUrl}/run-records/migrations/local-storage-v1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: migrationPayload,
  })
  assert.deepEqual(await firstMigration.json(), {
    importedCount: 1,
    skippedCount: 0,
    importedIds: ['stored-run-002'],
    skippedIds: [],
  })
  assert.equal((await secondMigration.json()).skippedCount, 1)

  const optionsResponse = await fetch(`${baseUrl}/run-records`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://127.0.0.1:5174' },
  })
  assert.equal(optionsResponse.status, 204)
  assert.match(optionsResponse.headers.get('access-control-allow-methods') ?? '', /PATCH/)

  const unsafeIdResponse = await fetch(`${baseUrl}/run-records/%2Ftmp`)
  assert.equal(unsafeIdResponse.status, 400)
})

test('serves persistent script-config CRUD with CAS and DELETE CORS', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'autotest-server-script-configs-'))
  const scriptConfigDirectory = join(root, 'config', 'scripts')
  const scriptsDirectory = join(root, 'scripts')
  await mkdir(scriptsDirectory, { recursive: true })
  await writeFile(
    join(scriptsDirectory, 'server-script.ui.spec.mjs'),
    'export async function run() { return { ok: true } }\n',
  )
  t.after(() => rm(root, { recursive: true, force: true }))
  const { baseUrl } = await startTestServer(t, { scriptConfigDirectory, scriptsDirectory })
  const submitted = scriptConfigFixture()

  const createResponse = await fetch(`${baseUrl}/script-configs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script: submitted }),
  })
  const created = (await createResponse.json()).script
  assert.equal(createResponse.status, 201)
  assert.equal(created.id, submitted.id)
  assert.equal(created.revision, 0)
  assert.equal(Number.isFinite(Date.parse(created.updatedAt)), true)

  const listResponse = await fetch(`${baseUrl}/script-configs`)
  const list = await listResponse.json()
  assert.equal(listResponse.status, 200)
  assert.deepEqual(list.scripts.map(({ id }) => id), [submitted.id])

  const detailResponse = await fetch(`${baseUrl}/script-configs/${submitted.id}`)
  assert.equal(detailResponse.status, 200)
  assert.deepEqual((await detailResponse.json()).script, created)

  const patchResponse = await fetch(`${baseUrl}/script-configs/${submitted.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      script: { ...created, name: 'API 脚本配置已修改' },
      expectedRevision: created.revision,
      expectedUpdatedAt: created.updatedAt,
    }),
  })
  const updated = (await patchResponse.json()).script
  assert.equal(patchResponse.status, 200)
  assert.equal(updated.name, 'API 脚本配置已修改')
  assert.equal(updated.revision, 1)

  const stalePatchResponse = await fetch(`${baseUrl}/script-configs/${submitted.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      script: created,
      expectedRevision: created.revision,
      expectedUpdatedAt: created.updatedAt,
    }),
  })
  assert.equal(stalePatchResponse.status, 409)
  assert.equal((await stalePatchResponse.json()).code, 'SCRIPT_CONFIG_CONFLICT')

  const staleDeleteResponse = await fetch(`${baseUrl}/script-configs/${submitted.id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: created.revision,
      expectedUpdatedAt: created.updatedAt,
    }),
  })
  assert.equal(staleDeleteResponse.status, 409)

  const deleteResponse = await fetch(`${baseUrl}/script-configs/${submitted.id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: updated.revision,
      expectedUpdatedAt: updated.updatedAt,
    }),
  })
  assert.equal(deleteResponse.status, 204)
  assert.equal((await fetch(`${baseUrl}/script-configs/${submitted.id}`)).status, 404)

  const optionsResponse = await fetch(`${baseUrl}/script-configs`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://127.0.0.1:5174' },
  })
  assert.equal(optionsResponse.status, 204)
  assert.match(optionsResponse.headers.get('access-control-allow-methods') ?? '', /DELETE/)

  const unsafeIdResponse = await fetch(`${baseUrl}/script-configs/%2Ftmp`)
  assert.equal(unsafeIdResponse.status, 400)
})
