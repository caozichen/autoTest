import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertNotificationPersistence, assertPublishedNotification, assertSavedNotification, configureAutomationNotification, configureManagerNotification, notificationFromPayload, resolveNotificationDefaults,
} from '../../scripts/support/form-settings-notifications.mjs'
import { runWithAssertionRecorder } from '../../scripts/support/recorded-expect.mjs'
import { launchGoogleChrome } from '../../scripts/support/google-chrome.mjs'
import { assertStoredSettings } from '../../scripts/support/form-post-collection-settings.mjs'

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

test('skips manager readback explicitly while still rejecting missing user notification content and templates', () => {
  const fixture = publicationFixture('automation')
  const settings = {
    agreement: { configKey: 'privacy_policy', savedParameters: { enabled: 1, agreements: [] } },
    classificationTags: { skipped: true },
    managerNotification: { skipped: true, reason: '管理者通知自动配置暂时停用' },
    automationNotification: { savedParameters: fixture.saved },
    feedback: { savedParameters: { enabled: 1, body: '反馈' } },
    promotion: { savedParameters: { enabled: 1, button_text: '查看' } },
  }
  const form = {
    common_config: { privacy_policy: structuredClone(settings.agreement.savedParameters) },
    notification_config: {
      user_notification: structuredClone(fixture.saved),
      customized_feedback: structuredClone(settings.feedback.savedParameters),
      promotion_link: structuredClone(settings.promotion.savedParameters),
    },
  }
  const recorded = []
  const check = (value, options) => runWithAssertionRecorder('form-all-fields-publish', item => recorded.push(item),
    () => assertStoredSettings(value, settings, options))
  check(form)
  const published = structuredClone(form)
  published.notification_config.user_notification = fixture.published
  const options = { published: true, notificationTemplates: fixture.payload }
  assert.deepEqual(check(published, options).managerNotification, settings.managerNotification)
  assert.deepEqual(recorded.filter(item => item.status === 'failed'), [])
  form.notification_config.user_notification.notifications[0].body = ''
  assert.throws(() => check(form), /不得为空/)
  assert.throws(() => check(published, { published: true, notificationTemplates: {} }), /不能以原始默认模板代替/)
})

