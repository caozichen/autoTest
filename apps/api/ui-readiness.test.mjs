import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { clickWhenReady, observeUiReadiness } from '../../scripts/support/ui-readiness.mjs'
import { runActionAndWaitForApiResponses } from '../../scripts/form-multilingual-translation-publish.ui.spec.mjs'

async function setup(t, handler) {
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  t.after(() => { server.closeAllConnections(); server.close() })
  const browser = await launchGoogleChrome()
  t.after(() => browser.close())
  const page = await browser.newPage()
  observeUiReadiness(page)
  return { page, origin }
}

test('click waits for response body and the handler installed after data arrives', async t => {
  const { page, origin } = await setup(t, (req, res) => {
    if (req.url === '/api/be/bootstrap') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{"ready":')
      setTimeout(() => res.end('true}'), 700)
    } else res.end(`<button onclick="window.early++">保存</button><script>
      window.early=0; window.saved=0;
      fetch('/api/be/bootstrap').then(r=>r.json()).then(()=>setTimeout(()=>{
        document.querySelector('button').onclick=()=>window.saved++
      },100))
    </script>`)
  })
  await page.goto(origin)
  await clickWhenReady(page.getByRole('button'))
  assert.deepEqual(await page.evaluate(() => [window.early, window.saved]), [0, 1])
})

test('visible loading mask and replacement button finish before a single click', async t => {
  const { page, origin } = await setup(t, (_req, res) => res.end(`<div class="arco-spin-mask">加载中</div><button onclick="window.early++">确认</button><script>
    window.early=0; window.saved=0;
    setTimeout(()=>{
      document.querySelector('button').outerHTML='<button onclick="window.saved++">确认</button>';
      document.querySelector('.arco-spin-mask').remove()
    },600)
  </script>`))
  await page.goto(origin)
  await clickWhenReady(page.getByRole('button'))
  assert.deepEqual(await page.evaluate(() => [window.early, window.saved]), [0, 1])
})

test('permanent busy state times out without clicking or retrying a write', async t => {
  const { page, origin } = await setup(t, (_req, res) => res.end('<div aria-busy="true">加载中</div><button onclick="window.saved=true">创建</button>'))
  await page.goto(origin)
  await assert.rejects(clickWhenReady(page.getByRole('button'), { timeout: 300 }), /操作前等待/)
  assert.equal(await page.evaluate(() => window.saved), undefined)
})

test('a hanging image does not prevent a ready business action', async t => {
  const { page, origin } = await setup(t, (req, res) => {
    if (req.url === '/image') return
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<img src="/image" width="1" height="1"><button onclick="window.saved=true">保存</button>')
  })
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await clickWhenReady(page.getByRole('button'), { timeout: 5000 })
  assert.equal(await page.evaluate(() => window.saved), true)
})

test('GET watcher ignores an unfinished duplicate and accepts the complete matching response', async t => {
  let requests = 0
  const { page, origin } = await setup(t, (req, res) => {
    if (req.url === '/api/be/form/example/translation') {
      res.writeHead(200, { 'content-type': 'application/json' })
      if (++requests === 1) res.write('{')
      else res.end('{"code":0,"data":{"fresh":true}}')
    } else res.end('<main>test</main>')
  })
  await page.goto(origin)
  const [response] = await runActionAndWaitForApiResponses(page, {
    method: 'GET', pathnameSuffix: '/be/form/example/translation', options: { timeout: 2000 },
  }, () => page.evaluate(() => {
    void fetch('/api/be/form/example/translation')
    setTimeout(() => void fetch('/api/be/form/example/translation'), 100)
  }))
  assert.equal((await response.json()).data.fresh, true)
})

test('navigation-scoped response watcher ignores a response from the previous document', async t => {
  const { page, origin } = await setup(t, (req, res) => {
    if (req.url.startsWith('/api/be/form/example/translation')) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ code: 0, data: { document: req.headers.referer?.endsWith('/next') ? 'next' : 'old' } }))
    } else if (req.url === '/next') res.end('<script>fetch("/api/be/form/example/translation")</script>')
    else res.end('<main>old</main>')
  })
  await page.goto(origin)
  const [response] = await runActionAndWaitForApiResponses(page, {
    method: 'GET', pathnameSuffix: '/be/form/example/translation', options: { afterNavigation: true, timeout: 3000 },
  }, async () => {
    await page.evaluate(() => fetch('/api/be/form/example/translation').then(r => r.json()))
    await page.goto(`${origin}/next`)
  })
  assert.equal((await response.json()).data.document, 'next')
})

test('target appearing after initial readiness triggers a second load check', async t => {
  const { page, origin } = await setup(t, (req, res) => {
    res.setHeader('content-type', req.url === '/api/be/deferred' ? 'application/json' : 'text/html; charset=utf-8')
    if (req.url === '/api/be/deferred') setTimeout(() => res.end('{}'), 600)
    else res.end(`<main></main><script>
      window.early=0; window.saved=0;
      setTimeout(()=>{
        document.querySelector('main').innerHTML='<button onclick="window.early++">保存</button>';
        fetch('/api/be/deferred').then(r=>r.json()).then(()=>{
          document.querySelector('button').onclick=()=>window.saved++
        })
      },500)
    </script>`)
  })
  await page.goto(origin)
  await clickWhenReady(page.getByRole('button'))
  assert.deepEqual(await page.evaluate(() => [window.early, window.saved]), [0, 1])
})

test('next action waits for an asynchronously scheduled load from the preceding click', async t => {
  const { page, origin } = await setup(t, (req, res) => {
    res.setHeader('content-type', req.url === '/api/be/deferred' ? 'application/json' : 'text/html; charset=utf-8')
    if (req.url === '/api/be/deferred') setTimeout(() => res.end('{}'), 500)
    else res.end(`<button id="open">打开</button><button id="save" onclick="window.early++">保存</button><script>
      window.early=0; window.saved=0;
      document.querySelector('#open').onclick=()=>setTimeout(()=>{
        fetch('/api/be/deferred').then(r=>r.json()).then(()=>{
          document.querySelector('#save').onclick=()=>window.saved++
        })
      },100)
    </script>`)
  })
  await page.goto(origin)
  await clickWhenReady(page.locator('#open'))
  await clickWhenReady(page.locator('#save'))
  assert.deepEqual(await page.evaluate(() => [window.early, window.saved]), [0, 1])
})
