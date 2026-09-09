import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import {
  attachApiResponseRecorder,
  attachNetworkObserver,
} from '../../scripts/support/api-response-recorder.mjs'

class FakeNetworkTarget extends EventEmitter {}

class FakePage extends EventEmitter {
  constructor(url = 'https://example.test/form/designer') {
    super()
    this.currentUrl = url
  }

  url() {
    return this.currentUrl
  }
}

class FakeContext extends EventEmitter {
  constructor(pages = [new FakePage()]) {
    super()
    this.currentPages = pages
    this.binding = null
    this.initScript = null
  }

  pages() {
    return this.currentPages
  }

  async exposeBinding(name, callback) {
    this.binding = { name, callback }
  }

  async addInitScript(script, argument) {
    this.initScript = { script, argument }
  }
}

function fakeRequest({
  method = 'GET',
  url = 'https://example.test/api/be/form?filter=active',
  body = null,
  contentType = 'application/json',
  resourceType = 'fetch',
  failure = null,
  navigation = false,
  pageUrl = 'https://example.test/form/designer',
  frameUrl = pageUrl,
  frame: suppliedFrame,
  redirectedFrom = null,
  redirectedTo = null,
} = {}) {
  const page = { url: () => pageUrl }
  const frame = suppliedFrame ?? { url: () => frameUrl, page: () => page }
  return {
    method: () => method,
    url: () => url,
    postData: () => body,
    headers: () => ({ 'content-type': contentType }),
    resourceType: () => resourceType,
    failure: () => failure,
    frame: () => frame,
    isNavigationRequest: () => navigation,
    redirectedFrom: () => redirectedFrom,
    redirectedTo: () => redirectedTo,
    response: async () => null,
  }
}

function fakeResponse(request, {
  status = 200,
  statusText = status >= 400 ? 'Failure' : 'OK',
  body = '{"code":0,"data":{"id":"form-1"}}',
  headers = { 'content-type': 'application/json' },
  fromServiceWorker = false,
} = {}) {
  const response = {
    request: () => request,
    status: () => status,
    statusText: () => statusText,
    ok: () => status >= 200 && status < 300,
    headers: () => headers,
    fromServiceWorker: () => fromServiceWorker,
    text: async () => body,
  }
  request.response = async () => response
  return response
}

function finish(target, request, response) {
  target.emit('request', request)
  target.emit('response', response)
  target.emit('requestfinished', request)
}

test('legacy recorder keeps API response and callable stop contract', async () => {
  const page = new FakeNetworkTarget()
  const responses = []
  const stop = attachApiResponseRecorder(page, {
    onApiResponse: (response) => responses.push(response),
    shouldRecord: ({ url }) => url.pathname.startsWith('/api/'),
  })
  const post = fakeRequest({
    method: 'POST',
    body: '{"title":"完整表单","mobile":"13671153204"}',
  })
  const get = fakeRequest()
  const staticRequest = fakeRequest({ resourceType: 'image', url: 'https://example.test/logo.png' })

  finish(page, post, fakeResponse(post))
  finish(page, get, fakeResponse(get, { body: '{"code":0,"data":[]}' }))
  finish(page, staticRequest, fakeResponse(staticRequest, { headers: { 'content-type': 'image/png' } }))
  stop.setPhase('发布表单')
  await stop()

  assert.equal(responses.length, 2)
  assert.deepEqual(responses[0].requestBody, { title: '完整表单', mobile: '13671153204' })
  assert.deepEqual(responses[0].responseBody, { code: 0, data: { id: 'form-1' } })
  assert.equal(responses[1].url, 'https://example.test/api/be/form?filter=active')
  assert.equal(Object.hasOwn(responses[1], 'requestBody'), false)
  assert.equal(typeof stop.stop, 'function')
})

