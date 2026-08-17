import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { once } from 'node:events'
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
} = {}) {
  const server = createRunnerServer({
    executeScript: controlled.executeScript,
    validateRequest: (payload) => ({ scriptId: payload.scriptId }),
    runSnapshotTtlMs: 60_000,
    cancellationWaitTimeoutMs,
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
