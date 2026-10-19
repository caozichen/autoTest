import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import { attachNetworkObserver } from '../../scripts/support/api-response-recorder.mjs'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'

test('Chrome keeps fetched static JSON as resource evidence across language navigation, including HTTP failures', async t => {
  const regionPath = '/form-building/v0.0.5/area-tree.en-US.83295e280aec.json'
  const missingPath = '/assets/missing-regions.json'
  const businessPath = '/api/be/form/export.json'
  const requests = new Map()
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname
    requests.set(path, (requests.get(path) ?? 0) + 1)
    if ([regionPath, missingPath, businessPath].includes(path)) {
      response.writeHead(path === missingPath ? 404 : 200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(path === businessPath
        ? { code: 30001, message: '业务校验失败' }
        : { regions: [{ name: 'Hong Kong' }] }))
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(path === '/en' ? '<h1>English</h1>' : `<button>切换语言</button><script>
      document.querySelector('button').onclick = async () => {
        await Promise.all(${JSON.stringify([regionPath, missingPath])}.map(path => fetch(path).then(response => response.json())))
        location.assign('/en')
      }
    </script>`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  const browser = await launchGoogleChrome()
  t.after(() => browser.close())
  const context = await browser.newContext()
  const observer = attachNetworkObserver(context, { initialPhase: '切换语言' })
  t.after(() => observer.stop())
  await observer.ready
  const page = await context.newPage()
  const origin = `http://127.0.0.1:${server.address().port}`
  await page.goto(origin)
  // Check business JSON capture before navigating; only static resources are
  // intentionally raced with navigation, which can release Chrome's API body.
  await page.evaluate(async path => (await fetch(path)).json(), businessPath)
  assert.equal(await observer.waitForIdle({ timeoutMs: 2000 }), true)
  await page.getByRole('button', { name: '切换语言' }).click()
  await page.waitForURL(`${origin}/en`)
  const result = await observer.stop()

  const region = result.resources.find(entry => new URL(entry.url).pathname === regionPath)
  assert.ok(region)
  assert.equal(region.status, 200)
  assert.equal(region.ok, true)
  assert.equal(region.resourceType, 'fetch')
  assert.equal(region.phase, '切换语言')
  assert.equal(region.warning, undefined)
  assert.equal(region.bodyReadError, undefined)
  const missing = result.resources.find(entry => new URL(entry.url).pathname === missingPath)
  assert.equal(missing?.status, 404)
  assert.equal(missing?.ok, false)
  assert.equal(missing?.failureKind, 'http')
  assert.deepEqual(result.api.find(entry => new URL(entry.url).pathname === businessPath)?.responseBody,
    { code: 30001, message: '业务校验失败' })
  assert.equal(result.api.length, 1)
  assert.equal(result.summary.api.warnings, 0)
  for (const path of [regionPath, missingPath, businessPath]) assert.equal(requests.get(path), 1)
})