test('context observer separates APIs and resources and snapshots request phase and location', async () => {
  const context = new FakeNetworkTarget()
  const apiResponses = []
  const resourceResponses = []
  const observer = attachNetworkObserver(context, {
    initialPhase: '页面初始化',
    onApiResponse: (entry) => apiResponses.push(entry),
    onResourceResponse: (entry) => resourceResponses.push(entry),
  })
  const apiRequest = fakeRequest({
    method: 'POST',
    body: 'title=%E8%A1%A8%E5%8D%95',
    contentType: 'application/x-www-form-urlencoded',
  })
  const scriptRequest = fakeRequest({
    method: 'HEAD',
    url: 'https://cdn.example.test/assets/designer.js',
    resourceType: 'script',
  })
  const ignoredDataRequest = fakeRequest({ url: 'data:image/png;base64,AA==', resourceType: 'image' })
  const ignoredBlobRequest = fakeRequest({ url: 'blob:https://example.test/id', resourceType: 'image' })

  finish(context, apiRequest, fakeResponse(apiRequest))
  observer.setPhase('设计器加载')
  const scriptResponse = fakeResponse(scriptRequest, {
    body: 'throw new Error("resource body must not be read")',
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cf-cache-status': 'HIT',
    },
    fromServiceWorker: true,
  })
  scriptResponse.text = () => {
    throw new Error('资源正文不应读取')
  }
  finish(context, scriptRequest, scriptResponse)
  context.emit('request', ignoredDataRequest)
  context.emit('request', ignoredBlobRequest)
  const result = await observer.stop()

  assert.equal(apiResponses.length, 1)
  assert.deepEqual(apiResponses[0].requestBody, { title: '表单' })
  assert.equal(apiResponses[0].phase, '页面初始化')
  assert.equal(apiResponses[0].pageUrl, 'https://example.test/form/designer')
  assert.equal(apiResponses[0].frameUrl, 'https://example.test/form/designer')
  assert.equal(resourceResponses.length, 1)
  assert.equal(resourceResponses[0].resourceType, 'script')
  assert.equal(resourceResponses[0].method, 'HEAD')
  assert.equal(resourceResponses[0].phase, '设计器加载')
  assert.equal(resourceResponses[0].mimeType, 'text/javascript')
  assert.equal(resourceResponses[0].fromCache, true)
  assert.equal(resourceResponses[0].cacheStatus, 'cf-cache-status:HIT')
  assert.equal(resourceResponses[0].fromServiceWorker, true)
  assert.equal(Object.hasOwn(resourceResponses[0], 'responseBody'), false)
  assert.deepEqual(result.api, apiResponses)
  assert.deepEqual(result.resources, resourceResponses)
  assert.equal(result.summary.api.succeeded, 1)
  assert.equal(result.summary.resources.succeeded, 1)
})

test('marks HTTP and transport failures while downgrading normal navigation aborts', async () => {
  const context = new FakeNetworkTarget()
  const observer = attachNetworkObserver(context)
  const httpFailure = fakeRequest({ url: 'https://example.test/missing.js', resourceType: 'script' })
  finish(context, httpFailure, fakeResponse(httpFailure, { status: 404, statusText: 'Not Found' }))

  const networkFailure = fakeRequest({
    method: 'POST',
    failure: { errorText: 'net::ERR_CONNECTION_RESET' },
  })
  context.emit('request', networkFailure)
  context.emit('requestfailed', networkFailure)

  const navigationAbort = fakeRequest({
    url: 'https://example.test/old-page',
    resourceType: 'document',
    navigation: true,
    failure: { errorText: 'net::ERR_ABORTED' },
  })
  context.emit('request', navigationAbort)
  context.emit('requestfailed', navigationAbort)
  const result = await observer.stop()

  const missingResource = result.resources.find((entry) => entry.status === 404)
  const ignoredNavigation = result.resources.find((entry) => entry.ignored)
  assert.equal(missingResource.ok, false)
  assert.equal(missingResource.failureKind, 'http')
  assert.equal(missingResource.error, 'HTTP 404 Not Found')
  assert.equal(result.api[0].status, 0)
  assert.equal(result.api[0].failureKind, 'network')
  assert.equal(result.api[0].error, 'net::ERR_CONNECTION_RESET')
  assert.equal(ignoredNavigation.ok, true)
  assert.equal(ignoredNavigation.ignored, true)
  assert.equal(ignoredNavigation.failureKind, 'aborted')
  assert.equal(result.summary.resources.failed, 1)
  assert.equal(result.summary.resources.ignored, 1)
  assert.equal(result.summary.resources.total, 1)
})