for (const variant of ['automation', 'manager']) test(`${variant}: replaces the default variable title, then saves and reads back only after confirming the editor`, { timeout: 20_000 }, async () => {
  const browser = await launchGoogleChrome()
  try {
    const page = await browser.newPage()
    const formId = 'notification-toggle-fixture'
    let saved
    const writes = []
    const key = variant === 'manager' ? 'admin_notification' : 'user_notification'
    const audience = variant === 'manager' ? 'admin' : 'user'
    const switchName = variant === 'manager' ? '管理者通知开关' : '启用消息通知'
    const recipients = variant === 'manager' ? { users: [{ id: 42, username: '测试管理者' }] } : undefined
    const original = { subject: '{{表单名称[form.title]}} 提交成功通知', body: '<p>默认正文</p>', ...(recipients ? { recipients } : {}) }
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><section>
      <button role="switch" aria-label="${switchName}" aria-checked="false">${switchName}</button>
      <article hidden>
        <label><span>触发条件 <span aria-hidden="true">*</span></span><button role="combobox">提交成功</button></label>
        <label><span>通知类型 <span aria-hidden="true">*</span></span><button role="combobox">邮件</button></label>
        ${recipients ? '<button aria-label="移除测试管理者">测试管理者</button>' : ''}
        <div class="notification-email-template-subject" contenteditable="true"><span contenteditable="false">表单名称</span> 提交成功通知</div>
        <div class="notification-email-template-editor"><div contenteditable="true"><p>默认正文</p></div></div>
        <button id="confirm">确认</button>
      </article>
    </section><script>
      const toggle = document.querySelector('[role="switch"]')
      const article = document.querySelector('article')
      toggle.onclick = () => {
        toggle.setAttribute('aria-checked', 'true')
        article.hidden = false
      }
      // The variable editor retains its token model during native replacement,
      // and the notification card restores its default when the title becomes empty.
      const subjectEditor = document.querySelector('.notification-email-template-subject')
      const defaultSubjectHtml = subjectEditor.innerHTML
      let subjectValue = ${JSON.stringify(original.subject)}
      subjectEditor.addEventListener('input', event => {
        if (event.inputType.startsWith('delete')) {
          subjectValue = subjectEditor.textContent
          if (!subjectValue.trim()) {
            subjectValue = ${JSON.stringify(original.subject)}
            subjectEditor.innerHTML = defaultSubjectHtml
          }
        }
        else if (event.inputType === 'insertText') {
          subjectValue += event.data || ''
          subjectEditor.textContent = subjectValue
          const selection = getSelection()
          selection.selectAllChildren(subjectEditor)
          selection.collapseToEnd()
        }
      })
      // Match MessageVariableInput's paste handler, which replaces the whole
      // selected range before notifying the parent of the final nonempty value.
      subjectEditor.addEventListener('paste', event => {
        event.preventDefault()
        const range = getSelection().getRangeAt(0)
        if (!subjectEditor.contains(range.commonAncestorContainer)) throw new Error('title selection must be inside its editor')
        range.deleteContents()
        range.insertNode(document.createTextNode(event.clipboardData.getData('text/plain')))
        subjectValue = subjectEditor.textContent
      })
      const editor = document.querySelector('.notification-email-template-editor [contenteditable]')
      editor.addEventListener('paste', event => {
        event.preventDefault()
        editor.innerHTML = event.clipboardData.getData('text/html')
      })
      document.querySelector('#confirm').onclick = async () => {
        const subject = subjectValue
        const body = editor.innerHTML
        await fetch('/api/be/form/${formId}/config', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notification_config: { ${key}: {
            enabled: 1, notifications: [{ scenario_code: 'submitted_success', channel: 'email', subject, body,
              ...${JSON.stringify(recipients ? { recipients } : {})} }],
          } } }),
        })
        await fetch('/api/be/form/${formId}').then(response => response.json())
        article.replaceChildren()
        const heading = document.createElement('h3')
        heading.textContent = subject
        const display = document.createElement('div')
        display.className = 'fb-richtext-view'
        display.innerHTML = body
        article.append(heading, display)
      }
    </script></body></html>`
    await page.route('https://notification.test/**', async route => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (path === '/') return route.fulfill({ contentType: 'text/html', body: html })
      let data
      if (path.endsWith('/config') && request.method() === 'PUT') {
        writes.push(request.postDataJSON())
        saved = writes.at(-1).notification_config[key]
        data = {}
      } else if (path.endsWith('/notification/template')) {
        data = { original: { [audience]: { submitted_success: { email: original } } },
          customized: saved ? { [audience]: { submitted_success: { email: saved.notifications[0] } } } : {} }
      } else if (path === '/api/base/dict/tree') {
        data = { form_action_behavior: { children: [{ enum_value: 'submitted_success', enum_name: '提交成功' }] } }
      } else if (path === '/api/be/form/' + formId) {
        data = { form: { notification_config: saved ? { [key]: saved } : {} } }
      } else throw new Error('Unexpected fixture request: ' + request.method() + ' ' + path)
      await route.fulfill({ json: { code: 0, data } })
    })
    await page.goto('https://notification.test/')
    const assertions = []
    const configure = variant === 'manager' ? configureManagerNotification : configureAutomationNotification
    const result = await runWithAssertionRecorder('form-all-fields-publish', item => assertions.push(item), () => configure({
      page, formId, content,
      readForm: () => page.evaluate(async id => (await fetch('/api/be/form/' + id).then(response => response.json())).data.form, formId),
    }))
    assert.equal(writes.length, 1, 'enabling must not require or introduce a separate config write')
    assert.equal(result.savedParameters.enabled, 1)
    assert.equal(result.subject, content.subject)
    assert.equal(result.body, content.body)
    assert.deepEqual(result.savedParameters, saved)
    assert.deepEqual(assertions.filter(item => item.status === 'failed'), [])
  } finally {
    await browser.close()
  }
})

test('draft readback normalizes scenario prefixes and recipient metadata but requires exact content and identity', () => {
  const submitted = config()
  const persisted = structuredClone(submitted)
  persisted.enabled = '1'
  persisted.notifications[0].scenario_code = 'form.submitted_success'
  persisted.notifications[0].recipients.users[0].id = '42'
  persisted.notifications[0].recipients.users[0].is_creator = 1
  const validate = value => runWithAssertionRecorder('form-all-fields-publish', () => undefined,
    () => assertNotificationPersistence(value, submitted, { variant: 'manager' }))
  validate(persisted)
  for (const field of ['subject', 'body']) {
    for (const value of ['', '旧内容']) {
      const invalid = structuredClone(persisted)
      invalid.notifications[0][field] = value
      assert.throws(() => validate(invalid), /不得为空|必须匹配本次保存内容/)
    }
  }
  const missing = structuredClone(persisted)
  missing.notifications = []
  assert.throws(() => validate(missing), /不得丢失或新增规则/)
  persisted.notifications[0].recipients.users[0].id = 99
  assert.throws(() => validate(persisted), /不得改变触发、渠道或收件人身份/)
})

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
