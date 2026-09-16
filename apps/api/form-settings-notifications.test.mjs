import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertPublishedNotification, assertSavedNotification, notificationFromPayload, resolveNotificationDefaults,
} from '../../scripts/support/form-settings-notifications.mjs'
import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'

const content = { subject: '自动化测试 TEST-20260915 管理通知', body: '<p>本次<strong>自动化测试</strong>提交成功。</p>' }

function config() {
  return {
    enabled: 1,
    notifications: [{
      scenario_code: 'submitted_success', channel: 'email',
      recipients: { users: [{ id: 42, username: '测试管理者' }] },
      ...content,
    }],
  }
}

function validate(value, variant = 'manager') {
  return runWithAssertionRecorder('form-all-fields-publish', () => undefined, () => assertSavedNotification(value, {
    label: '管理者通知', content, variant,
    expectedDefaults: {
      triggerCondition: '提交成功', notificationType: '邮件', recipients: ['移除测试管理者'],
      parameters: {
        scenario_code: 'submitted_success', channel: 'email',
        ...(variant === 'manager' ? { recipients: { users: [{ id: 42, username: '测试管理者' }] } } : {}),
      },
    },
  }))
}

test('keeps complete email HTML and default recipient identity in the saved notification record', () => {
  const value = config()
  const before = structuredClone(value)
  assert.equal(validate(value).body, content.body)
  assert.deepEqual(value, before)
  assert.equal(notificationFromPayload({ code: 0, data: { form: { notification_config: { admin_notification: value } } } }, 'admin_notification'), value)
})

test('hard-blocks notification defaults changed to another channel, recipient or automated trigger', () => {
  const wrongChannel = config()
  wrongChannel.notifications[0].channel = 'sms'
  assert.throws(() => validate(wrongChannel), /默认通知类型必须为邮件/)
  const wrongRecipient = config()
  wrongRecipient.notifications[0].recipients.users[0].username = '另一个接收人'
  assert.throws(() => validate(wrongRecipient), /接收人必须保持默认/)
  const missingRecipient = config()
  missingRecipient.notifications[0].recipients.users = []
  assert.throws(() => validate(missingRecipient), /不得改变默认接收人数/)
  const wrongTrigger = config()
  wrongTrigger.notifications[0].scenario_code = 'signup_success'
  assert.throws(() => validate(wrongTrigger, 'automation'), /必须保持提交成功触发条件/)
  assert.throws(() => validate(wrongTrigger, 'manager'), /不得改变初始默认触发枚举/)
  const wrongRecipientId = config()
  wrongRecipientId.notifications[0].recipients.users[0].id = 99
  assert.throws(() => validate(wrongRecipientId), /不得改变初始默认触发枚举、通知类型或接收人 ID 与姓名/)
})

test('takes exact backend default identities before content changes without deriving them from final save', () => {
  const initial = config()
  initial.notifications[0].scenario_code = 'signup_success'
  const parameters = resolveNotificationDefaults({ config: initial, display: { triggerCondition: '报名成功' }, variant: 'manager' })
  assert.deepEqual(parameters, {
    scenario_code: 'signup_success', channel: 'email',
    recipients: { users: [{ id: 42, username: '测试管理者' }] },
  })
  initial.notifications[0].recipients.users[0].id = 99
  assert.equal(parameters.recipients.users[0].id, 42)
})

test('uses initial templates and the backend scenario dictionary when enabling creates the first default rule', () => {
  const defaultRule = { subject: '默认标题', body: '<p>默认正文</p>', recipients: { users: [{ id: '42', username: '测试管理者' }] } }
  const template = { original: { admin: { submitted_success: { email: defaultRule } } } }
  const dictionary = { form_action_behavior: { children: [
    { enum_key: 'form.submitted_success', enum_value: 'form.submitted_success', enum_name: '提交成功' },
  ] } }
  const options = { config: { enabled: 1, notifications: [] }, template, dictionary, display: { triggerCondition: '提交成功' }, variant: 'manager' }
  assert.deepEqual(resolveNotificationDefaults(options), {
    scenario_code: 'submitted_success', channel: 'email',
    recipients: { users: [{ id: 42, username: '测试管理者' }] },
  })
  assert.throws(() => resolveNotificationDefaults({ ...options, display: { triggerCondition: '未知行为' } }), /必须唯一对应后端字典枚举/)
  assert.throws(() => resolveNotificationDefaults({ ...options, template: {} }), /必须存在于初始后端模板/)
})

test('ignores audit and receipt customizations when resolving a new automatic form notification', () => {
  const original = { subject: '提交成功', body: '感谢参与' }
  const unrelated = { email: { subject: '审核拒绝或收据模板', body: '其他设置模块内容', recipients: [] } }
  const template = {
    original: { user: { submitted_success: { email: original } } },
    customized: { user: { submission_audit_rejected: unrelated, 'audit.audit_rejected': unrelated, receipt_sent: unrelated } },
  }
  const options = {
    config: undefined, template, variant: 'automation', display: { triggerCondition: '提交成功' },
    dictionary: { form_action_behavior: { children: [{ enum_value: 'submitted_success', enum_key: 'submitted_success', enum_name: '提交成功' }] } },
  }
  assert.deepEqual(resolveNotificationDefaults(options), { scenario_code: 'submitted_success', channel: 'email' })
  template.customized.user['form.submitted_success'] = { email: { subject: '原有用户通知', body: '原有用户通知正文' } }
  assert.deepEqual(resolveNotificationDefaults(options), { scenario_code: 'submitted_success', channel: 'email' })
})