test('ignores an old-generation request aborted by a same-URL reload', async () => {
  const context = new FakeNetworkTarget()
  const observer = attachNetworkObserver(context)
  const page = { url: () => 'https://example.test/form/designer' }
  const frame = { url: () => page.url(), page: () => page }
  const oldResource = fakeRequest({
    url: 'https://example.test/assets/old.js',
    resourceType: 'script',
    frame,
    failure: { errorText: 'net::ERR_ABORTED' },
  })
  context.emit('request', oldResource)

  const reloadDocument = fakeRequest({
    url: page.url(),
    resourceType: 'document',
    navigation: true,
    frame,
  })
  finish(context, reloadDocument, fakeResponse(reloadDocument, {
    body: '<!doctype html>',
    headers: { 'content-type': 'text/html' },
  }))
  context.emit('requestfailed', oldResource)
  const result = await observer.stop()

  const aborted = result.resources.find((entry) => entry.url.endsWith('/assets/old.js'))
  assert.equal(aborted.ok, true)
  assert.equal(aborted.ignored, true)
  assert.equal(aborted.failureKind, 'aborted')
  assert.equal(result.summary.resources.ignored, 1)
  assert.equal(result.summary.resources.total, 1)
  assert.equal(result.summary.resources.succeeded, 1)
  assert.equal(result.summary.resources.failed, 0)
})

test('keeps normal redirect responses without treating them as health failures', async () => {
  const context = new FakeNetworkTarget()
  const observer = attachNetworkObserver(context)
  const destination = fakeRequest({ url: 'https://example.test/new', resourceType: 'document', navigation: true })
  const redirect = fakeRequest({
    url: 'https://example.test/old',
    resourceType: 'document',
    navigation: true,
    redirectedTo: destination,
  })
  finish(context, redirect, fakeResponse(redirect, { status: 302, statusText: 'Found', body: '' }))
  const result = await observer.stop()

  assert.equal(result.resources[0].status, 302)
  assert.equal(result.resources[0].ok, true)
  assert.equal(result.resources[0].redirectedTo, 'https://example.test/new')
  assert.equal(result.summary.resources.failed, 0)
})

test('keeps an unreadable successful API response body as capture diagnostics', async () => {
  const context = new FakeNetworkTarget()
  const apiResponses = []
  const observer = attachNetworkObserver(context, {
    onApiResponse: (entry) => apiResponses.push(entry),
  })
  const request = fakeRequest()
  const response = fakeResponse(request)
  response.text = async () => {
    throw new Error('Response body is not available for a response that was navigated away from')
  }

  finish(context, request, response)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(apiResponses.length, 1)
  const result = await observer.stop()

  assert.equal(result.api.length, 1)
  assert.equal(result.api[0].ok, true)
  assert.equal(Object.hasOwn(result.api[0], 'failureKind'), false)
  assert.match(result.api[0].bodyReadError, /navigated away/)
  assert.equal(result.api[0].incomplete, true)
  assert.equal(result.api[0].warning, true)
  assert.equal(result.summary.api.succeeded, 0)
  assert.equal(result.summary.api.failed, 0)
  assert.equal(result.summary.api.warnings, 1)
  assert.equal(result.summary.api.incomplete, 1)
})

