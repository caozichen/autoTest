import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test, { after, before } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { attachNetworkObserver } from '../../scripts/support/api-response-recorder.mjs'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { waitForPageResponsesBeforeNavigation } from '../../scripts/support/page-response-completion.mjs'

let browser
before(async () => { browser = await launchGoogleChrome() })
after(async () => { await browser?.close() })

async function fixture(t, routes) {
  const held = new Map()
  const requests = new Map()
  const completed = new Set()
  const navigationSnapshots = []
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://fixture.test').pathname
    const key = `${request.method} ${path}`
    requests.set(key, (requests.get(key) ?? 0) + 1)
    const route = routes[path]
    if (route) {
      held.set(path, response)
      response.statusCode = route.status ?? 200
      response.setHeader('Content-Type', route.contentType ?? 'application/json')
      if (!route.holdHeaders) response.flushHeaders()
      return
    }
    if (path === '/api/f/next-page') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ code: 0, data: 'next page was recorded' }))
      return
    }
    if (path === '/next') navigationSnapshots.push(new Set(completed))
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(`<link rel="icon" href="data:,"><h1>${path}</h1>${path === '/next'
      ? '<script>fetch("/api/f/next-page").then(response => response.json())</script>' : ''}`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const context = await browser.newContext()
  const entries = []
  const observer = attachNetworkObserver(context, {
    responseDrainTimeoutMs: 30,
    onNetworkEntry: entry => entries.push(entry),
  })
  t.after(async () => {
    await observer.stop({ discardPending: true, signal: AbortSignal.abort() })
    await context.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  await observer.ready
  const page = await context.newPage()
  await page.goto(origin)
  return {
    page, context, observer, origin, entries, requests, navigationSnapshots,
    release(path, body = routes[path].body ?? { code: 0, data: path }) {
      assert.ok(held.has(path), `fixture received ${path}`)
      completed.add(path)
      held.get(path).end(typeof body === 'string' ? body : JSON.stringify(body))
    },
  }
}

async function startFetches(page, paths) {
  const arrived = paths.map(({ path, holdHeaders }) => holdHeaders
    ? page.waitForRequest(request => new URL(request.url()).pathname === path)
    : page.waitForResponse(response => new URL(response.url()).pathname === path))
  await page.evaluate(items => {
    for (const { path, method = 'GET' } of items) {
      fetch(path, { method, ...(method === 'POST' ? { body: '{}' } : {}) })
        .then(response => response.text()).catch(() => {})
    }
  }, paths)
  await Promise.all(arrived)
}

async function assertPending(promise) {
  assert.equal(await Promise.race([promise.then(() => 'settled'), delay(35, 'pending')]), 'pending')
}

test('navigation drains delayed business JSON, static fetch and arrived AI JSON without adding requests, then keeps recording', async t => {
  const save = '/api/be/form/save'
  const regions = '/project/form-building/v0.0.5/area-tree.en-US.fixture.json'
  const poll = '/api/be/form/one/translation/ai/status'
  const f = await fixture(t, { [save]: {}, [regions]: {}, [poll]: {} })
  await startFetches(f.page, [{ path: save, method: 'POST' }, { path: regions }, { path: poll }])
  const warnings = []
  const navigation = (async () => {
    assert.equal(await waitForPageResponsesBeforeNavigation(f.page, f.observer, {
      origins: [f.origin], timeoutMs: 2000, logger: (...args) => warnings.push(args),
    }), true)
    await f.page.goto(`${f.origin}/next`)
  })()
  await assertPending(navigation)
  f.release(save)
  await assertPending(navigation)
  f.release(regions, { regions: ['Hong Kong'] })
  await assertPending(navigation)
  f.release(poll, { code: 0, data: { status: 'success' } })
  await navigation
  assert.equal(await f.observer.waitForIdle({ timeoutMs: 2000 }), true)
  const evidence = await f.observer.stop()

  assert.deepEqual(warnings, [])
  assert.deepEqual(f.navigationSnapshots, [new Set([save, regions, poll])])
  assert.deepEqual(evidence.api.find(entry => new URL(entry.url).pathname === save)?.responseBody,
    { code: 0, data: save })
  assert.deepEqual(evidence.api.find(entry => new URL(entry.url).pathname === poll)?.responseBody,
    { code: 0, data: { status: 'success' } })
  assert.deepEqual(evidence.api.find(entry => new URL(entry.url).pathname === '/api/f/next-page')?.responseBody,
    { code: 0, data: 'next page was recorded' })
  const region = evidence.resources.find(entry => new URL(entry.url).pathname === regions)
  assert.equal(region?.status, 200)
  assert.equal(region?.resourceType, 'fetch')
  assert.equal(evidence.api.some(entry => new URL(entry.url).pathname === regions), false)
  assert.equal(evidence.api.some(entry => entry.bodyReadError || entry.incomplete), false)
  assert.equal(evidence.summary.discardedPending, 0)
  assert.equal(f.requests.get(`POST ${save}`), 1)
  assert.equal([...f.requests.entries()].filter(([key]) => key.startsWith('POST ')).length, 1)
  for (const path of [regions, poll, '/api/f/next-page']) assert.equal(f.requests.get(`GET ${path}`), 1)
})

for (const [name, status, payload] of [
  ['HTTP failure', 500, { code: 50000, message: '服务失败' }],
  ['business failure', 200, { code: 30001, message: '业务校验失败' }],
]) test(`navigation preserves ${name} and its body without replaying the POST`, async t => {
  const path = '/api/be/form/save'
  const f = await fixture(t, { [path]: { status, body: payload } })
  await startFetches(f.page, [{ path, method: 'POST' }])
  const drain = waitForPageResponsesBeforeNavigation(f.page, f.observer, { origins: [f.origin], timeoutMs: 2000 })
  await assertPending(drain)
  f.release(path)
  assert.equal(await drain, true)
  await f.page.goto(`${f.origin}/next`)
  assert.equal(await f.observer.waitForIdle({ timeoutMs: 2000 }), true)
  const result = await f.observer.stop()
  const entry = result.api.find(entry => new URL(entry.url).pathname === path)
  assert.equal(entry.status, status)
  assert.equal(entry.ok, status < 400)
  assert.deepEqual(entry.responseBody, payload)
  assert.equal(entry.bodyReadError, undefined)
  assert.equal(entry.incomplete, undefined)
  if (status >= 400) assert.equal(entry.failureKind, 'http')
  assert.equal(f.requests.get(`POST ${path}`), 1)
})

test('navigation excludes another page, persistent streams, telemetry and AI polling without headers', async t => {
  const stream = '/api/f/events'
  const telemetry = '/telemetry'
  const poll = '/api/be/form/waiting/translation/ai/status'
  const other = '/api/f/other-page'
  const f = await fixture(t, {
    [stream]: { contentType: 'text/event-stream' }, [telemetry]: {},
    [poll]: { holdHeaders: true }, [other]: {},
  })
  const otherPage = await f.context.newPage()
  await otherPage.goto(f.origin)
  await startFetches(otherPage, [{ path: other }])
  await startFetches(f.page, [{ path: stream }, { path: telemetry }, { path: poll, holdHeaders: true }])
  const warnings = []
  assert.equal(await waitForPageResponsesBeforeNavigation(f.page, f.observer, {
    origins: [f.origin], timeoutMs: 150, logger: (...args) => warnings.push(args),
  }), true)
  assert.equal(f.observer.stopped, false)
  assert.deepEqual(warnings, [])
  // A scoped navigation wait must not discard unrelated in-flight evidence.
  const result = await f.observer.stop({ signal: AbortSignal.abort() })
  for (const path of [stream, telemetry, poll, other]) {
    const entry = result.api.find(candidate => new URL(candidate.url).pathname === path)
    assert.equal(entry?.incomplete, true, path)
    assert.equal(entry?.failureKind, 'aborted', path)
  }
  assert.equal(result.summary.discardedPending, 0)
})

test('navigation timeout is bounded, warns once and retains unfinished diagnostics', async t => {
  const path = '/api/be/form/hanging-save'
  const f = await fixture(t, { [path]: {} })
  await startFetches(f.page, [{ path, method: 'POST' }])
  const warnings = []
  const started = performance.now()
  assert.equal(await waitForPageResponsesBeforeNavigation(f.page, f.observer, {
    origins: [f.origin], timeoutMs: 60, logger: (...args) => warnings.push(args),
  }), false)
  assert.ok(performance.now() - started < 1000, 'timeout returns well before a hung response completes')
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0][0], 'warning')
  assert.equal(f.observer.stopped, false)
  const result = await f.observer.stop()
  const entry = result.api.find(candidate => new URL(candidate.url).pathname === path)
  assert.equal(entry?.status, 200)
  assert.equal(entry?.failureKind, 'timeout')
  assert.equal(entry?.incomplete, true)
  assert.deepEqual(entry?.requestBody, {})
  assert.equal(result.summary.discardedPending, 0)
  assert.equal(f.requests.get(`POST ${path}`), 1)
})

