import assert from 'node:assert/strict'
import test from 'node:test'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'
import { resolveTab, assertTopInformation, detailNameValues } from '../../scripts/form-submission-list-check.ui.spec.mjs'

async function withPage(t) {
  const browser = await launchGoogleChrome()
  t.after(() => browser.close())
  return browser.newPage()
}
const record = (events, callback) => runWithAssertionRecorder('form-submission-list-check', event => events.push(event), callback)

test('three tabs select contacts by label instead of the payment tab position', async t => {
  const page = await withPage(t)
  await page.setContent('<button class="arco-tabs-tab">提报详情</button><button class="arco-tabs-tab">付款信息</button><button class="arco-tabs-tab" onclick="document.body.dataset.selected=\'contacts\'">联系人信息</button>')
  const events = []
  await record(events, async () => {
    const tab = await resolveTab(page, /联系人信息/, '联系人 Tab')
    await tab.click()
  })
  assert.equal(await page.locator('body').getAttribute('data-selected'), 'contacts')
  assert.equal(events.filter(event => event.status === 'failed').length, 0)
})

test('display failures remain recorded while later checks continue', async t => {
  const page = await withPage(t)
  await page.setContent('<h1 class="info-card__title">错误标题</h1><span class="arco-tag"><i class="info-card__ability-icon"></i><i class="info-card__ability-icon"></i>错误标签</span>')
  const events = []
  let continued = false
  await record(events, async () => {
    await assertTopInformation(page, { title: '预期标题' })
    continued = true
  })
  assert.equal(continued, true)
  assert.ok(events.some(event => event.status === 'failed' && event.name.includes('图标')))
  assert.ok(events.some(event => event.status === 'failed' && event.name.includes('完全一致')))
})

test('extra name rows record a mismatch without blocking the two required names', async t => {
  const page = await withPage(t)
  await page.setContent(['甲', '乙', '丙'].map(name => `<div class="reply-kv__row"><span class="reply-kv__label">姓名</span><span class="reply-kv__value">${name}</span></div>`).join(''))
  const events = []
  const names = await record(events, () => detailNameValues(page))
  assert.deepEqual(names, ['甲', '乙'])
  assert.ok(events.some(event => event.status === 'failed' && event.name.includes('两个姓名')))
})

for (const labels of [['提报详情', '付款信息'], ['提报详情', '联系人信息', '联系人信息']]) {
  test(`missing or ambiguous contact target still blocks safely: ${labels.join('/')}`, async t => {
    const page = await withPage(t)
    await page.setContent(labels.map(label => `<button class="arco-tabs-tab">${label}</button>`).join(''))
    const events = []
    await assert.rejects(record(events, () => resolveTab(page, /联系人信息/, '联系人 Tab')), /必须能唯一定位/)
    assert.ok(events.some(event => event.status === 'failed'))
  })
}