test('keeps an unreadable HTTP error response as a hard failure', async () => {
  const context = new FakeNetworkTarget()
  const observer = attachNetworkObserver(context)
  const request = fakeRequest()
  const response = fakeResponse(request, { status: 503, statusText: 'Service Unavailable' })
  response.text = async () => { throw new Error('response body unavailable') }

  finish(context, request, response)
  const result = await observer.stop()

  assert.equal(result.api.length, 1)
  assert.equal(result.api[0].ok, false)
  assert.equal(result.api[0].failureKind, 'http')
  assert.equal(result.api[0].error, 'HTTP 503 Service Unavailable')
  assert.match(result.api[0].bodyReadError, /response body unavailable/)
  assert.equal(result.api[0].warning, undefined)
  assert.equal(result.summary.api.failed, 1)
  assert.equal(result.summary.api.warnings, 0)
})

test('keeps real diagnostics as failures when a successful response body is also unreadable', async () => {
  const page = new FakePage()
  const context = new FakeContext([page])
  const observer = attachNetworkObserver(context)
  await observer.ready
  const request = fakeRequest({ url: 'https://api.example.test/forms' })
  const response = fakeResponse(request)
  response.text = async () => { throw new Error('response body unavailable') }

  context.emit('request', request)
  context.emit('response', response)
  context.emit('console', {
    type: () => 'error',
    text: () => "Access to fetch at 'https://api.example.test/forms' has been blocked by CORS policy",
    location: () => ({ url: 'https://example.test/assets/app.js', lineNumber: 10 }),
    page: () => page,
  })
  context.emit('requestfinished', request)
  const result = await observer.stop()

  assert.equal(result.api.length, 1)
  assert.equal(result.api[0].ok, false)
  assert.equal(result.api[0].warning, undefined)
  assert.equal(result.api[0].failureKind, 'console')
  assert.match(result.api[0].bodyReadError, /response body unavailable/)
  assert.equal(result.summary.api.failed, 1)
  assert.equal(result.summary.api.warnings, 0)
})

test('classifies preflight and event streams as APIs without waiting for stream bodies', async () => {
  const context = new FakeNetworkTarget()
  const observer = attachNetworkObserver(context)
  const preflight = fakeRequest({
    method: 'OPTIONS',
    resourceType: 'other',
    url: 'https://api.example.test/forms',
  })
  finish(context, preflight, fakeResponse(preflight, { status: 204, body: '' }))

  const eventStream = fakeRequest({
    resourceType: 'eventsource',
    url: 'https://api.example.test/events',
  })
  const streamResponse = fakeResponse(eventStream, {
    headers: { 'content-type': 'text/event-stream' },
  })
  streamResponse.text = () => {
    throw new Error('不应读取 EventSource 长连接正文')
  }
  context.emit('request', eventStream)
  context.emit('response', streamResponse)
  const result = await observer.stop()

  assert.equal(result.api.length, 2)
  assert.equal(result.api.find((entry) => entry.url.endsWith('/forms')).method, 'OPTIONS')
  assert.equal(result.api.find((entry) => entry.url.endsWith('/events')).streaming, true)
  assert.equal(result.resources.length, 0)
})

test('ignores ordinary business console errors even when their source or text contains a URL', async () => {
  const page = new FakePage()
  const context = new FakeContext([page])
  const observer = attachNetworkObserver(context)
  await observer.ready

  context.emit('console', {
    type: () => 'error',
    text: () => '保存失败：业务校验未通过',
    location: () => ({
      url: 'https://example.test/assets/app.js',
      lineNumber: 42,
      columnNumber: 7,
    }),
    page: () => page,
  })
  context.emit('console', {
    type: () => 'error',
    text: () => '业务接口返回空数据 https://api.example.test/forms?page=1',
    location: () => ({
      url: 'https://example.test/assets/app.js',
      lineNumber: 43,
      columnNumber: 7,
    }),
    page: () => page,
  })
  const businessError = new TypeError('表单业务数据为空')
  businessError.stack = 'TypeError: 表单业务数据为空\n    at https://example.test/assets/app.js:88:12'
  page.emit('pageerror', businessError)
  const result = await observer.stop()

  assert.equal(result.api.length, 0)
  assert.equal(result.resources.length, 0)
})

