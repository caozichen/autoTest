import assert from 'node:assert/strict'
import { EventEmitter, getEventListeners } from 'node:events'
import test from 'node:test'

import { attachNetworkObserver } from '../../scripts/support/api-response-recorder.mjs'

const origin = 'https://hong-kong.test'
const flush = () => new Promise(resolve => setImmediate(resolve))

class Page extends EventEmitter {
  constructor(path = '/translation') {
    super()
    this.address = `${origin}${path}`
    this.frame = { url: () => this.address, page: () => this }
  }
  url() { return this.address }
  commit(path = '/next') {
    this.address = `${origin}${path}`
    this.emit('framenavigated', this.frame)
  }
}

function request(page, { path = '/api/be/form/translation', navigation = false,
  redirectedFrom = null, method = 'GET', body = null } = {}) {
  return {
    url: () => `${origin}${path}`, resourceType: () => navigation ? 'document' : 'fetch',
    method: () => method, postData: () => body, headers: () => ({ 'content-type': 'application/json' }),
    frame: () => page.frame, isNavigationRequest: () => navigation,
    redirectedFrom: () => redirectedFrom, redirectedTo: () => null,
    failure: () => ({ errorText: 'net::ERR_ABORTED' }), response: async () => null,
  }
}

function respond(target, req, { status = 200, body = { code: 0 } } = {}) {
  const res = { request: () => req, headers: () => ({ 'content-type': 'application/json' }),
    status: () => status, statusText: () => status >= 400 ? 'Failure' : 'OK',
    text: async () => JSON.stringify(body) }
  target.emit('response', res)
}

function complete(target, req, options) {
  respond(target, req, options)
  target.emit('requestfinished', req)
}

async function pending(observer) {
  const entries = new Map()
  assert.equal(await observer.waitForIdle({ shouldWaitFor: candidate => {
    entries.set(candidate.request, candidate)
    return false
  } }), true)
  return entries
}

function observe(t, page, options = {}) {
  const observer = attachNetworkObserver(page, { responseDrainTimeoutMs: 0,
    includeResources: false, trackDocumentCommits: true, ...options })
  t.after(() => observer.stop({ discardPending: true, signal: AbortSignal.abort() }))
  return observer
}

test('Hong Kong commit tracking supersedes old-page reads started after navigation began, only when the new document commits', async t => {
  const page = new Page()
  const observer = observe(t, page)
  const old = request(page)
  page.emit('request', old)
  const navigation = request(page, { path: '/next', navigation: true })
  page.emit('request', navigation)
  const lateOld = request(page, { path: '/api/be/form/late-english' })
  page.emit('request', lateOld)
  let snapshot = await pending(observer)
  assert.equal(snapshot.get(old).superseded, false)
  assert.equal(snapshot.get(lateOld).superseded, false)
  respond(page, navigation)
  page.commit()
  const current = request(page, { path: '/api/be/form/current' })
  page.emit('request', current)
  snapshot = await pending(observer)
  assert.equal(snapshot.get(old).superseded, true)
  assert.equal(snapshot.get(lateOld).superseded, true)
  assert.equal(snapshot.get(current).superseded, false)
  // A stale read must stop blocking prerequisites without disappearing from the report.
  assert.equal(await observer.waitForIdle({ timeoutMs: 10,
    shouldWaitFor: candidate => candidate.request !== current && !candidate.superseded }), true)
  assert.equal(await observer.waitForIdle({ timeoutMs: 10,
    shouldWaitFor: candidate => !candidate.superseded }), false)
  const evidence = await observer.stop()
  assert.equal(evidence.api.length, 3)
  assert.equal(evidence.api.every(entry => entry.failureKind === 'timeout' && entry.incomplete), true)
  assert.equal(evidence.summary.discardedPending, 0)
})

test('document requests themselves stay in the current generation after redirects commit', async t => {
  const page = new Page()
  const observer = observe(t, page, { includeResources: true })
  const first = request(page, { navigation: true, path: '/redirect' })
  page.emit('request', first)
  const old = request(page)
  page.emit('request', old)
  const last = request(page, { navigation: true, path: '/next', redirectedFrom: first })
  page.emit('request', last)
  respond(page, last)
  page.commit('/next#section')
  const snapshot = await pending(observer)
  assert.equal(snapshot.get(old).superseded, true)
  assert.equal(snapshot.get(first).superseded, false)
  assert.equal(snapshot.get(last).superseded, false)
})

