import assert from 'node:assert/strict'
import test from 'node:test'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { initializeMainlandContactFields } from '../../scripts/form-all-fields-publish-mainland.ui.spec.mjs'
import { dismissFormOnboarding } from '../../scripts/form-all-fields-publish.ui.spec.mjs'

const fields = ['username', 'mobile', 'email'].map(type =>
  `<div class="form-field" data-component-type="${type}" data-container-path="">${type}</div>`,
).join('')
const palette = '<button data-component-type="contactGroup">联系人</button>'

async function withPage(t, html) {
  const browser = await launchGoogleChrome()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.setContent(html)
  return page
}

test('closes the optional mainland onboarding overlay before querying published forms', async t => {
  const page = await withPage(t, `<button>查询</button>
    <div role="dialog" aria-label="产品使用引导" style="position:fixed;inset:0;background:white">
      <button onclick="this.parentElement.remove()">关闭使用引导</button>
    </div>`)
  await dismissFormOnboarding(page)
  assert.equal(await page.getByRole('dialog').count(), 0)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  await dismissFormOnboarding(page)
})

test('mainland: waits for directly added contact fields without requiring a dialog', async t => {
  const page = await withPage(t, palette)
  await page.evaluate(markup => {
    document.body.dataset.clicks = '0'
    document.querySelector('button').onclick = () => {
      document.body.dataset.clicks = String(Number(document.body.dataset.clicks) + 1)
      setTimeout(() => document.body.insertAdjacentHTML('beforeend', markup), 1200)
    }
  }, fields)
  await initializeMainlandContactFields(page, () => {}, 5000)
  assert.equal(await page.locator('.form-field').count(), 3)
  assert.equal(await page.locator('body').getAttribute('data-clicks'), '1')
  assert.equal(await page.getByRole('dialog').count(), 0)
})

test('mainland: reuses already initialized fields without duplicating contacts', async t => {
  const page = await withPage(t, palette + fields)
  await page.evaluate(() => {
    document.querySelector('button').onclick = () => { document.body.dataset.clicked = 'yes' }
  })
  await initializeMainlandContactFields(page, () => {}, 3000)
  assert.equal(await page.locator('body').getAttribute('data-clicked'), null)
  assert.equal(await page.locator('.form-field').count(), 3)
})

test('mainland: missing or incomplete direct fields fail instead of clicking twice', async t => {
  for (const markup of ['', fields.split('</div>')[0] + '</div>']) {
    const page = await withPage(t, palette)
    await page.evaluate(fragment => {
      document.body.dataset.clicks = '0'
      document.querySelector('button').onclick = () => {
        document.body.dataset.clicks = String(Number(document.body.dataset.clicks) + 1)
        document.body.insertAdjacentHTML('beforeend', fragment)
      }
    }, markup)
    await assert.rejects(initializeMainlandContactFields(page, () => {}, 1800), /联系人快捷项/)
    assert.equal(await page.locator('body').getAttribute('data-clicks'), '1')
  }
})

test('mainland: an existing replacement dialog must still be confirmed before proceeding', async t => {
  const page = await withPage(t, palette + fields
    + '<div role="dialog"><h2>联系人信息替换确认</h2><label>忽略，不替换</label><button>确定</button></div>')
  await page.evaluate(() => {
    document.querySelector('[role="dialog"] button').onclick = () => {
      document.body.dataset.confirmed = 'yes'
      document.querySelector('[role="dialog"]').remove()
    }
  })
  await initializeMainlandContactFields(page, () => {}, 6000)
  assert.equal(await page.locator('body').getAttribute('data-confirmed'), 'yes')
  assert.equal(await page.getByRole('dialog').count(), 0)
})