test('correlates console CORS details with a generic transport failure by URL', async () => {
  const page = new FakePage()
  const context = new FakeContext([page])
  const observer = attachNetworkObserver(context)
  await observer.ready
  const request = fakeRequest({
    url: 'https://api.example.test/forms?page=1',
    failure: { errorText: 'net::ERR_FAILED' },
  })
  context.emit('request', request)
  context.emit('requestfailed', request)
  context.emit('console', {
    type: () => 'error',
    text: () => "Access to fetch at 'https://api.example.test/forms?page=1' has been blocked by CORS policy",
    location: () => ({ url: 'https://example.test/assets/app.js', lineNumber: 10 }),
    page: () => page,
  })
  const result = await observer.stop()

  assert.equal(result.api.length, 1)
  assert.equal(result.api[0].failureKind, 'console')
  assert.match(result.api[0].error, /ERR_FAILED/)
  assert.match(result.api[0].error, /CORS policy/)
  assert.equal(result.api[0].diagnostics.length, 1)
  assert.equal(result.resources.length, 0)
})

test('ignores report-only CSP diagnostics while enforced CSP remains a failure', async () => {
  const page = new FakePage()
  const context = new FakeContext([page])
  const observer = attachNetworkObserver(context)
  await observer.ready
  const source = {
    page,
    frame: { url: () => page.url() },
  }

  const reportOnlyRequest = fakeRequest({
    url: 'https://example.test/assets/report-only.js',
    resourceType: 'script',
  })
  context.emit('request', reportOnlyRequest)
  await context.binding.callback(source, {
    kind: 'csp',
    disposition: 'report',
    blockedUrl: reportOnlyRequest.url(),
    pageUrl: page.url(),
    message: `CSP Report-Only script-src 报告 ${reportOnlyRequest.url()}`,
  })
  const reportOnlyResponse = fakeResponse(reportOnlyRequest, {
    headers: { 'content-type': 'text/javascript' },
  })
  context.emit('response', reportOnlyResponse)
  context.emit('requestfinished', reportOnlyRequest)

  const enforcedRequest = fakeRequest({
    url: 'https://example.test/assets/enforced.js',
    resourceType: 'script',
    failure: { errorText: 'net::ERR_BLOCKED_BY_RESPONSE' },
  })
  context.emit('request', enforcedRequest)
  await context.binding.callback(source, {
    kind: 'csp',
    disposition: 'enforce',
    blockedUrl: enforcedRequest.url(),
    pageUrl: page.url(),
    message: `CSP script-src 拦截 ${enforcedRequest.url()}`,
  })
  context.emit('requestfailed', enforcedRequest)
  const result = await observer.stop()

  const reportOnly = result.resources.find((entry) => entry.url.endsWith('/assets/report-only.js'))
  const enforced = result.resources.find((entry) => entry.url.endsWith('/assets/enforced.js'))
  assert.equal(reportOnly.ok, true)
  assert.equal(Object.hasOwn(reportOnly, 'diagnostics'), false)
  assert.equal(enforced.ok, false)
  assert.equal(enforced.failureKind, 'csp')
  assert.match(enforced.error, /CSP script-src/)
})

