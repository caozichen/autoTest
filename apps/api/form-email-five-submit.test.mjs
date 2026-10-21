import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  TEST_EMAILS,
  FORM_SUBTITLE,
  assertContactItems,
  assertContactSubmissionPayload,
  emailTestContent,
} from '../../scripts/form-email-five-submit.ui.spec.mjs'
import { createFormSettingsContent } from '../../scripts/support/form-settings-content.mjs'
import { assertSubmissionPeriod, resolveSubmissionPeriod } from '../../scripts/support/form-submission-period.mjs'
import { resolveScriptEntryUrl, validateScriptConfig } from './script-config-repository.mjs'

const fieldKeys = { username: 'username_1', mobile: 'mobile_1', email: 'email_1' }
const contactItems = Object.entries(fieldKeys).map(([type_code, item_key]) => ({
  type_code, item_key, hidden: 2, rule_config: { required: { enabled: 1 } },
  ...(type_code === 'username' ? { common_config: { name_title: { enabled: 1 } } } : {}),
}))

test('registers ordinary and mainland mail flows with the existing timeout and five recipients', async () => {
  assert.deepEqual(TEST_EMAILS, [
    '2637005402@qq.com',
    'cyh_iris_chen@163.com',
    'cici0318532cyh@gmail.com',
    'cyh-chen@outlook.com',
    'caozichen@lingxi360.cn',
  ])
  for (const id of ['form-email-five-submit', 'form-email-five-submit-mainland']) {
    const config = validateScriptConfig(JSON.parse(await readFile(
      new URL(`../../config/scripts/${id}.json`, import.meta.url), 'utf8',
    )))
    assert.equal(config.timeoutMs, 600_000)
    assert.equal(config.enabled, true)
    await import(await resolveScriptEntryUrl(config))
  }
})

test('contact-only form requires the three original contact fields', () => {
  assert.deepEqual(assertContactItems([
    { type_code: 'page', item_key: 'page_1', hidden: 2 },
    ...contactItems,
    { type_code: 'input', item_key: 'duration', hidden: 1 },
  ], '测试').map(item => item.type_code), ['username', 'mobile', 'email'])
  assert.throws(() => assertContactItems(contactItems.slice(0, 2), '测试'))
  assert.throws(() => assertContactItems([
    ...contactItems.slice(0, 2),
    { ...contactItems[2], rule_config: { required: { enabled: 2 } } },
  ], '测试'))
})

test('preserves the existing user email copy and adds the mail test description', () => {
  const args = { title: '邮件测试表单', formId: 'form-101', siteBaseUrl: 'https://test.admin.lingxi360.com' }
  const original = createFormSettingsContent(args).automationNotification
  const content = emailTestContent(args.title, args.formId, args.siteBaseUrl)
  assert.equal(content.subject, original.subject)
  assert.ok(content.body.startsWith(original.body))
  assert.match(content.body, /邮件测试说明：.*五个指定邮箱/)
  assert.match(FORM_SUBTITLE, /邮件测试/)
})

test('checks each submission by item key and rejects an earlier email', () => {
  const data = {
    formId: 'form-101', revisionNo: 1, name: '邮件测试用户',
    mobile: '13912345678', email: TEST_EMAILS[1],
  }
  const payload = {
    revision_no: data.revisionNo,
    answers: [
      { item_key: fieldKeys.username, answer: { value: data.name } },
      { item_key: fieldKeys.mobile, answer: { area_code: '+86', value: data.mobile } },
      { item_key: fieldKeys.email, answer: data.email },
    ],
  }
  const requestUrl = `https://lx.lingxi.tech/api/f/form/${data.formId}/submission`
  const entries = assertContactSubmissionPayload(payload, fieldKeys, data, '第 2 次', requestUrl)
  assert.equal(entries.size, 3)
  assert.throws(() => assertContactSubmissionPayload(payload, fieldKeys, data, '第 2 次',
    'https://lx.lingxi.tech/api/f/form/other-form/submission'))
  assert.throws(() => assertContactSubmissionPayload({
    ...payload,
    answers: payload.answers.map(entry => entry.item_key === fieldKeys.email
      ? { ...entry, answer: TEST_EMAILS[0] } : entry),
  }, fieldKeys, data, '第 2 次', requestUrl))
})

test('mail submission periods use Shanghai dates across month boundaries and contain the whole run', () => {
  const now = Date.parse('2026-01-31T16:30:00Z')
  const period = resolveSubmissionPeriod({}, now)
  assert.deepEqual(period, { startTime: '2026-01-31 00:00:00', endTime: '2026-02-08 23:59:59', timeRange: 'in_progress' })
  assert.equal(resolveSubmissionPeriod({ SUBMISSION_START_TIME: '2026-01-30 12:00:00',
    SUBMISSION_END_TIME: '2026-02-03 18:00:00' }, now).startTime, '2026-01-30 12:00:00')
  for (const variables of [
    { SUBMISSION_START_TIME: '2026-02-30 12:00:00' },
    { SUBMISSION_START_TIME: '2026-02-02 00:00:00' },
    { SUBMISSION_END_TIME: '2026-02-01 00:30:00' },
    { SUBMISSION_START_TIME: '2026-02-01T00:00:00' },
  ]) assert.throws(() => resolveSubmissionPeriod(variables, now))
})

test('period readback rejects settings or list timestamps that did not persist', () => {
  const period = resolveSubmissionPeriod({}, Date.parse('2026-10-21T02:00:00Z'))
  const form = { start_time: period.startTime, end_time: period.endTime,
    submit_config: { time_range_close_rule: { enabled: '1', start_time: period.startTime, end_time: period.endTime } } }
  assert.doesNotThrow(() => assertSubmissionPeriod(form, period, '测试'))
  assert.throws(() => assertSubmissionPeriod({ ...form, end_time: null }, period, '测试'))
  assert.throws(() => assertSubmissionPeriod({ ...form, submit_config: { time_range_close_rule: { enabled: 2 } } }, period, '测试'))
})
