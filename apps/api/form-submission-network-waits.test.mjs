import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import { run } from '../../scripts/form-all-fields-submit.ui.spec.mjs'
import { withEnvironmentTimeouts } from '../../scripts/support/environment-timeouts.mjs'
import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'
import { ONE_PIXEL_PNG } from './support/form-all-fields-submit-full-run-fixture.mjs'

async function fixture(t, { hangAt, onAreaRequest, withBackground = false } = {}) {
  const detailPath = '/form-activity/submission/preview/reply/existing-reply?fid=existing-form'
  const updatePath = '/api/be/form/existing-form/submission/existing-reply'
  const state = { documents: 0, updates: [], areaComplete: false, imageComplete: false, imageCompleteAtReload: false, backgroundOpened: 0 }
  const timers = new Set()
  const backgroundResponses = new Set()
  const holdBackground = (response, stream = false) => {
    state.backgroundOpened++
    response.writeHead(200, {
      'Content-Type': stream ? 'text/event-stream' : 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    response.flushHeaders()
    backgroundResponses.add(response)
  }
  let backgroundOrigin
  if (withBackground) {
    const backgroundServer = createServer((_request, response) => holdBackground(response))
    await new Promise(resolve => backgroundServer.listen(0, '127.0.0.1', resolve))
    backgroundOrigin = `http://127.0.0.1:${backgroundServer.address().port}`
    t.after(async () => {
      backgroundServer.closeAllConnections()
      await new Promise(resolve => backgroundServer.close(resolve))
    })
  }
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://fixture.local').pathname
    const sendJson = body => {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    if (pathname === '/api/stream') {
      holdBackground(response, true)
      return
    }
    if (pathname === '/api/area/tree' || pathname === '/saved.png') {
      const isArea = pathname === '/api/area/tree'
      response.writeHead(200, { 'Content-Type': isArea ? 'application/json' : 'image/png' })
      response.flushHeaders()
      if (isArea) onAreaRequest?.()
      if (hangAt === (isArea ? 'edit' : 'saved')) return
      const timer = setTimeout(() => {
        timers.delete(timer)
        if (isArea) state.areaComplete = true
        else state.imageComplete = true
        response.end(isArea ? '{"code":0,"data":[{"name":"地区选项"}]}' : ONE_PIXEL_PNG)
      }, 1400)
      timers.add(timer)
      return
    }
    if (request.method === 'PUT' && pathname === updatePath) {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      state.updates.push({ body: JSON.parse(Buffer.concat(chunks).toString()), areaComplete: state.areaComplete })
      for (const pending of backgroundResponses) pending.end('{}')
      backgroundResponses.clear()
      sendJson({ code: 0, data: { submission_id: 'existing-reply' } })
      return
    }
    if (pathname === detailPath.split('?')[0]) {
      if (++state.documents > 1) state.imageCompleteAtReload = state.imageComplete
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><html><head><link rel="icon" href="data:,"></head><body><main></main><script>
        const main = document.querySelector('main')
        const headers = { 'Content-Type': 'application/json', Authorization: localStorage.getItem('token') }
        function shell(body) {
          main.innerHTML = '<h2>慢请求提报</h2><span>已提交</span><h3>提报信息</h3>' + body
        }
        function detail(saved = false) {
          shell('<div class="reply-kv__row"><span class="reply-kv__label">姓名</span><span class="reply-kv__value">原姓名</span></div><button id="edit">编辑</button>')
          document.querySelector('#edit').onclick = edit
          if (saved) {
            // A resource started by the save result must finish before the deliberate reload.
            const image = new Image()
            image.src = '/saved.png'
            document.body.append(image)
          }
        }
        function edit() {
          shell('<section class="fb-p-4 fb-px-6"><div class="fb-runtime-field-heading">姓名</div><input value="原姓名"></section><button id="cancel">取消编辑</button><button id="submit">提交</button>')
          fetch('/api/area/tree', { headers }).then(r => r.json()).then(() => { window.areaReady = true })
          document.querySelector('#cancel').onclick = () => detail()
          document.querySelector('#submit').onclick = async () => {
            const answers = { name: document.querySelector('input').value }
            await fetch(${JSON.stringify(updatePath)}, { method: 'PUT', headers, body: JSON.stringify({ answers }) }).then(r => r.json())
            detail(true)
          }
        }
        ${withBackground && state.documents === 1 ? `
          fetch(${JSON.stringify(`${backgroundOrigin}/api/44/envelope/`)}).then(r => r.text())
          fetch('/api/stream', { headers }).then(r => r.text())
        ` : ''}
        detail()
      </script></body></html>`)
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    for (const timer of timers) clearTimeout(timer)
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  const api = []
  const resources = []
  const logs = []
  return {
    state, api, resources, logs,
    run: overrides => run({
      siteBaseUrl: origin, apiBaseUrl: `${origin}/api`, requestPath: detailPath,
      extraHTTPHeaders: { Authorization: 'Bearer fixture-token' },
      variables: { SUBMISSION_ASSERTIONS: JSON.stringify({ title: '慢请求提报', fields: { 姓名: '原姓名' } }) },
      logger: (level, message, details) => logs.push({ level, message, details }),
      recordApiResponse: entry => api.push(entry),
      recordResourceResponse: entry => resources.push(entry),
      captureFailureScreenshot: false,
      ...overrides,
    }),
  }
}

test('Hong Kong editing waits for the complete area body before saving and saved resources before reloading', async t => {
  const f = await fixture(t)
  const assertions = []
  const result = await withEnvironmentTimeouts('HK_PROD', () => runWithAssertionRecorder(
    'form-all-fields-submit', entry => assertions.push(entry), () => f.run(),
  ))
  assert.equal(result.submitted, true)
  assert.equal(result.reloaded, true)
  assert.deepEqual(f.state.updates, [{ body: { answers: { name: '原姓名' } }, areaComplete: true }])
  assert.equal(f.state.documents, 2)
  assert.equal(f.state.imageCompleteAtReload, true)
  assert.ok(f.api.some(entry => entry.url.endsWith('/api/area/tree') && entry.ok && entry.responseBody?.code === 0))
  assert.ok(f.resources.some(entry => entry.url.endsWith('/saved.png') && entry.ok))
  assert.equal([...f.api, ...f.resources].some(entry => !entry.ok || entry.incomplete), false)
  assert.deepEqual(assertions.filter(entry => entry.status === 'failed'), [])
})

test('third-party telemetry and fetch event streams do not block editing while their evidence remains recorded', async t => {
  const f = await fixture(t, { withBackground: true })
  const result = await f.run({ prerequisiteTimeoutMs: 3000 })
  assert.equal(result.submitted, true)
  assert.equal(result.reloaded, true)
  assert.equal(f.state.backgroundOpened, 2)
  assert.equal(f.state.updates.length, 1)
  assert.equal(f.state.updates[0].areaComplete, true)
  assert.equal(f.state.imageCompleteAtReload, true)
  assert.ok(f.api.some(entry => entry.url.endsWith('/api/44/envelope/')))
  assert.ok(f.api.some(entry => entry.url.endsWith('/api/stream')))
})

for (const stage of ['edit', 'saved']) {
  test(`unfinished ${stage} prerequisites stop subsequent actions and preserve HTTP 200 failure evidence`, async t => {
    const f = await fixture(t, { hangAt: stage })
    await assert.rejects(f.run({ prerequisiteTimeoutMs: stage === 'edit' ? 250 : 2000 }), /前置接口或资源.*未完成，已停止后续操作/)
    assert.equal(f.state.updates.length, stage === 'edit' ? 0 : 1, 'never submit early or repeat a saved update')
    assert.equal(f.state.documents, 1, 'never reload while a prerequisite is unfinished')
    const entry = stage === 'edit'
      ? f.api.find(entry => entry.url.endsWith('/api/area/tree'))
      : f.resources.find(entry => entry.url.endsWith('/saved.png'))
    assert.equal(entry?.status, 200)
    assert.equal(entry?.ok, false)
    assert.equal(entry?.incomplete, true)
    assert.equal(entry?.failureKind, 'timeout')
  })
}

test('cancelling a Hong Kong prerequisite wait promptly stops waiting and cleanup before saving', { timeout: 15_000 }, async t => {
  const controller = new AbortController()
  let cancellationTimer
  let cancelledAt
  const f = await fixture(t, {
    hangAt: 'edit',
    onAreaRequest: () => {
      cancellationTimer = setTimeout(() => {
        cancelledAt = performance.now()
        controller.abort(new Error('取消前置等待'))
      }, 200)
    },
  })
  t.after(() => clearTimeout(cancellationTimer))
  await withEnvironmentTimeouts('HK_PROD', () => assert.rejects(
    f.run({ signal: controller.signal }), /取消前置等待/,
  ))
  assert.equal(f.state.updates.length, 0)
  assert.equal(f.state.documents, 1)
  assert.ok(performance.now() - cancelledAt < 5000, 'cancellation must not wait through the 15-second network drain')
})