test('ignores report-only CSP console messages while enforced console CSP remains a failure', async () => {
  const page = new FakePage()
  const context = new FakeContext([page])
  const observer = attachNetworkObserver(context)
  await observer.ready
  const consoleMessage = (text) => ({
    type: () => 'error',
    text: () => text,
    location: () => ({ url: page.url(), lineNumber: 0, columnNumber: 0 }),
    page: () => page,
  })

  context.emit('console', consoleMessage(
    "[Report Only] Refused to load the script 'https://example.test/assets/chrome-report.js' because it violates the following Content Security Policy directive: \"script-src 'none'\".",
  ))
  context.emit('console', consoleMessage(
    "Content-Security-Policy-Report-Only: The page's settings observed a resource at https://example.test/assets/firefox-report.js; a CSP report is being sent.",
  ))
  context.emit('console', consoleMessage(
    "Refused to load the script 'https://example.test/assets/enforced-console.js' because it violates the following Content Security Policy directive: \"script-src 'none'\".",
  ))
  const result = await observer.stop()

  assert.equal(result.resources.length, 1)
  assert.equal(result.resources[0].url, 'https://example.test/assets/enforced-console.js')
  assert.equal(result.resources[0].failureKind, 'csp')
})

test('classifies unassociated CORS and connect-src diagnostics as APIs', async () => {
  const page = new FakePage()
  const context = new FakeContext([page])
  const observer = attachNetworkObserver(context)
  await observer.ready
  const source = {
    page,
    frame: { url: () => page.url() },
  }

  context.emit('console', {
    type: () => 'error',
    text: () => "Access to fetch at 'https://third-party.example/api/forms' from origin 'https://example.test' has been blocked by CORS policy",
    location: () => ({ url: 'https://example.test/assets/app.js', lineNumber: 10 }),
    page: () => page,
  })
  await context.binding.callback(source, {
    kind: 'csp',
    disposition: 'enforce',
    directive: 'connect-src',
    blockedUrl: 'https://events.example.test/collect',
    pageUrl: page.url(),
    message: 'CSP connect-src 拦截 https://events.example.test/collect',
  })
  await context.binding.callback(source, {
    kind: 'csp',
    disposition: 'enforce',
    directive: 'script-src',
    blockedUrl: 'https://cdn.example.test/app.js',
    pageUrl: page.url(),
    message: 'CSP script-src 拦截 https://cdn.example.test/app.js',
  })
  const result = await observer.stop()

  assert.equal(result.api.length, 2)
  assert.deepEqual(result.api.map((entry) => entry.method), ['UNKNOWN', 'UNKNOWN'])
  assert.ok(result.api.some((entry) => entry.url === 'https://third-party.example/api/forms'))
  assert.ok(result.api.some((entry) => entry.url === 'https://events.example.test/collect'))
  assert.equal(result.resources.length, 1)
  assert.equal(result.resources[0].url, 'https://cdn.example.test/app.js')
  assert.equal(result.resources[0].resourceType, 'script')
})

test('captures injected resource and CSP errors plus page and WebSocket errors', async () => {
  const page = new FakePage()
  const context = new FakeContext([page])
  const observer = attachNetworkObserver(context)
  await observer.ready
  assert.ok(context.binding?.name.startsWith('__autoTestNetworkDiagnostic'))
  assert.equal(typeof context.initScript?.script, 'function')

  const source = {
    page,
    frame: { url: () => page.url() },
  }
  await context.binding.callback(source, {
    kind: 'resource',
    url: 'https://example.test/assets/blocked.js',
    tagName: 'SCRIPT',
    pageUrl: page.url(),
    message: '资源加载失败: SCRIPT https://example.test/assets/blocked.js',
  })
  await context.binding.callback(source, {
    kind: 'csp',
    blockedUrl: 'https://example.test/assets/blocked.js',
    pageUrl: page.url(),
    message: 'CSP script-src 拦截 https://example.test/assets/blocked.js',
  })
  const syntaxError = new SyntaxError('Unexpected token')
  syntaxError.stack = 'SyntaxError: Unexpected token\n    at https://example.test/assets/app.js:1:1'
  page.emit('pageerror', syntaxError)

  const socket = new EventEmitter()
  socket.url = () => 'wss://example.test/live'
  page.emit('websocket', socket)
  socket.emit('socketerror', 'net::ERR_CONNECTION_REFUSED')
  const result = await observer.stop()

  const blocked = result.resources.find((entry) => entry.url.endsWith('/assets/blocked.js'))
  const pageError = result.resources.find((entry) => entry.failureKind === 'pageerror')
  const webSocket = result.resources.find((entry) => entry.resourceType === 'websocket')
  assert.equal(blocked.failureKind, 'csp')
  assert.equal(blocked.resourceType, 'script')
  assert.equal(blocked.diagnostics.length, 2)
  assert.match(pageError.error, /Unexpected token/)
  assert.equal(webSocket.failureKind, 'websocket')
  assert.equal(webSocket.streaming, true)
})

