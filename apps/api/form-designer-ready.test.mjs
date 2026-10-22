import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { observeUiReadiness } from '../../scripts/support/ui-readiness.mjs'
import { waitForDesignerBootstrap } from '../../scripts/form-all-fields-publish.ui.spec.mjs'

async function setup(t, { legacy = false, lock = 'inert aria-busy="true"', fail = false, hang = false } = {}) {
  let documents = 0
  const server = createServer((request, response) => {
    if (request.url === '/favicon.ico') return response.writeHead(204).end()
    if (request.url === '/api/be/form/item-types') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.write('{"ready":')
      setTimeout(() => response.end('true}'), 600)
      return
    }
    documents++
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(`<!doctype html><form-designer><section ${lock}>
      <button data-component-type="contactGroup">联系人</button>
      <h1><div contenteditable="true">原始标题</div></h1>
    </section></form-designer><script>
      const designer = document.querySelector('form-designer');
      const section = designer.querySelector('section');
      const title = designer.querySelector('[contenteditable]');
      window.events = []; window.titleModel = title.textContent;
      title.addEventListener('input', () => {
        window.events.push('input'); window.titleModel = title.textContent;
      });
      title.addEventListener('blur', () => window.events.push('blur'));
      const ready = fetch('/api/be/form/item-types').then(r => r.json()).then(() => {
        if (${hang}) return new Promise(() => {});
        if (${fail}) throw new Error('题型初始化失败');
        return new Promise(resolve => setTimeout(() => {
          section.removeAttribute('inert'); section.removeAttribute('aria-busy');
          window.events.push('ready'); resolve();
        }, 150));
      });
      ready.catch(() => {});
      if (!${legacy}) designer.whenReady = () => { window.readyCalled = true; return ready; };
    </script>`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const browser = await launchGoogleChrome()
  t.after(() => browser.close())
  const page = await browser.newPage()
  observeUiReadiness(page)
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' })
  return { page, documents: () => documents }
}

test('visible palette waits for whenReady, full response body and inert release before editing', async t => {
  const { page, documents } = await setup(t)
  assert.equal(await page.locator('[data-component-type]').isVisible(), true)
  assert.equal(await page.locator('section').getAttribute('inert'), '')
  const title = page.locator('h1 [contenteditable]')
  // Reproduce the old sequence: fill() returns while the inert editor ignores
  // its text insertion, so visibility alone does not establish readiness.
  await title.fill('提前输入不应生效')
  await title.blur()
  assert.equal(await page.evaluate(() => window.titleModel), '原始标题')
  assert.equal(await title.textContent(), '原始标题')
  await waitForDesignerBootstrap(page, () => {}, 5000)
  await title.fill('原始标题 - 已修改')
  await title.blur()
  assert.deepEqual(await page.evaluate(() => ({
    readyCalled: window.readyCalled, events: window.events, title: window.titleModel,
  })), { readyCalled: true, events: ['ready', 'input', 'blur'], title: '原始标题 - 已修改' })
  assert.equal(documents(), 1)
})

for (const lock of ['inert', 'aria-busy="true"']) {
  test(`legacy designer without whenReady still waits for ${lock}`, async t => {
    const { page, documents } = await setup(t, { legacy: true, lock })
    await waitForDesignerBootstrap(page, () => {}, 5000)
    assert.deepEqual(await page.evaluate(() => window.events), ['ready'])
    assert.equal(await page.locator('section').getAttribute(lock === 'inert' ? 'inert' : 'aria-busy'), null)
    assert.equal(documents(), 1)
  })
}

test('initialization rejection stops before editing and never reloads the existing form', async t => {
  const { page, documents } = await setup(t, { fail: true })
  await assert.rejects(waitForDesignerBootstrap(page, () => {}, 5000), /题型初始化失败/)
  assert.deepEqual(await page.evaluate(() => window.events), [])
  assert.equal(await page.locator('h1 [contenteditable]').textContent(), '原始标题')
  assert.equal(documents(), 1)
})

test('a stuck whenReady obeys the shared timeout without editing or reloading', async t => {
  const { page, documents } = await setup(t, { hang: true })
  await assert.rejects(waitForDesignerBootstrap(page, () => {}, 1200), /whenReady 初始化完成超时/)
  assert.deepEqual(await page.evaluate(() => window.events), [])
  assert.equal(documents(), 1)
})
