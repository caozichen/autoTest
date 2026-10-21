import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { attachNetworkObserver } from '../../scripts/support/api-response-recorder.mjs'
import { createPageCompletionTracker, isRequiredPageRequest } from '../../scripts/support/page-response-completion.mjs'

async function fixture(t, { body = JSON.stringify({ code: 0, data: {} }), hang = false, background = false } = {}) {
  const timers = new Set()
  let bodyCompleted = false
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://fixture.test').pathname
    if (path === '/') {
      response.setHeader('Content-Type', 'text/html')
      response.end(`<link rel="icon" href="data:,"><main>Ready</main><script>
        fetch('/api/f/common/data').then(r => r.json()).catch(() => {})
        ${background ? "fetch('/api/f/stream');fetch('/api/be/form/one/translation/ai/status');fetch('/telemetry')" : ''}
      </script>`)
      return
    }
    response.setHeader('Content-Type', path.endsWith('/stream') ? 'text/event-stream' : 'application/json')
    response.flushHeaders()
    if (path !== '/api/f/common/data' || hang) return
    const timer = setTimeout(() => { timers.delete(timer); bodyCompleted = true; response.end(body) }, 450)
    timers.add(timer)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const browser = await launchGoogleChrome()
  const context = await browser.newContext()
  const observer = attachNetworkObserver(context, { responseDrainTimeoutMs: 50 })
  const tracker = createPageCompletionTracker(context, { origins: [origin], networkObserver: observer, timeoutMs: 1500 })
  t.after(async () => {
    await tracker.dispose()
    await observer.stop({ discardPending: true })
    await browser.close()
    timers.forEach(clearTimeout)
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  const page = await context.newPage()
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  return { page, tracker, bodyCompleted: () => bodyCompleted }
}

test('page close gate waits for a delayed dictionary body and excludes persistent streams, polls and telemetry', async t => {
  const f = await fixture(t, { background: true })
  assert.equal(f.bodyCompleted(), false)
  const evidence = await f.tracker.waitForPage(f.page)
  assert.equal(f.bodyCompleted(), true)
  assert.equal(evidence.apiCount, 1)
  await f.page.close()
})

test('validates complete large dictionaries rather than the truncated report representation', async t => {
  const f = await fixture(t, { body: JSON.stringify({ code: 0, data: '字典'.repeat(70_000) }) })
  assert.equal((await f.tracker.waitForPage(f.page)).apiCount, 1)
})

for (const [name, options] of [
  ['malformed JSON', { body: '{broken' }],
  ['business error in HTTP 200', { body: JSON.stringify({ code: 5001, data: {} }) }],
  ['business error beyond the report truncation boundary', { body: JSON.stringify({ data: '字典'.repeat(70_000), code: 5001 }) }],
  ['required response body timeout', { hang: true }],
]) test(`page close gate rejects ${name}`, async t => {
  const f = await fixture(t, options)
  await assert.rejects(f.tracker.waitForPage(f.page))
  assert.equal(f.page.isClosed(), false)
})

test('dictionary remains necessary while explicit streaming and AI polling are excluded', () => {
  const origins = new Set(['https://form.test'])
  const candidate = { url: new URL('https://form.test/api/f/common/data'), category: 'api', resourceType: 'fetch' }
  assert.equal(isRequiredPageRequest(candidate, origins), true)
  assert.equal(isRequiredPageRequest({ ...candidate, superseded: true }, origins), false)
  assert.equal(isRequiredPageRequest({ ...candidate, responseHeaders: { 'content-type': 'text/event-stream' } }, origins), false)
  assert.equal(isRequiredPageRequest({ ...candidate, url: new URL('https://telemetry.test/api/f/data') }, origins), false)
})