test('a reload of the same URL creates a new document while same-document routing keeps current requests required', async t => {
  const page = new Page()
  const observer = observe(t, page)
  const beforeRouting = request(page)
  page.emit('request', beforeRouting)
  page.commit('/translation#english')
  assert.equal((await pending(observer)).get(beforeRouting).superseded, false)
  page.commit('/translation')
  const reload = request(page, { navigation: true, path: '/translation' })
  page.emit('request', reload)
  const lateOld = request(page, { path: '/api/be/form/reload-old' })
  page.emit('request', lateOld)
  assert.equal((await pending(observer)).get(lateOld).superseded, false)
  respond(page, reload)
  page.commit('/translation')
  const current = request(page, { path: '/api/be/form/reload-current' })
  page.emit('request', current)
  const snapshot = await pending(observer)
  assert.equal(snapshot.get(beforeRouting).superseded, true)
  assert.equal(snapshot.get(lateOld).superseded, true)
  assert.equal(snapshot.get(current).superseded, false)
})

test('cancelled navigation does not supersede the surviving document or hide its hanging request', async t => {
  const page = new Page()
  const observer = observe(t, page)
  const current = request(page)
  page.emit('request', current)
  const nav = request(page, { path: '/next', navigation: true })
  page.emit('request', nav)
  page.emit('requestfailed', nav)
  // A router event following the cancellation must not consume an abandoned navigation.
  page.commit('/next')
  assert.equal((await pending(observer)).get(current).superseded, false)
  assert.equal(await observer.waitForIdle({ timeoutMs: 10,
    shouldWaitFor: candidate => !candidate.superseded }), false)
  const evidence = await observer.stop({ shouldWaitFor: candidate => !candidate.superseded })
  assert.equal(evidence.api[0].failureKind, 'timeout')
  assert.equal(evidence.api[0].incomplete, true)
  assert.equal(evidence.summary.discardedPending, 0)
})

test('same-document routing during a pending or non-committing navigation does not replace its request generation', async t => {
  const page = new Page()
  const observer = observe(t, page)
  const current = request(page)
  page.emit('request', current)
  const nav = request(page, { path: '/next', navigation: true })
  page.emit('request', nav)
  page.commit('/next#route')
  assert.equal((await pending(observer)).get(current).superseded, false,
    'a router event cannot commit a document request that has not received a response')
  respond(page, nav, { status: 204 })
  page.commit('/next#route-two')
  assert.equal((await pending(observer)).get(current).superseded, false,
    'a navigation response without a document cannot replace the existing document')
})

test('default observers retain request-start generations and do not install document listeners', async t => {
  const page = new Page()
  const observer = observe(t, page, { trackDocumentCommits: false })
  assert.equal(page.listenerCount('framenavigated'), 0)
  const old = request(page)
  page.emit('request', old)
  const nav = request(page, { navigation: true, path: '/next' })
  page.emit('request', nav)
  const late = request(page, { path: '/api/be/form/late' })
  page.emit('request', late)
  page.commit()
  const snapshot = await pending(observer)
  assert.equal(snapshot.get(old).superseded, true)
  assert.equal(snapshot.get(late).superseded, false)
})

test('commit-aware tracking keeps unfinished writes required and does not ignore their navigation-time aborts', async t => {
  const page = new Page()
  const observer = observe(t, page)
  const save = request(page, { method: 'PUT', body: '{"once":true}' })
  page.emit('request', save)
  const nav = request(page, { navigation: true, path: '/next' })
  page.emit('request', nav)
  const lateSave = request(page, { method: 'POST', path: '/api/be/form/late-save', body: '{"once":true}' })
  page.emit('request', lateSave)
  respond(page, nav)
  page.commit()
  const snapshot = await pending(observer)
  assert.equal(snapshot.get(save).superseded, false)
  assert.equal(snapshot.get(lateSave).superseded, false)
  assert.equal(await observer.waitForIdle({ timeoutMs: 10,
    shouldWaitFor: candidate => !candidate.superseded }), false)
  page.emit('requestfailed', lateSave)
  const evidence = await observer.stop({ shouldWaitFor: candidate => !candidate.superseded })
  const aborted = evidence.api.find(entry => entry.method === 'POST')
  assert.equal(aborted.ok, false)
  assert.equal(aborted.ignored, undefined)
  assert.equal(aborted.failureKind, 'aborted')
  assert.deepEqual(aborted.requestBody, { once: true })
  const unfinished = evidence.api.find(entry => entry.method === 'PUT')
  assert.equal(unfinished.failureKind, 'timeout')
  assert.equal(unfinished.incomplete, true)
  assert.equal(evidence.summary.discardedPending, 0)
})

