import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { inspectSettingsPreview } from '../../scripts/support/form-settings-preview.mjs'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'
import { ONE_PIXEL_PNG } from './support/form-all-fields-submit-full-run-fixture.mjs'

async function fixture(t, {
  businessCode = 0, apiBody, stylesheetStatus = 200, hangBody = false,
  background = false, closeStartsFailedResource = false, brokenFont = false,
} = {}) {
  const finished = new Set()
  const timers = new Set()
  const observed = []
  let origin
  let telemetryOrigin
  const telemetry = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    response.flushHeaders()
  })
  if (background) {
    await new Promise(resolve => telemetry.listen(0, '127.0.0.1', resolve))
    telemetryOrigin = `http://127.0.0.1:${telemetry.address().port}`
  }
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://fixture.local').pathname
    observed.push(path)
    if (path === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><html><head><link rel="icon" href="data:,"></head><body>
        <button id="preview">预览</button><script>
        document.querySelector('#preview').onclick = () => {
          document.body.insertAdjacentHTML('beforeend', '<aside class="settings-preview-drawer"><button class="arco-drawer-close-btn">关闭</button><form-renderer class="settings-preview-renderer"><div class="settings-preview-renderer"><div class="runtime-renderer">预览仅检查加载，无需填写</div></div></form-renderer></aside>')
          document.querySelector('.arco-drawer-close-btn').onclick = () => {
            window.closedAt = performance.now()
            ${closeStartsFailedResource ? "const lateStyle=document.createElement('link');lateStyle.rel='stylesheet';lateStyle.href='/late-failed.css';document.head.append(lateStyle)" : ''}
            document.querySelector('.settings-preview-drawer').remove()
          }
          fetch('/api/be/form/preview-fixture?draft=1').then(response => response.json()).catch(() => {})
          const script = document.createElement('script'); script.src='/renderer-chunk.js'; document.body.append(script)
          const style = document.createElement('link'); style.rel='stylesheet'; style.href='/preview.css'; document.head.append(style)
          ${background ? `fetch(${JSON.stringify(`${telemetryOrigin}/envelope/`)}).catch(() => {});fetch('/api/be/form/preview-fixture/translation/ai/status');fetch('/api/stream').then(r=>r.text())` : ''}
        }
        </script></body></html>`)
      return
    }
    if (path.endsWith('/translation/ai/status') || path === '/api/stream') {
      response.writeHead(200, { 'Content-Type': path === '/api/stream' ? 'text/event-stream' : 'application/json' })
      response.flushHeaders()
      return
    }
    const definitions = {
      '/api/be/form/preview-fixture': { type: 'application/json', body: apiBody ?? JSON.stringify({ code: businessCode, data: {} }), delay: 800 },
      '/renderer-chunk.js': { type: 'application/javascript', body: "const image=new Image();image.src='/preview-image.png';document.querySelector('.runtime-renderer').append(image)", delay: 600 },
      '/preview-image.png': { type: 'image/png', body: ONE_PIXEL_PNG, delay: 900 },
      '/preview.css': { type: 'text/css', body: `.runtime-renderer { min-height: 20px; }${brokenFont ? "@font-face{font-family:PreviewBroken;src:url('/broken-font.woff')}.runtime-renderer{font-family:PreviewBroken}" : ''}`, delay: 400, status: stylesheetStatus },
      '/late-failed.css': { type: 'text/css', body: '', delay: 400, status: 503 },
      '/broken-font.woff': { type: 'font/woff', body: 'not a font', delay: 100 },
    }
    const selected = definitions[path]
    if (!selected) { response.writeHead(404); response.end(); return }
    response.writeHead(selected.status ?? 200, { 'Content-Type': selected.type })
    response.flushHeaders()
    if (hangBody && path === '/api/be/form/preview-fixture') return
    const timer = setTimeout(() => {
      timers.delete(timer)
      finished.add(path)
      response.end(selected.body)
    }, selected.delay)
    timers.add(timer)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  const browser = await launchGoogleChrome()
  const page = await browser.newPage()
  const artifacts = []
  const assertions = []
  let screenshotFinished = []
  const artifactWriter = {
    writeFile: async (name, body) => { artifacts.push({ name, body }); return { absolutePath: `/fixture/${name}` } },
    captureScreenshot: async () => {
      screenshotFinished = [...finished]
      await page.screenshot()
      return { absolutePath: '/fixture/preview.png' }
    },
  }
  t.after(async () => {
    await browser.close()
    for (const timer of timers) clearTimeout(timer)
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    if (background) {
      telemetry.closeAllConnections()
      await new Promise(resolve => telemetry.close(resolve))
    }
  })
  await page.goto(`${origin}/?id=preview-fixture`)
  return {
    page, finished, observed, artifacts, assertions,
    screenshotFinished: () => screenshotFinished,
    run: options => runWithAssertionRecorder('form-all-fields-publish', assertion => assertions.push(assertion), () => (
      inspectSettingsPreview({ page, artifactWriter, timeoutMs: 5000, ...options })
    )),
  }
}

test('preview waits for complete API bodies and chained resources before screenshot/close, excluding background requests', async t => {
  const f = await fixture(t, { background: true })
  const result = await f.run()
  assert.equal(result.loaded, true)
  assert.equal(result.closed, true)
  assert.equal(result.apiCount, 1)
  assert.equal(result.resourceCount, 3)
  assert.equal(result.failedApiCount, 0)
  assert.equal(result.failedResourceCount, 0)
  assert.equal(result.failedApiBodyCount, 0)
  assert.equal(result.excludedStreamCount, 1)
  assert.equal(f.screenshotFinished().length, 4, 'API 正文、脚本、样式和脚本触发的图片全部完成后才能截图')
  assert.equal(await f.page.locator('.settings-preview-renderer').count(), 0)
  assert.equal(f.assertions.some(entry => entry.status === 'failed'), false)
  assert.equal(f.artifacts.length, 1)
  assert.ok(f.observed.includes('/api/be/form/preview-fixture/translation/ai/status'))
  assert.equal(result.api.some(entry => entry.path.includes('translation')), false)
})

test('preview business failures remain hard blockers even inside the soft assertion recorder', async t => {
  const f = await fixture(t, { businessCode: 40901 })
  await assert.rejects(f.run())
  assert.equal(await f.page.locator('.settings-preview-drawer:visible').count(), 1)
  assert.ok(f.assertions.some(entry => entry.status === 'failed' && entry.name.includes('业务码')))
  const evidence = JSON.parse(f.artifacts[0].body)
  assert.equal(evidence.failedApiCount, 1)
  assert.equal(evidence.api[0].businessCode, 40901)
})

test('preview rejects failed stylesheets after draining the remaining resources and retains the open drawer', async t => {
  const f = await fixture(t, { stylesheetStatus: 503 })
  await assert.rejects(f.run())
  assert.equal(await f.page.locator('.settings-preview-drawer:visible').count(), 1)
  assert.equal(f.screenshotFinished().length, 4)
  const evidence = JSON.parse(f.artifacts[0].body)
  assert.ok(evidence.resources.some(entry => entry.path === '/preview.css' && entry.status === 503 && !entry.ok))
})

test('preview never closes or passes when an HTTP 200 API response body remains unfinished', async t => {
  const f = await fixture(t, { hangBody: true })
  await assert.rejects(f.run({ timeoutMs: 1800 }))
  assert.equal(await f.page.locator('.settings-preview-drawer:visible').count(), 1)
  assert.equal(f.screenshotFinished().length, 0)
  assert.ok(f.assertions.some(entry => entry.status === 'failed' && entry.name.includes('全部完成加载')))
  const evidence = JSON.parse(f.artifacts[0].body)
  assert.equal(evidence.failedApiCount, 1)
  assert.equal(evidence.api[0].incomplete, true)
})

test('preview rejects malformed JSON even if the visible renderer mounted normally', async t => {
  const f = await fixture(t, { apiBody: '<html>Gateway failure</html>' })
  await assert.rejects(f.run())
  const evidence = JSON.parse(f.artifacts[0].body)
  assert.equal(evidence.failedApiBodyCount, 1)
  assert.equal(await f.page.locator('.settings-preview-drawer:visible').count(), 1)
})

test('preview inspects business status beyond the shared recorder body truncation limit', async t => {
  const f = await fixture(t, { apiBody: JSON.stringify({ data: 'x'.repeat(110000), code: 40901 }) })
  await assert.rejects(f.run())
  const evidence = JSON.parse(f.artifacts[0].body)
  assert.equal(evidence.failedApiBodyCount, 1)
  assert.equal(await f.page.locator('.settings-preview-drawer:visible').count(), 1)
})

test('preview keeps collecting errors from requests that start while the drawer closes', async t => {
  const f = await fixture(t, { closeStartsFailedResource: true })
  await assert.rejects(f.run())
  const evidence = JSON.parse(f.artifacts[0].body)
  assert.ok(evidence.resources.some(entry => entry.path === '/late-failed.css' && entry.status === 503 && !entry.ok))
  assert.equal(await f.page.locator('.settings-preview-drawer:visible').count(), 0)
  assert.ok(f.assertions.some(entry => entry.status === 'failed' && entry.name.includes('完整性检查')))
})

test('preview rejects an HTTP 200 font that the browser cannot decode', async t => {
  const f = await fixture(t, { brokenFont: true })
  await assert.rejects(f.run({ timeoutMs: 2400 }))
  assert.equal(await f.page.locator('.settings-preview-drawer:visible').count(), 1)
  assert.equal(f.screenshotFinished().length, 0)
  assert.ok(f.assertions.some(entry => entry.status === 'failed' && entry.name.includes('全部完成加载')))
})