test('seals unfinished requests at the deadline, removes listeners, and is idempotent', async () => {
  const context = new FakeNetworkTarget()
  const callbackErrors = []
  const onUnhandledRejection = (error) => callbackErrors.push(error)
  process.once('unhandledRejection', onUnhandledRejection)
  const observer = attachNetworkObserver(context, {
    responseDrainTimeoutMs: 20,
    onApiResponse: async () => {
      throw new Error('订阅者失败')
    },
  })
  const request = fakeRequest({ method: 'POST', body: '{"id":1}' })
  const response = fakeResponse(request)
  response.text = () => new Promise(() => undefined)
  context.emit('request', request)
  context.emit('response', response)
  context.emit('requestfinished', request)

  const startedAt = performance.now()
  const first = await observer.stop()
  const second = await observer.stop()

  assert.ok(performance.now() - startedAt < 250)
  assert.equal(first, second)
  assert.equal(first.api.length, 1)
  assert.equal(first.api[0].ok, false)
  assert.equal(first.api[0].failureKind, 'timeout')
  assert.equal(first.api[0].incomplete, true)
  assert.equal(first.summary.pendingAtSeal, 1)
  assert.equal(first.summary.api.incomplete, 1)
  assert.equal(context.listenerCount('request'), 0)
  assert.equal(context.listenerCount('response'), 0)
  assert.equal(context.listenerCount('requestfinished'), 0)
  assert.equal(context.listenerCount('requestfailed'), 0)
  await new Promise((resolve) => setImmediate(resolve))
  process.off('unhandledRejection', onUnhandledRejection)
  assert.deepEqual(callbackErrors, [])
})

test('can discard only unfinished requests during browser teardown', async () => {
  const context = new FakeNetworkTarget()
  const observer = attachNetworkObserver(context, { responseDrainTimeoutMs: 20 })
  const pendingRequest = fakeRequest({ url: 'https://example.test/api/background-poll' })
  context.emit('request', pendingRequest)

  const result = await observer.stop({ discardPending: true })

  assert.equal(result.summary.pendingAtSeal, 1)
  assert.equal(result.summary.discardedPending, 1)
  assert.equal(result.api.length, 0)
  assert.equal(result.resources.length, 0)
})

test('shouldRecord and subscriber exceptions never escape network event handlers', async () => {
  const context = new FakeNetworkTarget()
  const observer = attachNetworkObserver(context, {
    shouldRecord: ({ url }) => {
      if (url.pathname === '/throw') throw new Error('过滤器错误')
      return true
    },
    onResourceResponse: () => {
      throw new Error('订阅者错误')
    },
  })
  const ignored = fakeRequest({ url: 'https://example.test/throw', resourceType: 'image' })
  const recorded = fakeRequest({ url: 'https://example.test/logo.png', resourceType: 'image' })

  assert.doesNotThrow(() => context.emit('request', ignored))
  assert.doesNotThrow(() => finish(context, recorded, fakeResponse(recorded, {
    headers: { 'content-type': 'image/png' },
  })))
  const result = await observer.stop()

  assert.equal(result.resources.length, 1)
})