test('commit tracking attaches to existing and future context pages even with resource capture disabled, then removes listeners', async () => {
  const first = new Page()
  const second = new Page()
  const context = new EventEmitter()
  context.pages = () => [first]
  const observer = attachNetworkObserver(context, { includeResources: false, trackDocumentCommits: true })
  assert.equal(first.listenerCount('framenavigated'), 1)
  context.emit('page', second)
  assert.equal(second.listenerCount('framenavigated'), 1)
  assert.equal(context.listenerCount('page'), 1)
  await observer.stop()
  assert.equal(first.listenerCount('framenavigated'), 0)
  assert.equal(second.listenerCount('framenavigated'), 0)
  assert.equal(context.listenerCount('page'), 0)
})

test('quiet window catches follow-up reads and unrelated telemetry or other pages do not reset it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const page = new Page()
  const other = new Page('/other')
  const observer = observe(t, page)
  await observer.ready
  let settled = false
  const wait = observer.waitForIdle({ quietMs: 50, timeoutMs: 500, shouldWaitFor: candidate =>
    candidate.request.frame().page() === page && !candidate.url.pathname.includes('/telemetry') })
    .then(value => { settled = true; return value })
  t.mock.timers.tick(40)
  await flush()
  assert.equal(settled, false)
  const followUp = request(page)
  page.emit('request', followUp)
  t.mock.timers.tick(40)
  await flush()
  assert.equal(settled, false)
  complete(page, followUp)
  await flush()
  t.mock.timers.tick(40)
  page.emit('request', request(page, { path: '/telemetry' }))
  page.emit('request', request(other))
  await flush()
  assert.equal(settled, false)
  t.mock.timers.tick(10)
  assert.equal(await wait, true)
})

test('document commits wake scoped waiters that were waiting for superseded requests', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const page = new Page()
  const observer = observe(t, page)
  const old = request(page)
  page.emit('request', old)
  const nav = request(page, { path: '/next', navigation: true })
  page.emit('request', nav)
  const wait = observer.waitForIdle({ quietMs: 50, timeoutMs: 500,
    shouldWaitFor: candidate => !candidate.superseded })
  respond(page, nav)
  page.commit()
  t.mock.timers.tick(50)
  assert.equal(await wait, true)
})

test('quiet waits have one overall deadline and remove abort listeners on timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const page = new Page()
  const observer = observe(t, page)
  const controller = new AbortController()
  let checks = 0
  const wait = observer.waitForIdle({ quietMs: 100, timeoutMs: 50, signal: controller.signal,
    shouldWaitFor: () => { checks += 1; return false } })
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1)
  t.mock.timers.tick(50)
  assert.equal(await wait, false)
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  const previousChecks = checks
  page.emit('request', request(page))
  t.mock.timers.tick(100)
  assert.equal(checks, previousChecks, 'timed-out wait no longer observes events')
})

test('cancelling a quiet wait rejects immediately and removes timers and abort listeners', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const page = new Page()
  const observer = observe(t, page)
  const controller = new AbortController()
  let checks = 0
  const wait = observer.waitForIdle({ quietMs: 500, timeoutMs: 10_000, signal: controller.signal,
    shouldWaitFor: () => { checks += 1; return false } })
  const reason = new Error('cancelled by user')
  const rejection = assert.rejects(wait, error => error === reason)
  controller.abort(reason)
  await rejection
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  const previousChecks = checks
  page.emit('request', request(page))
  t.mock.timers.tick(10_000)
  assert.equal(checks, previousChecks, 'cancelled wait no longer observes events')
})

test('commit-aware tracking preserves the original HTTP and business failure bodies without emitting or replaying requests', async t => {
  const page = new Page()
  const observer = observe(t, page)
  const sent = []
  page.on('request', req => sent.push(req))
  const payloads = [{ status: 500, body: { code: 50001, message: 'server failure' } },
    { status: 200, body: { code: 30001, message: 'business failure' } }]
  for (const payload of payloads) {
    const req = request(page, { method: 'POST', body: '{"once":true}' })
    page.emit('request', req)
    complete(page, req, payload)
  }
  await flush()
  const evidence = await observer.stop()
  assert.equal(sent.length, 2)
  assert.equal(evidence.api.length, 2)
  for (const payload of payloads) {
    const entry = evidence.api.find(candidate => candidate.status === payload.status)
    assert.deepEqual(entry.responseBody, payload.body)
    assert.deepEqual(entry.requestBody, { once: true })
    assert.equal(entry.ok, payload.status < 400)
    assert.equal(entry.bodyReadError, undefined)
  }
})