test('hard-blocks missing email content and extra default rules before accepting persistence', () => {
  const wrongSubject = config()
  wrongSubject.notifications[0].subject = '与本次无关的邮件'
  assert.throws(() => validate(wrongSubject), /保存标题必须匹配本次自动化文案/)
  const missingBody = config()
  missingBody.notifications[0].body = ''
  assert.throws(() => validate(missingBody), /保存正文必须为非空富文本/)
  const staleBody = config()
  staleBody.notifications[0].body = '<p>上次运行的旧正文</p>'
  assert.throws(() => validate(staleBody), /不能保存旧正文/)
  const duplicate = config()
  duplicate.notifications.push(structuredClone(duplicate.notifications[0]))
  assert.throws(() => validate(duplicate), /必须保留一条默认通知规则/)
})

function publicationFixture(variant = 'manager') {
  const saved = config()
  if (variant === 'automation') delete saved.notifications[0].recipients
  const published = variant === 'manager' ? structuredClone(saved) : { enabled: 1 }
  if (variant === 'manager') {
    published.notifications[0].scenario_code = 'form.submitted_success'
    published.notifications[0].recipients.users[0].is_creator = 1
    published.notifications[0].subject = null
    published.notifications[0].body = null
  }
  const { subject, body, recipients } = saved.notifications[0]
  const email = { subject, body, ...(recipients ? { recipients: structuredClone(recipients) } : {}) }
  const audience = variant === 'manager' ? 'admin' : 'user'
  const payload = { code: 0, data: { customized: { [audience]: { submitted_success: { email } } } } }
  return { saved, published, payload, email }
}

function validatePublished(fixture, variant = 'manager') {
  return runWithAssertionRecorder('form-all-fields-publish', () => undefined, () => (
    assertPublishedNotification(fixture.published, fixture.saved, fixture.payload, { variant })
  ))
}

test('accepts published notification skeletons only with the exact persisted custom email template', () => {
  for (const variant of ['manager', 'automation']) {
    const fixture = publicationFixture(variant)
    const actual = validatePublished(fixture, variant)
    assert.deepEqual(actual.template, fixture.email)
    assert.equal(actual.scenarioCode, 'submitted_success')
    assert.equal(actual.channel, 'email')
    assert.equal(actual.templatePath, `customized.${variant === 'manager' ? 'admin' : 'user'}.submitted_success.email`)
    actual.template.body = 'edited result'
    assert.equal(fixture.email.body, content.body)
  }
})

test('rejects missing custom templates even when matching original default templates exist', () => {
  const fixture = publicationFixture()
  fixture.payload.data.original = structuredClone(fixture.payload.data.customized)
  delete fixture.payload.data.customized
  assert.throws(() => validatePublished(fixture), /不能以原始默认模板代替/)
  const missingScenario = publicationFixture()
  missingScenario.payload.data.customized.admin = {}
  assert.throws(() => validatePublished(missingScenario), /必须唯一匹配/)
  const duplicate = publicationFixture()
  duplicate.payload.data.customized.admin['form.submitted_success'] = { email: structuredClone(duplicate.email) }
  assert.throws(() => validatePublished(duplicate), /必须唯一匹配/)
})

test('rejects empty, stale or conflicting published email text without weakening exact HTML comparison', () => {
  for (const field of ['subject', 'body']) {
    for (const value of [null, '', '上次运行的旧内容']) {
      const fixture = publicationFixture()
      fixture.email[field] = value
      assert.throws(() => validatePublished(fixture), /不得为空或丢失|不得变成旧文案或默认文案/)
    }
    const conflict = publicationFixture()
    conflict.published.notifications[0][field] = '与自定义模板冲突的旧内容'
    assert.throws(() => validatePublished(conflict), /不得与自定义模板冲突/)
  }
  const html = publicationFixture()
  html.email.body = content.body.replace('<strong>', '<em>').replace('</strong>', '</em>')
  assert.throws(() => validatePublished(html), /不得变成旧文案或默认文案/)
})

test('keeps publication enablement, trigger, channel and full recipient identity strict', () => {
  const disabled = publicationFixture()
  disabled.published.enabled = 2
  assert.throws(() => validatePublished(disabled), /发布后必须保持开启/)
  const wrongTemplateId = publicationFixture()
  wrongTemplateId.email.recipients.users[0].id = 99
  assert.throws(() => validatePublished(wrongTemplateId), /自定义模板不得改变接收人 ID/)
  for (const field of ['scenario_code', 'channel']) {
    const changed = publicationFixture()
    changed.published.notifications[0][field] = 'changed'
    assert.throws(() => validatePublished(changed), /表单配置不得改变默认身份参数/)
  }
  const changedFormId = publicationFixture()
  changedFormId.published.notifications[0].recipients.users[0].id = 99
  assert.throws(() => validatePublished(changedFormId), /表单配置不得改变默认身份参数/)
})
