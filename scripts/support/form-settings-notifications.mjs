import { expect } from './recorded-expect.mjs'
import { expect as flowExpect, scaleTimeout } from './environment-timeouts.mjs'
import { clickWhenReady, waitForUiReady } from './ui-readiness.mjs'

const ACTION_TIMEOUT_MS = 30_000
const EMAIL_LABEL = /^(邮件|郵件|電郵|Email)$/i
const SCENARIO_LABEL = /^(触发条件|觸發條件|Trigger condition)$/i
const TYPE_LABEL = /^(通知类型|通知類型|通知方式|Notify type|Notification type)$/i
const CONFIRM_LABEL = /^(确认|確認|Confirm)$/i
const EDIT_LABEL = /^(编辑|編輯|Edit)$/i
// MessageAutomationNoticeSection only imports templates in the form scope;
// audit and receipt templates belong to separate settings panels.
const FORM_NOTIFICATION_SCENARIOS = new Set([
  'submitted_success', 'signup_success', 'paid_success', 'paid_failed',
  'paid_checking', 'qualification_checking', 'qualification_check_failed',
])
const VARIANTS = {
  manager: {
    key: 'admin_notification',
    label: '管理者通知',
    switchName: /^(管理者通知开关|管理者通知開關|Manager notification switch)$/i,
  },
  automation: {
    key: 'user_notification',
    label: '自动化通知',
    switchName: /^(启用消息通知|啟用訊息通知|Enable message notifications)$/i,
  },
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

async function requireBusinessResponse(response, label) {
  await response.finished()
  const body = await response.json()
  expect(response.ok(), `${label} HTTP 应成功`).toBe(true)
  expect(Number(body?.code), `${label}业务码应为 0`).toBe(0)
  flowExpect(response.ok(), `${label} HTTP 必须成功，才能继续通知配置`).toBe(true)
  flowExpect(isRecord(body), `${label}必须返回业务信封`).toBe(true)
  flowExpect(Number(body.code), `${label}业务码必须为 0，才能继续通知配置`).toBe(0)
  return body
}

async function actionWithResponses(page, specs, action) {
  const waiters = specs.map(({ method, path, accepts = () => true }) => page.waitForResponse((response) => (
    response.request().method() === method
      && new URL(response.url()).pathname.endsWith(path)
      && accepts(response)
  ), { timeout: scaleTimeout(ACTION_TIMEOUT_MS) }))
  // Keep both action and watchers observed when a click or one response fails.
  return (await Promise.all([Promise.all(waiters), Promise.resolve().then(action)]))[0]
}

function selectorForLabel(article, label) {
  return article.locator('label').filter({ has: article.page().getByText(label, { exact: true }) })
    .getByRole('combobox')
}

async function snapshotNotificationDefaults(article) {
  const scenario = selectorForLabel(article, SCENARIO_LABEL)
  const channel = selectorForLabel(article, TYPE_LABEL)
  await flowExpect(scenario, '通知默认触发条件应可见').toBeVisible()
  await flowExpect(channel, '通知默认类型应可见').toBeVisible()
  return {
    triggerCondition: (await scenario.innerText()).trim(),
    notificationType: (await channel.innerText()).trim(),
    recipients: await article.getByRole('button', { name: /^(移除|Remove)/ }).evaluateAll((buttons) => (
      buttons.map((button) => button.getAttribute('aria-label'))
    )),
  }
}

async function fillNotificationBody(editor, html, label) {
  await flowExpect(editor, `${label}富文本编辑器必须可编辑`).toHaveAttribute('contenteditable', 'true')
  await clickWhenReady(editor)
  await editor.press('ControlOrMeta+A')
  // Paste through the editor's normal clipboard handler so its document and
  // Vue model update together. Do not assign innerHTML or private editor state.
  await editor.evaluate((element, value) => {
    const template = document.createElement('template')
    template.innerHTML = value
    const data = new DataTransfer()
    data.setData('text/html', value)
    data.setData('text/plain', template.content.textContent ?? '')
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, html)
  const expected = await editor.evaluate((element, value) => {
    const template = document.createElement('template')
    template.innerHTML = value
    const normalize = (text) => String(text ?? '').replace(/\s+/g, ' ').trim()
    return { text: normalize(template.content.textContent), links: [...template.content.querySelectorAll('a[href]')].map((link) => link.getAttribute('href')) }
  }, html)
  await flowExpect.poll(async () => editor.evaluate((element) => (
    String(element.textContent ?? '').replace(/\s+/g, ' ').trim()
  )), { message: `${label}粘贴后必须完整保留正文文字` }).toBe(expected.text)
  const actualLinks = await editor.locator('a[href]').evaluateAll((links) => links.map((link) => link.getAttribute('href')))
  expect(actualLinks, `${label}粘贴后应保留正文链接`).toEqual(expected.links)
  flowExpect(actualLinks, `${label}粘贴后必须保留正文链接`).toEqual(expected.links)
  await editor.press('Tab')
  return editor.evaluate((element) => {
    const snapshot = element.cloneNode(true)
    // ProseMirror inserts these caret widgets only in its editable DOM; they
    // are not part of the HTML returned by the editor's normal serializer.
    for (const widget of snapshot.querySelectorAll('br.ProseMirror-trailingBreak, img.ProseMirror-separator')) widget.remove()
    return snapshot.innerHTML
  })
}

function notificationFromPayload(payload, key) {
  return payload?.data?.form?.notification_config?.[key]
    ?? payload?.data?.notification_config?.[key]
    ?? payload?.form?.notification_config?.[key]
}

async function readNotificationApi(page, path, label) {
  const outcome = await page.evaluate(async (pathname) => {
    const response = await fetch(new URL(`/api/${pathname}`, location.origin), {
      headers: { Authorization: localStorage.getItem('token') ?? '' },
    })
    return { ok: response.ok, status: response.status, body: await response.json() }
  }, path)
  expect(outcome.ok, `${label} HTTP 应成功`).toBe(true)
  expect(Number(outcome.body?.code), `${label}业务码应为 0`).toBe(0)
  flowExpect(outcome.ok && Number(outcome.body?.code) === 0, `${label}必须成功才能取得通知默认参数`).toBe(true)
  return outcome.body?.data
}

function notificationDefaultParameters(notification, variant) {
  const result = {
    scenario_code: String(notification?.scenario_code ?? '').replace(/^form\./, ''),
    channel: String(notification?.channel ?? ''),
  }
  if (variant === 'manager') {
    result.recipients = { users: (notification?.recipients?.users ?? []).map((user) => {
      const id = String(user?.id ?? user ?? '').trim()
      return {
        id: Number.isSafeInteger(Number(id)) ? Number(id) : id,
        username: String(user?.username ?? '').trim(),
      }
    }) }
  }
  return result
}

function resolveNotificationDefaults({ config, template, dictionary, display, variant }) {
  const audience = variant === 'manager' ? 'admin' : 'user'
  let rules = config?.notifications
  if (!Array.isArray(rules) || rules.length === 0) {
    rules = Object.entries(template?.customized?.[audience] ?? {})
      .filter(([scenario]) => variant === 'manager' || FORM_NOTIFICATION_SCENARIOS.has(String(scenario).split('.').at(-1)))
      .flatMap(([scenario, channels]) => (
        Object.entries(channels ?? {}).map(([channel, value]) => ({ ...value, scenario_code: scenario, channel }))
      ))
  }
  if (rules.length === 0) {
    const scenarios = dictionary?.form_action_behavior?.children ?? []
    const matched = scenarios.filter((entry) => String(entry?.enum_name ?? entry?.enum_key ?? entry?.enum_value ?? '').trim() === display.triggerCondition)
    flowExpect(matched, '通知界面默认触发条件必须唯一对应后端字典枚举').toHaveLength(1)
    const scenario = String(matched[0].enum_value ?? matched[0].enum_key ?? matched[0].value ?? '').replace(/^form\./, '')
    const original = template?.original?.[audience]
    const rule = original?.[scenario]?.email ?? original?.[`form.${scenario}`]?.email
    flowExpect(isRecord(rule), '通知默认邮件规则必须存在于初始后端模板').toBe(true)
    rules = [{ ...rule, scenario_code: scenario, channel: 'email' }]
  }
  flowExpect(rules, '通知初始配置必须只包含一条默认规则').toHaveLength(1)
  const rule = structuredClone(rules[0])
  const scenario = String(rule.scenario_code ?? '').replace(/^form\./, '')
  const original = template?.original?.[audience]
  const defaultTemplate = original?.[scenario]?.[rule.channel] ?? original?.[`form.${scenario}`]?.[rule.channel]
  // The product fills empty manager recipients from its original template.
  if (variant === 'manager' && !rule.recipients?.users?.length && defaultTemplate?.recipients?.users?.length) {
    rule.recipients = structuredClone(defaultTemplate.recipients)
  }
  const parameters = notificationDefaultParameters(rule, variant)
  flowExpect(parameters.scenario_code, '通知初始触发条件枚举必须非空').toMatch(/\S+/)
  flowExpect(parameters.channel, '通知初始默认类型必须为邮件').toBe('email')
  return parameters
}

function assertSavedNotification(config, { label, content, expectedDefaults, variant }) {
  expect(Number(config?.enabled), `${label}保存请求应开启通知`).toBe(1)
  flowExpect(Number(config?.enabled), `${label}必须成功开启`).toBe(1)
  expect(config?.notifications, `${label}应保留且只配置一条默认通知规则`).toHaveLength(1)
  flowExpect(config?.notifications, `${label}必须保留一条默认通知规则`).toHaveLength(1)
  const notification = config.notifications[0]
  expect(notification.channel, `${label}默认通知类型应为邮件`).toBe('email')
  flowExpect(notification.channel, `${label}默认通知类型必须为邮件`).toBe('email')
  const scenario = String(notification.scenario_code ?? '').replace(/^form\./, '')
  expect(scenario, `${label}默认触发条件应非空`).toMatch(/\S+/)
  flowExpect(scenario, `${label}默认触发条件必须非空`).toMatch(/\S+/)
  if (variant === 'automation') {
    expect(scenario, '自动化通知默认触发条件应为提交成功').toBe('submitted_success')
    flowExpect(scenario, '自动化通知必须保持提交成功触发条件').toBe('submitted_success')
  }
  expect(notification.subject, `${label}保存标题应与本次自动化文案一致`).toBe(content.subject)
  flowExpect(notification.subject, `${label}保存标题必须匹配本次自动化文案`).toBe(content.subject)
  expect(String(notification.body ?? ''), `${label}保存正文应为非空富文本`).toMatch(/\S+/)
  flowExpect(String(notification.body ?? ''), `${label}保存正文必须为非空富文本`).toMatch(/\S+/)
  expect(notification.body, `${label}保存正文应与编辑器完整 HTML 一致`).toBe(content.body)
  flowExpect(notification.body, `${label}保存正文必须匹配编辑器完整 HTML，不能保存旧正文`).toBe(content.body)
  if (variant === 'manager') {
    const recipients = notification.recipients?.users
    expect(Array.isArray(recipients), '管理者通知必须保留默认接收人数组').toBe(true)
    flowExpect(Array.isArray(recipients), '管理者通知保存请求必须包含接收人数组').toBe(true)
    expect(recipients.length, '管理者通知保存后接收人数应与默认界面一致').toBe(expectedDefaults.recipients.length)
    flowExpect(recipients.length, '管理者通知不得改变默认接收人数').toBe(expectedDefaults.recipients.length)
    for (let index = 0; index < recipients.length; index += 1) {
      const recipient = recipients[index]
      const originalLabel = expectedDefaults.recipients[index].replace(/^(移除|Remove)\s*/, '')
      expect(String(recipient.username || recipient.id), `管理者通知第 ${index + 1} 个接收人应保持默认`)
        .toBe(originalLabel)
      flowExpect(String(recipient.username || recipient.id), `管理者通知第 ${index + 1} 个接收人必须保持默认`)
        .toBe(originalLabel)
    }
  }
  expect(notificationDefaultParameters(notification, variant), `${label}保存的触发枚举、类型和接收人完整参数应保持初始默认`)
    .toEqual(expectedDefaults.parameters)
  flowExpect(notificationDefaultParameters(notification, variant), `${label}不得改变初始默认触发枚举、通知类型或接收人 ID 与姓名`)
    .toEqual(expectedDefaults.parameters)
  return notification
}

async function configureNotification({ page, formId, content, readForm, logger = () => undefined }, variant) {
  const { key, label, switchName } = VARIANTS[variant]
  flowExpect(typeof content?.subject === 'string' && Boolean(content.subject.trim()), `${label}必须提供邮件标题`).toBe(true)
  flowExpect(typeof content?.body === 'string' && Boolean(content.body.trim()), `${label}必须提供邮件正文`).toBe(true)
  await waitForUiReady(page)
  const toggle = page.getByRole('switch', { name: switchName })
  await flowExpect(toggle, `${label}开关必须可见`).toBeVisible()
  const section = toggle.locator('xpath=ancestor::section[1]')
  const initialForm = typeof readForm === 'function'
    ? await readForm()
    : (await readNotificationApi(page, `be/form/${encodeURIComponent(formId)}`, `${label}初始配置`))?.form
  let initialConfig = initialForm?.notification_config?.[key]
  if (await toggle.getAttribute('aria-checked') !== 'true') {
    const [response] = await actionWithResponses(page, [{ method: 'PUT', path: `/be/form/${formId}/config` }], () => clickWhenReady(toggle))
    await requireBusinessResponse(response, `开启${label}`)
    const payload = response.request().postDataJSON()
    expect(Number(payload?.notification_config?.[key]?.enabled), `${label}开关应真实保存 enabled=1`).toBe(1)
    flowExpect(Number(payload?.notification_config?.[key]?.enabled), `${label}开关必须真实保存 enabled=1`).toBe(1)
    if (!initialConfig?.notifications?.length) initialConfig = payload.notification_config[key]
  }
  await expect(toggle, `${label}应显示开启状态`).toHaveAttribute('aria-checked', 'true')
  await flowExpect(toggle, `${label}必须显示开启状态`).toHaveAttribute('aria-checked', 'true')
  await waitForUiReady(page)
  const edit = section.getByRole('button', { name: EDIT_LABEL, exact: true })
  if (await edit.isVisible().catch(() => false)) await clickWhenReady(edit)
  const articles = section.locator('article')
  await flowExpect(articles, `${label}应自动提供且只提供一条默认通知规则`).toHaveCount(1)
  const article = articles.first()
  const displayDefaults = await snapshotNotificationDefaults(article)
  const needsTemplate = !initialConfig?.notifications?.length
    || (variant === 'manager' && !initialConfig.notifications[0]?.recipients?.users?.length)
  const [template, dictionary] = needsTemplate ? await Promise.all([
    readNotificationApi(page, `be/form/${encodeURIComponent(formId)}/notification/template`, `${label}初始模板`),
    !initialConfig?.notifications?.length
      ? readNotificationApi(page, 'base/dict/tree', `${label}触发条件字典`)
      : Promise.resolve(null),
  ]) : [null, null]
  const defaults = {
    ...displayDefaults,
    parameters: resolveNotificationDefaults({ config: initialConfig, template, dictionary, display: displayDefaults, variant }),
  }
  expect(defaults.notificationType, `${label}界面默认通知类型应为邮件`).toMatch(EMAIL_LABEL)
  flowExpect(defaults.notificationType, `${label}界面默认通知类型必须为邮件`).toMatch(EMAIL_LABEL)
  if (variant === 'automation') {
    expect(defaults.triggerCondition, '自动化通知界面默认应为提交成功').toMatch(/^(提交成功|Submitted successfully|Submission successful)$/i)
    flowExpect(defaults.triggerCondition, '自动化通知界面必须保持提交成功').toMatch(/^(提交成功|Submitted successfully|Submission successful)$/i)
  }
  const subject = article.locator('.notification-email-template-subject')
  await subject.fill(content.subject)
  await expect(subject, `${label}邮件标题应完整回显`).toHaveText(content.subject)
  const bodyEditor = article.locator('.notification-email-template-editor [contenteditable="true"]')
  await flowExpect(bodyEditor, `${label}邮件正文必须只有一个编辑器`).toHaveCount(1)
  const editorBody = await fillNotificationBody(bodyEditor, content.body, label)
  expect(await snapshotNotificationDefaults(article), `${label}接收人、触发条件、通知类型应保持默认`).toEqual(displayDefaults)
  flowExpect(await snapshotNotificationDefaults(article), `${label}不得修改默认接收人、触发条件或通知类型`).toEqual(displayDefaults)

  await waitForUiReady(page)
  const [saveResponse, detailResponse] = await actionWithResponses(page, [
    { method: 'PUT', path: `/be/form/${formId}/config` },
    { method: 'GET', path: `/be/form/${formId}` },
  ], () => clickWhenReady(article.getByRole('button', { name: CONFIRM_LABEL, exact: true })))
  await requireBusinessResponse(saveResponse, `${label}保存`)
  const submittedConfig = saveResponse.request().postDataJSON()?.notification_config?.[key]
  const notification = assertSavedNotification(submittedConfig, {
    label, content: { ...content, body: editorBody }, expectedDefaults: defaults, variant,
  })
  const detail = await requireBusinessResponse(detailResponse, `${label}保存后独立回读`)
  const persistedConfig = notificationFromPayload(detail, key)
  expect(persistedConfig, `${label}独立回读必须与完整保存配置一致`).toEqual(submittedConfig)
  flowExpect(persistedConfig, `${label}标题、富文本正文和默认参数必须持久化`).toEqual(submittedConfig)
  await flowExpect(section.locator('.notification-email-template-subject'), `${label}保存后应退出编辑状态`).toHaveCount(0)
  const displayedBody = section.locator('article .fb-richtext-view')
  await expect(displayedBody, `${label}保存后应显示富文本正文`).toBeVisible()
  const displayedSubject = section.locator('article').getByText(content.subject, { exact: true })
  await expect(displayedSubject, `${label}保存后应显示本次自动化邮件标题`).toBeVisible()
  logger('success', `${label}已开启，邮件标题正文已保存并独立回读，默认通知参数保持不变`, { formId, subject: notification.subject })
  return {
    enabled: true,
    subject: notification.subject,
    body: notification.body,
    notifications: structuredClone(persistedConfig.notifications),
    defaults,
    savedParameters: structuredClone(persistedConfig),
  }
}

export function configureManagerNotification(options) {
  return configureNotification(options, 'manager')
}

export function configureAutomationNotification(options) {
  return configureNotification(options, 'automation')
}

export function assertPublishedNotification(config, savedParameters, templatePayload, { variant } = {}) {
  flowExpect(Object.hasOwn(VARIANTS, variant), '发布后通知校验必须明确通知类型').toBe(true)
  const { label } = VARIANTS[variant]
  const audience = variant === 'manager' ? 'admin' : 'user'
  expect(Number(config?.enabled), `${label}发布后应保持开启`).toBe(1)
  flowExpect(Number(config?.enabled), `${label}发布后必须保持开启`).toBe(1)
  flowExpect(savedParameters?.notifications, `${label}发布后应有一条本次保存规则可供核对`).toHaveLength(1)
  if (isRecord(templatePayload) && Object.hasOwn(templatePayload, 'code')) {
    expect(Number(templatePayload.code), `${label}发布后模板回读业务码应为 0`).toBe(0)
    flowExpect(Number(templatePayload.code), `${label}发布后模板回读必须成功`).toBe(0)
  }
  const data = isRecord(templatePayload?.data) ? templatePayload.data : templatePayload
  const customized = data?.customized?.[audience]
  expect(isRecord(customized), `${label}发布后必须存在自定义通知模板分组`).toBe(true)
  flowExpect(isRecord(customized), `${label}发布后不能以原始默认模板代替本次自定义模板`).toBe(true)
  const expected = savedParameters.notifications[0]
  const identity = notificationDefaultParameters(expected, variant)
  const matches = Object.entries(customized).filter(([scenario, channels]) => (
    scenario.replace(/^form\./, '') === identity.scenario_code && isRecord(channels?.[identity.channel])
  ))
  expect(matches, `${label}发布后应唯一匹配本次场景和通知类型的自定义模板`).toHaveLength(1)
  flowExpect(matches, `${label}发布后必须唯一匹配本次场景和通知类型的自定义模板`).toHaveLength(1)
  const [scenarioKey, channels] = matches[0]
  const template = channels[identity.channel]
  for (const field of ['subject', 'body']) {
    expect(String(template[field] ?? '').trim(), `${label}发布后自定义模板 ${field} 应非空`).toMatch(/\S+/)
    flowExpect(String(template[field] ?? '').trim(), `${label}发布后自定义模板 ${field} 不得为空或丢失`).toMatch(/\S+/)
    expect(template[field], `${label}发布后自定义模板 ${field} 应完整匹配本次保存内容`).toBe(expected[field])
    flowExpect(template[field], `${label}发布后自定义模板 ${field} 不得变成旧文案或默认文案`).toBe(expected[field])
  }
  if (variant === 'manager') {
    flowExpect(Array.isArray(template.recipients?.users), '管理者通知发布后自定义模板必须保留接收人数组').toBe(true)
    const templateIdentity = notificationDefaultParameters({ ...template, scenario_code: scenarioKey, channel: identity.channel }, variant)
    expect(templateIdentity, '管理者通知发布后自定义模板应保持完整默认接收人和触发参数').toEqual(identity)
    flowExpect(templateIdentity, '管理者通知发布后自定义模板不得改变接收人 ID、姓名或触发参数').toEqual(identity)
  }
  // Publishing moves email content into notification/template. The ordinary
  // form detail retains manager recipient metadata and may omit user rules.
  // This proves effective template persistence, not manager-page rendering:
  // the deployed manager panel can display "未设置" for these null form fields
  // even when its custom template still contains the saved email content.
  // A populated form rule still must agree with the effective custom template.
  if (variant === 'manager' || Object.hasOwn(config, 'notifications')) {
    expect(config.notifications, `${label}发布后表单配置应保持一条默认规则`).toHaveLength(1)
    flowExpect(config.notifications, `${label}发布后表单配置不得新增或丢失默认规则`).toHaveLength(1)
    const published = config.notifications[0]
    expect(notificationDefaultParameters(published, variant), `${label}发布后表单配置应保持默认身份参数`).toEqual(identity)
    flowExpect(notificationDefaultParameters(published, variant), `${label}发布后表单配置不得改变默认身份参数`).toEqual(identity)
    for (const field of ['subject', 'body']) {
      if (published[field] !== undefined && published[field] !== null) {
        expect(published[field], `${label}发布后表单内 ${field} 应与自定义模板一致`).toBe(expected[field])
        flowExpect(published[field], `${label}发布后表单内 ${field} 不得与自定义模板冲突`).toBe(expected[field])
      }
    }
  }
  return {
    scenarioCode: identity.scenario_code,
    channel: identity.channel,
    templatePath: `customized.${audience}.${scenarioKey}.${identity.channel}`,
    template: structuredClone(template),
  }
}

export { assertSavedNotification, notificationFromPayload, notificationDefaultParameters, resolveNotificationDefaults }
