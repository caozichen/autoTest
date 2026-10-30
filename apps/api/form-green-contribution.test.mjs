import assert from 'node:assert/strict'
import test from 'node:test'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { assertGreenContribution } from '../../scripts/support/form-green-contribution.mjs'
import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'

const payload = { data: {
  form: { description: '<p>第一行<br>第二行</p><p>&nbsp;</p><div>第三行</div>', notification_config: {
    green_contribution: { enabled: 1, calculation: { description_line_grams: 0.3, form_item_grams: 0.6 }, provider_name: '测试供应商' },
  } },
  items: ['page', 'username', 'field_group', 'input', 'matrix', 'signature', 'description', 'divider']
    .map(type_code => ({ type_code })).concat([{ type_code: 'input', item_kind: 'system' }]),
} }

test('result verification independently counts static answerable questions and nonempty description lines', async t => {
  const browser = await launchGoogleChrome()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.setContent('<section data-submit-green-contribution>减碳 3.3 克，测试供应商</section>')
  const events = []
  const actual = await runWithAssertionRecorder('form-lpxavn-submit', event => events.push(event),
    () => assertGreenContribution(page, payload))
  assert.deepEqual(actual, { amount: '3.3', questionCount: 4, lineCount: 3 })
  assert.equal(events.filter(event => event.status === 'failed').length, 0)
})

test('disabled, failed and incomplete result configurations require the green section to be absent', async t => {
  const browser = await launchGoogleChrome()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.setContent('<h1>提交结果</h1>')
  const events = []
  await runWithAssertionRecorder('form-lpxavn-submit', event => events.push(event), async () => {
    await assertGreenContribution(page, payload, { success: false })
    await assertGreenContribution(page, { data: { ...payload.data, form: { notification_config: { green_contribution: { enabled: 2 } } } } })
    await assertGreenContribution(page, { data: { form: {}, items: [] } })
  })
  assert.equal(events.filter(event => event.status === 'failed').length, 0)
})
