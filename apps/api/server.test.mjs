import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

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
  cancellationWaitTimeoutMs = 500,
  runRecordDirectory,
  scriptConfigDirectory,
  scriptsDirectory,
} = {}) {
  const server = createRunnerServer({
    executeScript: controlled.executeScript,
    validateRequest: (payload) => ({ scriptId: payload.scriptId }),
    runSnapshotTtlMs: 60_000,
    cancellationWaitTimeoutMs,
    ...(runRecordDirectory ? { runRecordDirectory } : {}),
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
  const { baseUrl } = await startTestServer(t, { runRecordDirectory: directory })
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
