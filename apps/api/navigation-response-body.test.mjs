import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { preserveMutationResponseBeforeNavigation, readResponseText } from '../../scripts/support/navigation-response-body.mjs'
import { attachNetworkObserver } from '../../scripts/support/api-response-recorder.mjs'

test('keeps original business and HTTP failures across a full navigation without repeating the POST', async t => {
  const browser = await launchGoogleChrome()
  t.after(() => browser.close())
  for (const [status, payload] of [[200, { code: 30001, message: '邮件内容不能为空' }], [503, { code: 50000, message: '服务不可用' }]]) {
    let posts = 0
    const path = '/api/f/form/navigation-fixture/submission'
    const server = createServer((request, response) => {
      if (request.method === 'POST' && request.url === path) {
        posts++
        response.writeHead(status, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify(payload))
      } else {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(request.url === '/landed' ? '<h1>结果页</h1>' : `<button>提交</button><script>
          document.querySelector('button').onclick = async () => {
            const result = await fetch('${path}', { method: 'POST', body: '{}' }).then(response => response.json())
            sessionStorage.setItem('actual-response', JSON.stringify(result))
            location.assign('/landed')
          }
        </script>`)
      }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    const context = await browser.newContext()
    const page = await context.newPage()
    const entries = []
    const observer = attachNetworkObserver(context, { onApiResponse: entry => entries.push(entry) })
    await observer.ready
    const stop = await preserveMutationResponseBeforeNavigation(page, { origin, path: '/f/form/navigation-fixture/submission' })
    try {
      await page.goto(origin)
      const responsePromise = page.waitForResponse(response => response.request().method() === 'POST')
        .then(response => ({ response }), error => ({ error }))
      await page.getByRole('button', { name: '提交' }).click()
      const captured = await responsePromise
      if (captured.error) throw captured.error
      const { response } = captured
      await page.waitForURL(`${origin}/landed`)
      assert.equal(response.status(), status)
      assert.deepEqual(JSON.parse(await readResponseText(response)), payload)
      assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem('actual-response'))), payload)
      await observer.stop()
      assert.equal(posts, 1)
      assert.deepEqual(entries.find(entry => entry.method === 'POST').responseBody, payload)
    } finally {
      await observer.stop()
      await stop()
      await context.close()
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
  }
})
