import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { waitForDesignerBootstrap } from '../../scripts/form-all-fields-publish.ui.spec.mjs'
import { withEnvironmentTimeouts } from '../../scripts/support/environment-timeouts.mjs'

async function setup(t, handler) {
  const requests = []
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url })
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(handler(requests.length))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const browser = await launchGoogleChrome()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}/form-activity/designer?id=existing`)
  return { page, requests }
}
for (const environment of ['TEST', 'HK_PROD']) {
  test(`${environment}: reloads only the existing blank designer after an explicit load failure`, async t => {
    const { page, requests } = await setup(t, attempt => attempt === 1 ? '<p>页面加载失败，请稍后再试</p>' : '<button data-component-type="contactGroup">联系人</button>')
    await withEnvironmentTimeouts(environment, () => waitForDesignerBootstrap(page, () => {}, 3000))
    assert.ok(requests.every(request => request.method === 'GET'))
    assert.equal(requests.filter(request => request.url.includes('/designer')).length, 2)
    assert.match(page.url(), /id=existing$/)
  })
}
test('waits for a delayed healthy designer without reloading or creating another form', async t => {
  const { page, requests } = await setup(t, () => '<script>setTimeout(()=>document.body.innerHTML=\'<button data-component-type="contactGroup">联系人</button>\',500)</script>')
  await waitForDesignerBootstrap(page, () => {}, 3000)
  assert.equal(requests.filter(request => request.url.includes('/designer')).length, 1)
})
test('persistent load failure stops after one reload', async t => {
  const { page, requests } = await setup(t, () => '<p>页面加载失败，请稍后再试</p>')
  await assert.rejects(waitForDesignerBootstrap(page, () => {}, 3000), /初始化恢复未成功/)
  assert.equal(requests.filter(request => request.url.includes('/designer')).length, 2)
})
