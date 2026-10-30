import assert from 'node:assert/strict'
import test from 'node:test'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { initializeMainlandContactFields } from '../../scripts/form-all-fields-publish-mainland.ui.spec.mjs'
import { dismissFormOnboarding } from '../../scripts/form-all-fields-publish.ui.spec.mjs'
import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'

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

async function installContactDialog(page, {
  initialDelayMs = 0, replacementDelayMs = 0, saveDelayMs = 0,
  finalFields = fields, closeAfterSave = true,
} = {}) {
  await page.evaluate(options => {
    document.querySelector('[data-component-type="contactGroup"]').onclick = () => {
      document.body.dataset.paletteClicked = 'yes'
    }
    setTimeout(() => {
      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
      dialog.innerHTML = '<h2>是否收录联系人</h2><button>确认收录到联系人</button>'
      document.body.append(dialog)
      dialog.querySelector('button').onclick = () => {
        dialog.remove()
        setTimeout(() => {
          dialog.innerHTML = '<h2>联系人信息替换确认</h2>'
            + '<label><input type="radio" name="strategy" value="replace" checked>替换</label>'
            + '<label><input type="radio" name="strategy" value="ignore">忽略，不替换</label><button>确定</button>'
          document.body.append(dialog)
          dialog.querySelector('button').onclick = () => {
            document.body.dataset.selected = dialog.querySelector('input:checked').value
            document.body.dataset.confirmations = String(Number(document.body.dataset.confirmations || 0) + 1)
            if (!options.closeAfterSave) return
            setTimeout(() => {
              if (!document.querySelector('.form-field')) {
                document.body.insertAdjacentHTML('beforeend', options.finalFields)
              }
              document.body.dataset.saved = 'yes'
              dialog.remove()
            }, options.saveDelayMs)
          }
        }, options.replacementDelayMs)
      }
    }, options.initialDelayMs)
  }, { initialDelayMs, replacementDelayMs, saveDelayMs, finalFields, closeAfterSave })
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

test('mainland: confirms both onboarding steps and waits for saving before using generated fields', async t => {
  const page = await withPage(t, palette)
  await installContactDialog(page, { saveDelayMs: 1200 })
  await initializeMainlandContactFields(page, () => {}, 8000)
  assert.equal(await page.locator('.form-field').count(), 3)
  assert.equal(await page.locator('body').getAttribute('data-selected'), 'ignore')
  assert.equal(await page.locator('body').getAttribute('data-saved'), 'yes')
  assert.equal(await page.locator('body').getAttribute('data-confirmations'), '1')
  assert.equal(await page.locator('body').getAttribute('data-palette-clicked'), null)
  assert.equal(await page.getByRole('dialog').count(), 0)
})

test('mainland: fields rendering first cannot bypass delayed collection and replacement dialogs', async t => {
  const page = await withPage(t, palette + fields)
  await installContactDialog(page, { initialDelayMs: 1700, replacementDelayMs: 1500, saveDelayMs: 500 })
  await initializeMainlandContactFields(page, () => {}, 10_000)
  assert.equal(await page.locator('body').getAttribute('data-saved'), 'yes')
  assert.equal(await page.locator('body').getAttribute('data-selected'), 'ignore')
  assert.equal(await page.locator('body').getAttribute('data-confirmations'), '1')
  assert.equal(await page.locator('body').getAttribute('data-palette-clicked'), null)
  assert.equal(await page.locator('.form-field').count(), 3)
  assert.equal(await page.getByRole('dialog').count(), 0)
})

test('mainland: missing onboarding fails even if all preset fields already exist', async t => {
  for (const markup of ['', fields]) {
    const page = await withPage(t, palette + markup)
    await page.evaluate(() => {
      document.querySelector('button').onclick = () => { document.body.dataset.paletteClicked = 'yes' }
    })
    await assert.rejects(initializeMainlandContactFields(page, () => {}, 1200), /Timeout/)
    assert.equal(await page.locator('body').getAttribute('data-palette-clicked'), null)
  }
})

test('mainland: incomplete or duplicate presets after confirmation fail without adding more fields', async t => {
  const firstField = fields.split('</div>')[0] + '</div>'
  for (const markup of ['', firstField, fields + firstField]) {
    const page = await withPage(t, palette)
    await installContactDialog(page, { finalFields: markup })
    const assertions = []
    let continued = false
    await assert.rejects(runWithAssertionRecorder('form-all-fields-publish-mainland',
      assertion => assertions.push(assertion), async () => {
        await initializeMainlandContactFields(page, () => {}, 10_000)
        continued = true
      }), /内地设计器应各有一道/)
    assert.equal(continued, false, 'Runner 记录断言后也必须停止初始化')
    assert.ok(assertions.some(assertion => assertion.status === 'failed'))
    assert.equal(await page.locator('body').getAttribute('data-palette-clicked'), null)
    assert.equal(await page.locator('body').getAttribute('data-confirmations'), '1')
  }
})

test('mainland: a failed save that leaves confirmation open must block initialization', async t => {
  const page = await withPage(t, palette + fields)
  await installContactDialog(page, { closeAfterSave: false })
  await assert.rejects(initializeMainlandContactFields(page, () => {}, 4500), /Timeout/)
  assert.equal(await page.locator('body').getAttribute('data-confirmations'), '1')
  assert.equal(await page.locator('body').getAttribute('data-saved'), null)
  assert.equal(await page.getByRole('dialog').count(), 1)
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
