import assert from 'node:assert/strict'
import test from 'node:test'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { chooseContactCollectionInDesigner } from '../../scripts/form-all-fields-publish.ui.spec.mjs'

const fields = ['username', 'mobile', 'email'].map(type =>
  `<div class="form-field" data-component-type="${type}" data-container-path="">${type}</div>`,
).join('')

async function withPage(t) {
  const browser = await launchGoogleChrome()
  t.after(() => browser.close())
  return browser.newPage()
}

test('waits for delayed replacement dialog even when preset fields have already rendered', async t => {
  const page = await withPage(t)
  await page.setContent(fields + '<div role="dialog"><h2>是否收录联系人</h2><button>确认收录到联系人</button></div>')
  await page.evaluate(() => {
    document.querySelector('button').onclick = () => {
      document.querySelector('[role="dialog"]').remove()
      setTimeout(() => {
        const dialog = document.createElement('div')
        dialog.setAttribute('role', 'dialog')
        dialog.innerHTML = '<h2>联系人信息替换确认</h2><label>忽略，不替换</label><button>确定</button>'
        document.body.append(dialog)
        dialog.querySelector('button').onclick = () => {
          document.body.dataset.confirmed = 'yes'
          setTimeout(() => dialog.remove(), 1200)
        }
      }, 6500)
    }
  })
  await chooseContactCollectionInDesigner(page, () => {})
  assert.equal(await page.locator('body').getAttribute('data-confirmed'), 'yes')
  assert.equal(await page.getByRole('dialog').count(), 0)
})

test('handles arriving directly at replacement confirmation after a loading gap', async t => {
  const page = await withPage(t)
  await page.setContent(fields)
  await page.evaluate(() => {
    setTimeout(() => {
      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
      dialog.innerHTML = '<h2>联系人信息替换确认</h2><label>忽略，不替换</label><button>确定</button>'
      document.body.append(dialog)
      dialog.querySelector('button').onclick = () => dialog.remove()
    }, 1500)
  })
  await chooseContactCollectionInDesigner(page, () => {})
  assert.equal(await page.getByRole('dialog').count(), 0)
})

test('does not treat existing fields as success if final confirmation never loads', async t => {
  const page = await withPage(t)
  await page.setContent(fields)
  await assert.rejects(chooseContactCollectionInDesigner(page, () => {}, 250), /Timeout/)
})

test('waits for loading mask and late dialog handlers before clicking confirmation', async t => {
  const page = await withPage(t)
  await page.setContent(fields + '<div class="arco-spin-mask">加载中</div><div role="dialog"><h2>联系人信息替换确认</h2><label>忽略，不替换</label><button>确定</button></div>')
  await page.evaluate(() => {
    window.earlyClicks = 0
    document.querySelector('button').onclick = () => window.earlyClicks++
    setTimeout(() => {
      document.querySelector('.arco-spin-mask').remove()
      document.querySelector('button').onclick = () => {
        document.body.dataset.saved = 'yes'
        setTimeout(() => document.querySelector('[role="dialog"]').remove(), 500)
      }
    }, 1800)
  })
  await chooseContactCollectionInDesigner(page, () => {})
  assert.equal(await page.evaluate(() => window.earlyClicks), 0)
  assert.equal(await page.locator('body').getAttribute('data-saved'), 'yes')
})

test('re-evaluates dialog content that is replaced while the page is loading', async t => {
  const page = await withPage(t)
  await page.setContent(fields + '<div role="dialog"><h2>联系人信息替换确认</h2><label>忽略，不替换</label><button>确定</button></div>')
  await page.evaluate(() => {
    window.earlyClicks = 0
    document.querySelector('button').onclick = () => window.earlyClicks++
    setTimeout(() => {
      document.querySelector('[role="dialog"]').innerHTML = '<h2>是否收录联系人</h2><button>确认收录到联系人</button>'
      document.querySelector('button').onclick = () => {
        document.querySelector('[role="dialog"]').innerHTML = '<h2>联系人信息替换确认</h2><label>忽略，不替换</label><button>确定</button>'
        document.querySelector('button').onclick = () => document.querySelector('[role="dialog"]').remove()
      }
    }, 350)
  })
  await chooseContactCollectionInDesigner(page, () => {})
  assert.equal(await page.evaluate(() => window.earlyClicks), 0)
  assert.equal(await page.getByRole('dialog').count(), 0)
})