test('navigation cancellation rejects immediately and keeps the unfinished request as cancellation evidence', async t => {
  const path = '/api/be/form/hanging-save'
  const f = await fixture(t, { [path]: {} })
  await startFetches(f.page, [{ path, method: 'POST' }])
  const controller = new AbortController()
  const warnings = []
  const wait = waitForPageResponsesBeforeNavigation(f.page, f.observer, {
    origins: [f.origin], timeoutMs: 10_000, signal: controller.signal,
    logger: (...args) => warnings.push(args),
  })
  const reason = new Error('用户取消本批次')
  const started = performance.now()
  controller.abort(reason)
  await assert.rejects(wait, error => error === reason)
  assert.ok(performance.now() - started < 500)
  assert.equal(f.observer.stopped, false)
  assert.deepEqual(warnings, [])
  const result = await f.observer.stop({ signal: controller.signal })
  const entry = result.api.find(candidate => new URL(candidate.url).pathname === path)
  assert.equal(entry?.failureKind, 'aborted')
  assert.equal(entry?.incomplete, true)
  assert.equal(result.summary.discardedPending, 0)
  assert.equal(f.requests.get(`POST ${path}`), 1)
  await assert.rejects(waitForPageResponsesBeforeNavigation(f.page, f.observer, {
    origins: [f.origin], signal: controller.signal,
  }), error => error === reason)
})

test('navigation scope excludes superseded frames, foreign APIs and requests with no accessible page', async () => {
  const page = {}
  const origin = 'https://form.test'
  const base = {
    request: { frame: () => ({ page: () => page }) },
    category: 'api', resourceType: 'fetch', url: new URL(`${origin}/api/f/data`),
  }
  const observer = {
    async waitForIdle({ shouldWaitFor }) {
      assert.equal(shouldWaitFor(base), true)
      assert.equal(shouldWaitFor({ ...base, superseded: true }), false)
      assert.equal(shouldWaitFor({ ...base, category: 'resource', resourceType: 'eventsource' }), false)
      assert.equal(shouldWaitFor({ ...base, category: 'resource',
        responseHeaders: { 'content-type': 'text/event-stream' },
        url: new URL(`${origin}/project/form-building/events.json`) }), false)
      assert.equal(shouldWaitFor({ ...base, url: new URL('https://other.test/api/f/data') }), false)
      assert.equal(shouldWaitFor({ ...base, request: { frame: () => { throw new Error('worker') } } }), false)
      return true
    },
  }
  assert.equal(await waitForPageResponsesBeforeNavigation(page, observer, { origins: [origin] }), true)
})
