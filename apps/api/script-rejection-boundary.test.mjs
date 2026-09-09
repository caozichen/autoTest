import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const fixturePath = fileURLToPath(
  new URL('./support/script-rejection-runner-fixture.mjs', import.meta.url),
)

function runPayload(runId, mode) {
  return {
    runId,
    scriptId: 'rejection-fixture',
    context: {
      siteBaseUrl: 'https://example.test/',
      apiBaseUrl: 'https://example.test/api',
      authorizationOrigin: 'https://example.test',
      extraHTTPHeaders: { Authorization: 'Bearer runner-rejection-test-token' },
      variables: { MODE: mode },
    },
  }
}

async function startFixture(t) {
  const child = fork(fixturePath, [], {
    execArgv: [],
    silent: true,
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr += chunk })

  const ready = await new Promise((resolve, reject) => {
    const onMessage = (message) => {
      if (message?.type !== 'ready') return
      child.off('exit', onExit)
      resolve(message)
    }
    const onExit = (code, signal) => {
      child.off('message', onMessage)
      reject(new Error(`Runner fixture exited before ready (code=${code}, signal=${signal}): ${stderr}`))
    }
    child.on('message', onMessage)
    child.once('exit', onExit)
  })

  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')
    child.send({ type: 'shutdown' })
    const forceTimer = setTimeout(() => child.kill('SIGKILL'), 1_000)
    forceTimer.unref?.()
    await exited
    clearTimeout(forceTimer)
  })

  return {
    baseUrl: `http://127.0.0.1:${ready.port}`,
    child,
    stderr: () => stderr,
  }
}

async function postRun(baseUrl, runId, mode) {
  const response = await fetch(`${baseUrl}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(runPayload(runId, mode)),
  })
  return { response, body: await response.json() }
}

async function waitForRun(baseUrl, runId) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(`${baseUrl}/runs/${encodeURIComponent(runId)}`)
    if (response.ok) return response.json()
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`运行任务 ${runId} 未进入 Runner`)
}

async function waitForRunLog(baseUrl, runId, message) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const snapshot = await waitForRun(baseUrl, runId)
    if (snapshot.logs.some((log) => log.message === message)) return snapshot
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`运行任务 ${runId} 未记录启动标记 ${message}`)
}

async function cancelRun(baseUrl, runId, reason) {
  const response = await fetch(`${baseUrl}/runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  })
  return { response, body: await response.json() }
}

async function expectHealthy(baseUrl) {
  const response = await fetch(`${baseUrl}/health`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    ok: true,
    service: 'autotest-playwright-runner',
  })
}

test('keeps Runner alive and isolates scoped and unscoped promise rejections', async (t) => {
  const fixture = await startFixture(t)

  const [leaking, concurrentHealthy] = await Promise.all([
    postRun(fixture.baseUrl, 'run-leak-001', 'watcher-first'),
    postRun(fixture.baseUrl, 'run-healthy-001', 'healthy-concurrent'),
  ])

  assert.equal(leaking.response.status, 200)
  assert.equal(leaking.body.ok, false)
  assert.equal(leaking.body.status, 'failed')
  assert.equal(leaking.body.cancelled, undefined)
  assert.equal(leaking.body.timedOut, undefined)
  assert.match(leaking.body.error, /watcher failed before action/)
  assert.ok(leaking.body.logs.some((log) => (
    log.level === 'error' && /未处理的异步错误终止/.test(log.message)
  )))

  assert.equal(concurrentHealthy.response.status, 200)
  assert.equal(concurrentHealthy.body.ok, true)
  assert.deepEqual(concurrentHealthy.body.result, {
    mode: 'healthy-concurrent',
    completed: true,
  })
  await expectHealthy(fixture.baseUrl)

  const unhandledFirstRequest = postRun(
    fixture.baseUrl,
    'run-unhandled-first-001',
    'watcher-first-cancel-later',
  )
  await waitForRun(fixture.baseUrl, 'run-unhandled-first-001')
  await new Promise((resolve) => setTimeout(resolve, 60))
  const [unhandledFirst, lateCancellation] = await Promise.all([
    unhandledFirstRequest,
    cancelRun(fixture.baseUrl, 'run-unhandled-first-001', 'late user cancellation'),
  ])
  assert.equal(unhandledFirst.body.ok, false)
  assert.equal(unhandledFirst.body.status, 'failed')
  assert.equal(unhandledFirst.body.cancelled, undefined)
  assert.match(unhandledFirst.body.error, /watcher won before user cancellation/)
  assert.equal(lateCancellation.response.status, 200)
  assert.equal(lateCancellation.body.runs[0].status, 'failed')

  const cancelFirstRequest = postRun(fixture.baseUrl, 'run-cancel-first-001', 'cancel-first')
  await waitForRunLog(fixture.baseUrl, 'run-cancel-first-001', 'cancel-first-started')
  const [cancelFirst, earlyCancellation] = await Promise.all([
    cancelFirstRequest,
    cancelRun(fixture.baseUrl, 'run-cancel-first-001', 'early user cancellation'),
  ])
  assert.equal(earlyCancellation.response.status, 200)
  assert.equal(cancelFirst.body.ok, false)
  assert.equal(cancelFirst.body.cancelled, true)
  assert.equal(cancelFirst.body.status, 'interrupted')
  assert.equal(cancelFirst.body.error, 'early user cancellation')
  await expectHealthy(fixture.baseUrl)

  const actionFirst = await postRun(fixture.baseUrl, 'run-action-001', 'action-first')
  assert.equal(actionFirst.body.ok, false)
  assert.match(actionFirst.body.error, /action failed first/)
  await new Promise((resolve) => setTimeout(resolve, 120))
  await expectHealthy(fixture.baseUrl)
  assert.match(fixture.stderr(), /UNHANDLED_REJECTION_LATE/)
  assert.doesNotMatch(fixture.stderr(), /TOP_SECRET/)

  const unscopedNotice = once(fixture.child, 'message')
  fixture.child.send({ type: 'trigger-unscoped-rejection' })
  const [message] = await unscopedNotice
  assert.equal(message.type, 'unscoped-rejection-triggered')
  await expectHealthy(fixture.baseUrl)
  assert.match(fixture.stderr(), /UNHANDLED_REJECTION_UNSCOPED/)
  assert.doesNotMatch(fixture.stderr(), /unscoped rejection contains/)

  const healthyAfterFailures = await postRun(
    fixture.baseUrl,
    'run-healthy-002',
    'healthy-after-failures',
  )
  assert.equal(healthyAfterFailures.response.status, 200)
  assert.equal(healthyAfterFailures.body.ok, true)
  assert.equal(fixture.child.exitCode, null)
})
