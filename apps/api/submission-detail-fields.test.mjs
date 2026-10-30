import assert from 'node:assert/strict'
import test from 'node:test'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { detailFieldRows, parseFieldIdentities } from '../../scripts/support/submission-detail-fields.mjs'
import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'
import { assertReplyValue } from '../../scripts/form-submission-reply-create.ui.spec.mjs'
import { detailNameValues, parseSubmissionAssertions as parseList } from '../../scripts/form-submission-list-check.ui.spec.mjs'
import { parseSubmissionAssertions as parseEdit } from '../../scripts/form-submission-reply-edit.ui.spec.mjs'

const fields = { '姓名[1]': '根联系人', '姓名[2]': '目标题组联系人' }
const fieldIdentities = {
  '姓名[1]': { itemKey: 'root_name', groupCode: '', groupIndex: null },
  '姓名[2]': { itemKey: 'group_name', groupCode: 'target_group', groupIndex: 3 },
}
const row = (name, value, group = '', index = 1) => `<div class="reply-kv__row" ${group ? `data-group-code="${group}" data-group-index="${index}"` : ''}><span class="reply-kv__label">${group ? `同名题组 / 第 ${index} 组 / ` : ''}${name}</span><div class="reply-kv__value">${value}</div></div>`

test('linked consumers validate and retain stable field identities while accepting legacy fields', () => {
  const input = JSON.stringify({ fields, fieldIdentities })
  assert.deepEqual(parseList(input).fieldIdentities, fieldIdentities)
  assert.deepEqual(parseEdit(input).fieldIdentities, fieldIdentities)
  for (const invalid of [
    { ...fieldIdentities, missing: fieldIdentities['姓名[2]'] },
    { '姓名[2]': { ...fieldIdentities['姓名[2]'], groupIndex: 0 } },
    { '姓名[2]': { ...fieldIdentities['姓名[2]'], itemKey: 'bad"]' } },
    { '姓名[1]': { ...fieldIdentities['姓名[1]'], groupIndex: 1 } },
  ]) assert.throws(() => parseFieldIdentities(invalid, fields), /fieldIdentities/)
  assert.equal(parseList(JSON.stringify({ fields })).groupContactName, fields['姓名[2]'])
})

test('detail checks select actual group identity despite duplicate labels and shuffled instance order', async t => {
  const browser = await launchGoogleChrome()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.setContent([
    row('姓名', '另一题组', 'other_group', 3),
    row('姓名', '第七组', 'target_group', 7),
    row('姓名', '目标题组联系人', 'target_group', 3),
    row('手机号', '13800000000', 'target_group', 3),
    row('姓名', '根联系人'),
  ].join(''))
  const events = []
  await runWithAssertionRecorder('form-submission-list-check', e => events.push(e), async () => {
    assert.deepEqual(await detailNameValues(page, page, fieldIdentities), ['根联系人', '目标题组联系人'])
    assert.equal(await assertReplyValue(page, '姓名', '目标题组联系人', 2, fieldIdentities['姓名[2]']), 1)
  })
  assert.equal(events.filter(e => e.status === 'failed').length, 0)
  const missing = await detailFieldRows(page, '姓名[2]', { identity: { ...fieldIdentities['姓名[2]'], groupIndex: 2 } })
  assert.equal(await missing.count(), 0)
  await page.setContent(row('Name', '根联系人') + row('Name', '目标题组联系人', 'target_group', 3))
  await runWithAssertionRecorder('form-submission-list-check', e => events.push(e), async () => {
    assert.deepEqual(await detailNameValues(page, page, fieldIdentities), ['根联系人', '目标题组联系人'])
  })
  assert.equal(events.filter(e => e.status === 'failed').length, 0)
})

test('missing group value records failure instead of silently skipping the second contact', async t => {
  const browser = await launchGoogleChrome()
  t.after(() => browser.close())
  const page = await browser.newPage()
  page.setDefaultTimeout(100)
  await page.setContent(row('姓名', '根联系人') + row('邮箱', 'other@example.test', 'other_group'))
  const events = []
  const count = await runWithAssertionRecorder('form-submission-reply-create', e => events.push(e),
    () => assertReplyValue(page, '姓名', '目标题组联系人', 2, fieldIdentities['姓名[2]']))
  assert.equal(count, 0)
  assert.ok(events.some(e => e.status === 'failed' && e.name.includes('唯一显示')))
})

test('legacy bare-label detail still resolves its original two field references', async t => {
  const browser = await launchGoogleChrome()
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.setContent(row('姓名', '根联系人') + row('姓名', '旧题组联系人'))
  const target = await detailFieldRows(page, '姓名[2]', { identity: fieldIdentities['姓名[2]'] })
  assert.equal(await target.locator('.reply-kv__value').innerText(), '旧题组联系人')
})
