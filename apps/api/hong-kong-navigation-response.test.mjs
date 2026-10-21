import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test, { before, after } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { attachNetworkObserver } from '../../scripts/support/api-response-recorder.mjs'
import { createPageCompletionTracker, waitForPageResponsesBeforeNavigation } from '../../scripts/support/page-response-completion.mjs'
import { withEnvironmentTimeouts } from '../../scripts/support/environment-timeouts.mjs'

let browser
before(async () => { browser = await launchGoogleChrome() })
after(async () => { await browser?.close() })

const poll = '/api/be/form/slow/translation/ai/status'
const workspace = '/api/be/form/slow/translation'

async function fixture(t, { status = 200, body = { code: 0, data: { complete: true } }, startAiPoll = true } = {}) {
  const held = new Map()
  const receivedWaiters = new Map()
  const counts = new Map()
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://fixture.test').pathname
    counts.set(`${request.method} ${path}`, (counts.get(`${request.method} ${path}`) ?? 0) + 1)
    if ([poll, workspace].includes(path)) {
      // Deliberately withhold headers as on a slow Hong Kong connection.
      held.set(path, response)
      for (const resolve of receivedWaiters.get(path) ?? []) resolve()
      receivedWaiters.delete(path)
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end('<link rel="icon" href="data:,"><main>ready</main>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const context = await browser.newContext()
  const observer = attachNetworkObserver(context, { trackDocumentCommits: true, responseDrainTimeoutMs: 20 })
  t.after(async () => {
    await observer.stop({ discardPending: true, signal: AbortSignal.abort() })
    await context.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  await observer.ready
  const page = await context.newPage()
  await page.goto(origin)
  const received = path => held.has(path) ? Promise.resolve() : new Promise(resolve => {
    receivedWaiters.set(path, [...(receivedWaiters.get(path) ?? []), resolve])
  })
  if (startAiPoll) await page.evaluate(({ poll, workspace }) => {
    fetch(poll).then(response => response.json()).then(() => {
      // Model the application scheduling an additional workspace refresh after
      // the AI body has been processed, when a momentary idle check can pass.
      setTimeout(() => fetch(workspace).then(response => response.json()).catch(() => {}), 45)
    }).catch(() => {})
  }, { poll, workspace })
  if (startAiPoll) await received(poll)
  return {
    page, observer, origin, counts, received,
    release(path) {
      assert.ok(held.has(path), `server received ${path}`)
      held.get(path).writeHead(path === workspace ? status : 200, { 'Content-Type': 'application/json' })
      held.get(path).end(JSON.stringify(path === workspace ? body : { code: 0, data: { status: 4 } }))
    },
  }
}

async function assertPending(promise) {
  assert.equal(await Promise.race([promise.then(() => 'settled'), delay(30, 'pending')]), 'pending')
}

test('Hong Kong waits for an existing headerless poll and its delayed workspace refresh before navigating', async t => {
  const f = await fixture(t)
  const drain = waitForPageResponsesBeforeNavigation(f.page, f.observer, {
    origins: [f.origin], environmentCode: 'HK_PROD', quietMs: 100, timeoutMs: 3000,
  })
  await assertPending(drain)
  f.release(poll)
  await f.received(workspace)
  await assertPending(drain)
  f.release(workspace)
  assert.equal(await drain, true)
  await f.page.goto(`${f.origin}/next`)
  const evidence = await f.observer.stop()
  const ai = evidence.api.find(entry => new URL(entry.url).pathname === poll)
  const read = evidence.api.find(entry => new URL(entry.url).pathname === workspace)
  assert.equal(ai.responseBody.data.status, 4)
  assert.deepEqual(read.responseBody, { code: 0, data: { complete: true } })
  assert.ok(evidence.api.every(entry => entry.ok && !entry.incomplete && !entry.bodyReadError))
  assert.equal(f.counts.get(`GET ${poll}`), 1)
  assert.equal(f.counts.get(`GET ${workspace}`), 1)
  assert.equal([...f.counts.keys()].some(key => /^(POST|PUT|PATCH|DELETE) /.test(key)), false)
})

test('Hong Kong isolation keeps TEST and CN_PROD headerless polling behavior unchanged during concurrent waits', async t => {
  const [hk, cn, testEnvironment] = await Promise.all([fixture(t), fixture(t), fixture(t)])
  const wait = (f, environmentCode) => withEnvironmentTimeouts(environmentCode, () => waitForPageResponsesBeforeNavigation(f.page, f.observer, {
    origins: [f.origin], environmentCode, timeoutMs: 3000,
  }))
  const hkWait = wait(hk, 'HK_PROD')
  assert.deepEqual(await Promise.all([wait(cn, 'CN_PROD'), wait(testEnvironment, 'TEST')]), [true, true])
  await assertPending(hkWait)
  hk.release(poll)
  await hk.received(workspace)
  hk.release(workspace)
  assert.equal(await hkWait, true)
  assert.equal(cn.counts.has(`GET ${workspace}`), false)
  assert.equal(testEnvironment.counts.has(`GET ${workspace}`), false)
})

test('Hong Kong admin navigation drains the configured public-form origin before replacing its document', async t => {
  const f = await fixture(t, { startAiPoll: false })
  let publicResponse
  let onPublicRead
  let count = 0
  const arrived = new Promise(resolve => { onPublicRead = resolve })
  const server = createServer((request, response) => {
    assert.equal(request.method, 'GET')
    assert.equal(request.url, '/api/f/form/slow?only_form=1')
    count += 1
    publicResponse = response
    onPublicRead()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const publicOrigin = `http://127.0.0.1:${server.address().port}`
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  await f.page.evaluate(origin => {
    fetch(`${origin}/api/f/form/slow?only_form=1`).then(response => response.json()).catch(() => {})
  }, publicOrigin)
  await arrived
  const drain = waitForPageResponsesBeforeNavigation(f.page, f.observer, {
    origins: [f.origin, publicOrigin], environmentCode: 'HK_PROD', quietMs: 50, timeoutMs: 3000,
  })
  // Exceed the quiet window: an excluded origin would already let navigation
  // proceed, even though the public form response has not received headers.
  await delay(100)
  await assertPending(drain)
  publicResponse.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  publicResponse.end(JSON.stringify({ code: 0, data: { form_id: 'slow' } }))
  assert.equal(await drain, true)
  await f.page.goto(`${f.origin}/next`)
  const evidence = await f.observer.stop()
  const read = evidence.api.find(entry => entry.url.startsWith(publicOrigin))
  assert.deepEqual(read.responseBody, { code: 0, data: { form_id: 'slow' } })
  assert.equal(read.bodyReadError, undefined)
  assert.equal(read.incomplete, undefined)
  assert.equal(count, 1)
})

for (const [name, status, body] of [
  ['HTTP 500', 500, { code: 50000, message: '服务故障原文' }],
  ['business rejection', 200, { code: 30001, message: '业务拒绝原文' }],
]) test(`Hong Kong navigation retains ${name} from the follow-up GET without replaying it`, async t => {
  const f = await fixture(t, { status, body })
  const tracker = createPageCompletionTracker(f.page.context(), {
    origins: [f.origin], networkObserver: f.observer, trackDocumentCommits: true, timeoutMs: 1000,
  })
  t.after(() => tracker.dispose())
  const drain = waitForPageResponsesBeforeNavigation(f.page, f.observer, {
    origins: [f.origin], environmentCode: 'HK_PROD', quietMs: 100, timeoutMs: 3000,
  })
  f.release(poll)
  await f.received(workspace)
  f.release(workspace)
  assert.equal(await drain, true)
  await f.page.goto(`${f.origin}/next`)
  const evidence = await f.observer.stop()
  const entry = evidence.api.find(item => new URL(item.url).pathname === workspace)
  assert.equal(entry.status, status)
  assert.equal(entry.ok, status < 400)
  assert.deepEqual(entry.responseBody, body)
  assert.equal(entry.bodyReadError, undefined)
  assert.equal(f.counts.get(`GET ${workspace}`), 1)
  await assert.rejects(tracker.waitForPage(f.page), /必要接口正文、业务状态及资源必须完整成功/)
})

test('Hong Kong headerless wait is bounded and keeps the unfinished request as evidence', async t => {
  const f = await fixture(t)
  const warnings = []
  assert.equal(await waitForPageResponsesBeforeNavigation(f.page, f.observer, {
    origins: [f.origin], environmentCode: 'HK_PROD', timeoutMs: 70,
    logger: (...args) => warnings.push(args),
  }), false)
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0][0], 'warning')
  const evidence = await f.observer.stop()
  const entry = evidence.api.find(item => new URL(item.url).pathname === poll)
  assert.equal(entry.incomplete, true)
  assert.equal(entry.failureKind, 'timeout')
  assert.equal(entry.ok, false)
  assert.equal(f.counts.get(`GET ${poll}`), 1)
})

test('Hong Kong headerless wait responds to cancellation and preserves the original reason', async t => {
  const f = await fixture(t)
  const controller = new AbortController()
  const drain = waitForPageResponsesBeforeNavigation(f.page, f.observer, {
    origins: [f.origin], environmentCode: 'HK_PROD', timeoutMs: 3000, signal: controller.signal,
  })
  const reason = new Error('用户停止测试')
  controller.abort(reason)
  await assert.rejects(drain, error => error === reason)
  const evidence = await f.observer.stop({ signal: controller.signal })
  assert.equal(evidence.api.find(entry => new URL(entry.url).pathname === poll).failureKind, 'aborted')
  assert.equal(f.counts.get(`GET ${poll}`), 1)
})

test('Hong Kong close gate handles an old-page GET started while a new document navigation is pending', { timeout: 10_000 }, async t => {
  let releaseDocument
  let documentArrived
  let lateReadArrived
  const documentRequest = new Promise(resolve => { documentArrived = resolve })
  const lateReadRequest = new Promise(resolve => { lateReadArrived = resolve })
  const counts = new Map()
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://fixture.test').pathname
    counts.set(path, (counts.get(path) ?? 0) + 1)
    if (path === '/next') {
      releaseDocument = () => {
        response.writeHead(200, { 'Content-Type': 'text/html' })
        response.end('<link rel="icon" href="data:,"><main>new document</main>')
      }
      documentArrived()
    } else if (path === '/api/be/late-old-read') {
      lateReadArrived()
      // No response or headers. The old document is about to be replaced.
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end('<link rel="icon" href="data:,"><main>old document</main>')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const context = await browser.newContext()
  const observer = attachNetworkObserver(context, { trackDocumentCommits: true, responseDrainTimeoutMs: 30 })
  await observer.ready
  const page = await context.newPage()
  await page.goto(origin)
  const tracker = createPageCompletionTracker(context, {
    origins: [origin], networkObserver: observer, trackDocumentCommits: true, timeoutMs: 500,
  })
  t.after(async () => {
    await tracker.dispose()
    await observer.stop({ discardPending: true, signal: AbortSignal.abort() })
    await context.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  // Schedule from the old document before goto: Playwright evaluate waits for
  // an in-progress navigation, which would prevent this race from occurring.
  await page.evaluate(() => {
    setTimeout(() => { fetch('/api/be/late-old-read').catch(() => {}) }, 100)
  })
  const navigation = page.goto(`${origin}/next`, { timeout: 7000 })
  navigation.catch(() => {})
  await documentRequest
  await lateReadRequest
  releaseDocument()
  await navigation
  await tracker.waitForPage(page)
  assert.equal(counts.get('/api/be/late-old-read'), 1)
  assert.equal(counts.get('/next'), 1)
})
