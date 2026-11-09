import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { inspectShareSettingsPage } from '../../scripts/form-multilingual-translation-publish.ui.spec.mjs'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'

// Real PNG QR codes encoding the two fixed fixture URLs; no QR encoder is needed at test time.
const samples = JSON.parse(await readFile(new URL('./support/share-link-qr-samples.json', import.meta.url), 'utf8'))
const labels = { 'zh-CN': { long: '长链', short: '短链' },
  'zh-HK': { long: '長鏈', short: '短鏈' }, en: { long: 'Long link', short: 'Short link' } }

function sharePage({ locale = 'zh-CN', rowOrder = ['short', 'long'], buttonOrder = ['short', 'long'],
  initial = 'short', wrongQr = false, wrongLinks = false, duplicateLabel = false, duplicateSelection = false }) {
  const names = labels[locale]
  const row = type => `<div class="share-link-display-row">
    <span class="share-link-variant-label">${names[duplicateLabel ? 'long' : type]}</span>
    <div class="share-link-display-value" data-type="${type}">生成中</div>
    <button onclick="window.open('${samples[wrongLinks ? (type === 'long' ? 'short' : 'long') : type].value}')">直接打开</button>
    </div>`
  return `<div class="share-link-channel-card">${rowOrder.map(row).join('')}
    ${buttonOrder.map(type => `<button class="share-link-segmented-button" data-type="${type}"
      aria-pressed="${duplicateSelection || type === initial}" onclick="selectMode('${type}')">${names[type]}</button>`).join('')}
    <img class="share-link-qr-image" alt="分享二维码" src="${samples[initial].image}"></div>
    <div class="share-link-channel-card"><div class="share-link-display-row">
      <span class="share-link-variant-label">${names.long}</span><div class="share-link-display-value">https://wrong.example/</div>
    </div></div>
    <script>
      const samples = ${JSON.stringify(samples)};
      const wrongLinks = ${wrongLinks};
      setTimeout(() => document.querySelectorAll('[data-type].share-link-display-value').forEach(el => {
        const type = wrongLinks ? (el.dataset.type === 'long' ? 'short' : 'long') : el.dataset.type;
        el.textContent = samples[type].value;
      }), 150);
      function selectMode(type) {
        document.querySelectorAll('.share-link-segmented-button').forEach(el => {
          el.setAttribute('aria-pressed', String(el.dataset.type === type));
        });
        setTimeout(() => {
          document.querySelector('img').src = samples[${wrongQr} && type !== '${initial}' ? '${initial}' : type].image;
        }, 100);
      }
    </script>`
}

async function inspectFixture(browser, options = {}) {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      if ((!options.wrongLinks && url.hostname === '1xi.co')
        || (options.wrongLinks && url.pathname === '/form/')) {
        return route.fulfill({ status: 302, headers: { location: options.wrongLinks ? samples.short.value : samples.long.value } })
      }
      return route.fulfill({ contentType: 'text/html; charset=utf-8',
        body: url.pathname === '/form-activity/settings' ? sharePage(options) : '<h1>公开表单</h1>' })
    })
    const assertions = []
    const completedPages = []
    const result = await runWithAssertionRecorder('form-multilingual-translation-publish', a => assertions.push(a), () => (
      inspectShareSettingsPage({ page, siteBaseUrl: 'https://lx.admin.lingxi.tech', environmentCode: 'TEST',
        formId: 'fixture', authorization: 'fixture-admin-secret', extraHTTPHeaders: {}, logger() {},
        artifactWriter: { captureScreenshot: async (_page, relativePath) => ({ relativePath }) },
        completionTracker: { waitForPage: async popup => completedPages.push(popup.url()) },
      })
    ))
    return { result, assertions, completedPages,
      selected: await page.locator('.share-link-segmented-button[aria-pressed="true"]').getAttribute('data-type') }
  } finally { await context.close() }
}

test('share validation follows labels across independent orders and locales while enforcing the product QR default', async t => {
  const browser = await launchGoogleChrome()
  try {
    for (const locale of Object.keys(labels)) {
      for (const rowOrder of [['long', 'short'], ['short', 'long']]) {
        for (const buttonOrder of [['long', 'short'], ['short', 'long']]) {
          for (const initial of ['long', 'short']) {
            await t.test(`${locale} rows=${rowOrder} buttons=${buttonOrder} default=${initial}`, async () => {
              const { result, assertions, completedPages, selected } = await inspectFixture(browser,
                { locale, rowOrder, buttonOrder, initial })
              assert.deepEqual(assertions.filter(a => a.status === 'failed').map(a => a.name),
                initial === 'long' ? ['二维码默认应选择短链'] : [])
              assert.equal(result.longUrl, samples.long.value)
              assert.equal(result.shortUrl, samples.short.value)
              assert.deepEqual(completedPages, [samples.long.value, samples.long.value])
              assert.equal(selected, initial)
              assert.equal(assertions.filter(a => a.name.includes('二维码应成功解码')).length, 3)
            })
          }
        }
      }
    }
  } finally { await browser.close() }
})

test('share validation retains QR, URL and unambiguous-label checks after reordering', async t => {
  const browser = await launchGoogleChrome()
  try {
    await t.test('a QR that stays on the previous URL fails decoding for the selected mode', async () => {
      const { assertions } = await inspectFixture(browser, { wrongQr: true })
      assert.ok(assertions.some(a => a.status === 'failed' && a.name.includes('二维码应成功解码并严格编码对应链接')))
    })
    await t.test('swapped URL contents under correct labels still fail the link contracts', async () => {
      const { assertions } = await inspectFixture(browser, { wrongLinks: true })
      const failed = assertions.filter(a => a.status === 'failed').map(a => a.name)
      assert.ok(failed.includes('分享长链应使用当前环境公开域名'))
      assert.ok(failed.includes('分享短链应使用产品短链域名'))
    })
    await t.test('duplicate labels fail instead of falling back to positions', async () => {
      await assert.rejects(inspectFixture(browser, { duplicateLabel: true }), /分享长链必须按类型标识唯一定位/)
    })
    await t.test('two selected QR modes fail instead of guessing a default', async () => {
      await assert.rejects(inspectFixture(browser, { duplicateSelection: true }), /二维码必须且只能选择一种模式/)
    })
  } finally { await browser.close() }
})
