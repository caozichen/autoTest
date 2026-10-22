import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { clickWhenReady, observeUiReadiness } from '../../scripts/support/ui-readiness.mjs'
import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'
import {
  openFormSettingsMenu,
  openFormSettingsStep,
  publishFormFromDesigner,
  reloadSavedFormPage,
} from '../../scripts/support/form-navigation.mjs'

const LABELS = {
  cn: ['基础设置', '消息及触达', '分享与传播', '保存并切换', '保存后发布', '发布'],
  hk: ['基礎設定', '訊息及觸達', '分享與傳播', '儲存並切換', '儲存後發佈', '發佈'],
  en: ['Basic Settings', 'Messages & Outreach', 'Sharing & Distribution', 'Save and switch', 'Save and publish', 'Publish'],
}

// Only local pages and local fake endpoints; running these tests still uses installed Chrome.
async function setup(t, options = {}) {
  const writes = []
  let documents = 0
  const fixture = { locale: 'cn', delay: 400, ...options }
  const server = createServer(async (request, response) => {
    if (request.url === '/favicon.ico') {
      response.writeHead(204).end()
      return
    }
    if (request.url.startsWith('/api/be/form/nav1/')) {
      let raw = ''
      for await (const chunk of request) raw += chunk
      const kind = request.url.split('/').at(-1)
      writes.push({ kind, method: request.method, payload: JSON.parse(raw) })
      const code = fixture.failure === kind ? 40901 : 0
      const body = { code, message: code ? '编辑冲突，禁止覆盖' : 'OK', data: {
        form_id: 'nav1', revision_no: 1,
        edit_token: ({ items: 'b', config: 'c', publish: 'd' }[kind]).repeat(64),
        ...(kind === 'publish' ? { status: 'published' } : {}),
      } }
      response.writeHead(200, { 'content-type': 'application/json' })
      // Leave the original modal visible while both save responses finish.
      setTimeout(() => response.end(JSON.stringify(body)), 120)
      return
    }
    documents += 1
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(`<!doctype html><html><body>
      <form-designer></form-designer>
      <button id="activate">Interact</button>
      <div class="form-activity-step-nav"></div>
      <div id="menus"></div><div id="panel"></div>
      <button id="publish"></button>
      <script>
        const fixture = ${JSON.stringify(fixture)};
        const labels = ${JSON.stringify(LABELS)}[fixture.locale];
        const initialDesigner = location.pathname.endsWith('/designer');
        let token = 'a'.repeat(64);
        let active = initialDesigner ? 'designer' : 'form';
        window.navClicks = 0; window.confirmClicks = 0; window.publishClicks = 0;
        document.querySelector('form-designer').getHasUnsavedChanges = () => Boolean(fixture.dirtyReload);
        if (fixture.nativeDirty) addEventListener('beforeunload', event => {
          event.preventDefault(); event.returnValue = '';
        });
        function panel(key) {
          active = key;
          document.querySelector('#panel').innerHTML = key === 'share'
            ? '<div class="share-link-channel-card">Default channel</div>'
            : '<div id="ready-' + key + '">' + key + '</div>';
        }
        panel(active);
        function arrive(target) {
          const step = ['message', 'share'].includes(target) ? '&step=' + target : '';
          history.pushState({}, '', '/form-activity/settings?id=nav1' + step);
          panel(target === 'settings' ? 'form' : target);
        }
        async function write(kind) {
          const body = await fetch('/api/be/form/nav1/' + kind, {
            method: kind === 'publish' ? 'POST' : 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ expected_edit_token: fixture.staleToken && kind === 'config' ? 'a'.repeat(64) : token }),
          }).then(response => response.json());
          if (body.code !== 0) return false;
          token = body.data.edit_token;
          return true;
        }
        async function publish() {
          if (await write('publish')) {
            document.querySelector('.arco-modal')?.remove();
            history.pushState({}, '', '/form-activity/list');
            panel('published');
          }
        }
        function confirm(target, publishing) {
          const modal = document.createElement('div');
          modal.className = 'arco-modal';
          const button = document.createElement('button');
          button.textContent = labels[publishing ? 4 : 3];
          modal.append(button); document.body.append(modal);
          button.onclick = async () => {
            window.confirmClicks++;
            if (fixture.validationFailure) return;
            if (fixture.closeBeforeSave) modal.remove();
            if (initialDesigner && !await write('items')) return;
            if (!fixture.omitConfig && !await write('config')) return;
            if (fixture.newChanges) { modal.remove(); return; }
            if (fixture.repeatDialog) {
              modal.remove(); setTimeout(() => confirm(target, publishing), 350); return;
            }
            if (publishing) await publish();
            else { modal.remove(); arrive(target); }
          };
        }
        function navigate(target) {
          window.navClicks++;
          if (active === target || target === 'settings' && active === 'form') return;
          if (fixture.dirty) setTimeout(() => confirm(target, false), fixture.delay);
          else arrive(target);
        }
        ['settings', 'message', 'share'].forEach((target, index) => {
          const button = document.createElement('button');
          button.className = 'form-activity-step';
          button.textContent = (index + 2) + ' ' + labels[index];
          button.onclick = () => navigate(target);
          document.querySelector('.form-activity-step-nav').append(button);
        });
        ['form', 'permission', 'collect-contact', 'category'].forEach(key => {
          const button = document.createElement('button');
          button.dataset.menuKey = key; button.textContent = key;
          button.onclick = () => navigate(key);
          document.querySelector('#menus').append(button);
        });
        document.querySelector('#publish').textContent = labels[5];
        document.querySelector('#publish').onclick = () => {
          window.publishClicks++;
          if (fixture.dirty) setTimeout(() => confirm(null, true), fixture.delay);
          else void publish();
        };
      </script></body></html>`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const browser = await launchGoogleChrome()
  t.after(() => browser.close())
  const page = await browser.newPage()
  observeUiReadiness(page)
  await page.goto(`http://127.0.0.1:${server.address().port}/form-activity/${options.settings ? 'settings' : 'designer'}?id=nav1`)
  return { page, writes, documents: () => documents }
}

const counts = page => ['request', 'response', 'requestfailed', 'dialog'].map(event => page.listenerCount(event))
const enterSettings = (page, options = {}) => openFormSettingsStep(page, 'settings', {
  ready: page.locator('#ready-form'), label: '进入基础设置', timeout: 5000, ...options,
})

test('clean designer reaches the actual settings without saving or leaking listeners', async t => {
  const { page, writes } = await setup(t)
  const before = counts(page)
  await enterSettings(page)
  assert.match(page.url(), /\/settings\?id=nav1$/)
  assert.equal(await page.evaluate(() => window.navClicks), 1)
  assert.deepEqual(writes, [])
  assert.deepEqual(counts(page), before)
})

for (const locale of Object.keys(LABELS)) {
  test(`delayed ${locale} navigation confirmation saves once and tolerates the original modal closing`, async t => {
    const { page, writes } = await setup(t, { locale, dirty: true })
    const assertions = []
    await runWithAssertionRecorder('form-all-fields-publish', entry => assertions.push(entry),
      () => enterSettings(page, { expectSaved: false }))
    assert.equal(assertions.some(entry => entry.status === 'failed'), false)
    assert.equal(assertions.some(entry => entry.name.includes('已保存且没有新增修改时应直接切换')), false)
    assert.deepEqual(writes.map(write => write.kind), ['items', 'config'])
    assert.equal(writes[1].payload.expected_edit_token, 'b'.repeat(64))
    assert.deepEqual(await page.evaluate(() => [window.navClicks, window.confirmClicks]), [1, 1])
    assert.equal(await page.locator('#ready-form').isVisible(), true)
  })
}

test('unexpected dirty state remains a failed assertion while Runner continues after a successful save', async t => {
  const { page } = await setup(t, { dirty: true, closeBeforeSave: true })
  const assertions = []
  await runWithAssertionRecorder('form-all-fields-publish', assertion => assertions.push(assertion), () => enterSettings(page))
  assert.equal(await page.locator('#ready-form').isVisible(), true)
  const failures = assertions.filter(assertion => assertion.status === 'failed')
  assert.equal(failures.length, 1)
  assert.match(failures[0].name, /已保存且没有新增修改时应直接切换/)
})

test('a conflicting save fails promptly without retrying or navigating', async t => {
  const { page, writes } = await setup(t, { dirty: true, failure: 'items' })
  const before = counts(page)
  await assert.rejects(enterSettings(page, { expectSaved: false }), /40901.*编辑冲突/)
  assert.deepEqual(writes.map(write => write.kind), ['items'])
  assert.match(page.url(), /\/designer\?id=nav1$/)
  assert.equal(await page.evaluate(() => window.confirmClicks), 1)
  assert.deepEqual(counts(page), before)
})

test('closing a confirmation without the required config write cannot masquerade as a successful save', async t => {
  const { page } = await setup(t, { dirty: true, omitConfig: true })
  await assert.rejects(enterSettings(page, { expectSaved: false }), /必须真实完成 config/)
})

test('stale editing credentials fail even when the page navigates', async t => {
  const { page } = await setup(t, { dirty: true, staleToken: true })
  await assert.rejects(enterSettings(page, { expectSaved: false }), /上一步返回的编辑令牌/)
})

for (const reason of ['validationFailure', 'newChanges']) {
  test(`${reason} keeps the original page and never triggers a second save`, async t => {
    const { page, writes } = await setup(t, { dirty: true, delay: 0, [reason]: true })
    await assert.rejects(enterSettings(page, { expectSaved: false, timeout: 2200 }), /保存后必须到达目标/)
    assert.match(page.url(), /\/designer\?id=nav1$/)
    assert.equal(await page.evaluate(() => window.confirmClicks), 1)
    assert.deepEqual(writes.map(write => write.kind), reason === 'validationFailure' ? [] : ['items', 'config'])
  })
}

test('a second confirmation after saving stops without confirming it', async t => {
  const { page, writes } = await setup(t, { dirty: true, repeatDialog: true })
  await assert.rejects(enterSettings(page, { expectSaved: false }), /再次出现未保存确认/)
  assert.equal(await page.evaluate(() => window.confirmClicks), 1)
  assert.deepEqual(writes.map(write => write.kind), ['items', 'config'])
})

test('settings menu navigation saves only config and a same-menu click is harmless', async t => {
  const { page, writes } = await setup(t, { settings: true, dirty: true })
  const ready = page.locator('#ready-permission')
  await openFormSettingsMenu(page, 'permission', { ready, expectSaved: false, timeout: 5000 })
  await openFormSettingsMenu(page, 'permission', { ready, timeout: 5000 })
  assert.deepEqual(writes.map(write => write.kind), ['config'])
  assert.deepEqual(await page.evaluate(() => [window.navClicks, window.confirmClicks]), [2, 1])
})

test('English message and sharing steps use the real UI without reloading the document', async t => {
  const { page, documents } = await setup(t, { settings: true, locale: 'en' })
  const before = documents()
  await openFormSettingsStep(page, 'message', { ready: page.locator('#ready-message'), timeout: 5000 })
  assert.equal(new URL(page.url()).searchParams.get('step'), 'message')
  await openFormSettingsStep(page, 'share', { ready: page.locator('.share-link-channel-card'), timeout: 5000 })
  assert.equal(new URL(page.url()).searchParams.get('step'), 'share')
  assert.equal(documents(), before)
})

for (const dirty of [false, true]) {
  test(`publication ${dirty ? 'waits for a delayed confirmation then saves' : 'accepts a direct response'}`, async t => {
    const { page, writes } = await setup(t, { dirty, locale: 'en' })
    const before = counts(page)
    const result = await publishFormFromDesigner(page, { timeout: 5000 })
    assert.equal(result.savedBeforePublish, dirty)
    assert.equal(result.body.data.status, 'published')
    assert.deepEqual(writes.map(write => write.kind), dirty ? ['items', 'config', 'publish'] : ['publish'])
    if (dirty) assert.equal(writes[2].payload.expected_edit_token, 'c'.repeat(64))
    assert.deepEqual(await page.evaluate(() => [window.publishClicks, window.confirmClicks]), [1, Number(dirty)])
    assert.deepEqual(counts(page), before)
  })
}

test('publication stops on a failed config save before requesting publish', async t => {
  const { page, writes } = await setup(t, { dirty: true, failure: 'config' })
  await assert.rejects(publishFormFromDesigner(page, { timeout: 5000 }), /40901.*编辑冲突/)
  assert.deepEqual(writes.map(write => write.kind), ['items', 'config'])
})

test('reload refuses an exposed dirty editor before sending a document request', async t => {
  const { page, documents } = await setup(t, { dirtyReload: true })
  const before = documents()
  await assert.rejects(reloadSavedFormPage(page), /停止刷新以保留页面内容/)
  assert.equal(documents(), before)
})

test('reload cancels native beforeunload protection and removes its dialog listener', async t => {
  const { page } = await setup(t, { nativeDirty: true })
  await clickWhenReady(page.locator('#activate'))
  await page.evaluate(() => { window.unsavedMarker = 'keep me' })
  const before = counts(page)
  await assert.rejects(reloadSavedFormPage(page, { timeout: 5000 }), /已取消刷新/)
  assert.equal(await page.evaluate(() => window.unsavedMarker), 'keep me')
  assert.deepEqual(counts(page), before)
})

test('clean reload really loads a new document and removes its dialog listener', async t => {
  const { page } = await setup(t)
  await page.evaluate(() => { window.unsavedMarker = 'old document' })
  const before = counts(page)
  await reloadSavedFormPage(page, { timeout: 5000 })
  assert.equal(await page.evaluate(() => window.unsavedMarker), undefined)
  assert.deepEqual(counts(page), before)
})
