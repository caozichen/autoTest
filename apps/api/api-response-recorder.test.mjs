import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { attachApiResponseRecorder } from '../../scripts/support/api-response-recorder.mjs'

class FakePage extends EventEmitter {}

function fakeRequest({
  method = 'GET',
  url = 'https://example.test/api/be/form?filter=active',
  body = null,
  contentType = 'application/json',
  resourceType = 'fetch',
  failure = null,
} = {}) {
  return {
    method: () => method,
    url: () => url,
    postData: () => body,
    headers: () => ({ 'content-type': contentType }),
    resourceType: () => resourceType,
    failure: () => failure,
  }
}

function fakeResponse(request, { status = 200, body = '{"code":0,"data":{"id":"form-1"}}' } = {}) {
  return {
    request: () => request,
    status: () => status,
    ok: () => status >= 200 && status < 300,
    headers: () => ({ 'content-type': 'application/json' }),
    text: async () => body,
  }
}

test('records fetch and xhr responses with POST bodies while keeping GET params in the URL', async () => {
  const page = new FakePage()
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

  page.emit('request', post)
  page.emit('response', fakeResponse(post))
  page.emit('request', get)
  page.emit('response', fakeResponse(get, { body: '{"code":0,"data":[]}' }))
  page.emit('request', staticRequest)
  page.emit('response', fakeResponse(staticRequest))
  await stop()

  assert.equal(responses.length, 2)
  assert.deepEqual(responses[0].requestBody, { title: '完整表单', mobile: '13671153204' })
  assert.deepEqual(responses[0].responseBody, { code: 0, data: { id: 'form-1' } })
  assert.equal(responses[1].url, 'https://example.test/api/be/form?filter=active')
  assert.equal(Object.hasOwn(responses[1], 'requestBody'), false)
})

test('records failed API requests that never receive a response', async () => {
  const page = new FakePage()
  const responses = []
  const stop = attachApiResponseRecorder(page, {
    onApiResponse: (response) => responses.push(response),
  })
  const request = fakeRequest({
    method: 'POST',
    failure: { errorText: 'net::ERR_CONNECTION_RESET' },
  })

  page.emit('request', request)
  page.emit('requestfailed', request)
  await stop()

  assert.equal(responses.length, 1)
  assert.equal(responses[0].status, 0)
  assert.equal(responses[0].ok, false)
  assert.equal(responses[0].error, 'net::ERR_CONNECTION_RESET')
})

test('stops waiting when a response body never finishes', async () => {
  const page = new FakePage()
  const stop = attachApiResponseRecorder(page, {
    onApiResponse: () => undefined,
    responseDrainTimeoutMs: 20,
  })
  const request = fakeRequest()
  const response = fakeResponse(request)
  response.text = () => new Promise(() => undefined)
  page.emit('request', request)
  page.emit('response', response)

  const startedAt = performance.now()
  await stop()

  assert.ok(performance.now() - startedAt < 250)
  assert.equal(page.listenerCount('request'), 0)
  assert.equal(page.listenerCount('response'), 0)
  assert.equal(page.listenerCount('requestfailed'), 0)
})
