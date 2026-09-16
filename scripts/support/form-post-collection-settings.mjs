import { expect } from './recorded-expect.mjs'
import { expect as flowExpect, scaleTimeout } from './environment-timeouts.mjs'
import { clickWhenReady, waitForUiReady } from './ui-readiness.mjs'
import { createFormSettingsContent } from './form-settings-content.mjs'
import { inspectSettingsPreview } from './form-settings-preview.mjs'
import { configureFormClassificationTags, createFormShareChannel } from './form-settings-channels.mjs'
import { configureManagerNotification, configureAutomationNotification, assertPublishedNotification } from './form-settings-notifications.mjs'
import { withAgreementLocaleCompatibility } from './form-agreement-locale.mjs'

const CONFIRM = /^(确认|確定|確認|确定)$/

async function setSwitch(control, enabled, label) {
  await flowExpect(control, `${label}开关应唯一存在`).toHaveCount(1)
  await flowExpect(control, `${label}开关应可见`).toBeVisible()
  const checked = await control.getAttribute('aria-checked') === 'true'
    || await control.getAttribute('data-state') === 'checked'
  if (checked !== enabled) await clickWhenReady(control)
  await expect.poll(async () => await control.getAttribute('aria-checked') === 'true'
    || await control.getAttribute('data-state') === 'checked', { message: `${label}开关状态应正确` }).toBe(enabled)
}

export async function pasteSettingsRichText(editor, html, label) {
  await flowExpect(editor, `${label}富文本编辑器应唯一存在`).toHaveCount(1)
  await flowExpect(editor, `${label}富文本编辑器应可编辑`).toBeEditable()
  await editor.fill('')
  await editor.focus()
  // Exercise the editor's normal paste/parser pipeline, without writing its internal model.
  await editor.evaluate((element, source) => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/html', source)
    const document = new DOMParser().parseFromString(source, 'text/html')
    clipboardData.setData('text/plain', document.body.textContent || '')
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }))
  }, html)
  await editor.blur()
  await flowExpect(editor, `${label}富文本粘贴后应有内容`).not.toBeEmpty()
  const expected = await editor.evaluate((element, source) => {
    const document = new DOMParser().parseFromString(source, 'text/html')
    return {
      text: (document.body.textContent || '').replace(/\s+/g, ' ').trim(),
      links: [...document.querySelectorAll('a[href]')].map(link => link.getAttribute('href')),
    }
  }, html)
  const actualText = await editor.evaluate(element => (element.textContent || '').replace(/\s+/g, ' ').trim())
  expect(actualText, `${label}应保留模板中的全部正文`).toBe(expected.text)
  flowExpect(actualText, `${label}正文不得在编辑器中丢失`).toBe(expected.text)
  const actualLinks = await editor.locator('a[href]').evaluateAll(links => links.map(link => link.getAttribute('href')))
  expect(actualLinks, `${label}应保留模板中的全部链接`).toEqual(expected.links)
  flowExpect(actualLinks, `${label}链接不得在编辑器中丢失`).toEqual(expected.links)
  return editor.innerHTML()
}

async function confirmConfig({ page, formId, container, label, inspectBusinessResponse }) {
  const responsePromise = page.waitForResponse(response => response.request().method() === 'PUT'
    && new URL(response.url()).pathname.endsWith(`/be/form/${formId}/config`), { timeout: scaleTimeout(45_000) })
  await clickWhenReady(container.getByRole('button', { name: CONFIRM, exact: true }))
  const response = await responsePromise
  const outcome = await inspectBusinessResponse(response, label)
  flowExpect(outcome.succeeded, `${label}必须成功才能继续`).toBe(true)
  await waitForUiReady(page)
  return response.request().postDataJSON()
}

export function assertAgreementPersistence(actual, submitted, label = '用户协议独立回读应与保存参数一致') {
  const expected = structuredClone(submitted)
  // The service enriches a custom text agreement with its source and empty
  // attachment lists. Only these known defaults may be added during saving.
  if (Object.hasOwn(actual ?? {}, 'source') && !Object.hasOwn(expected, 'source')) expected.source = 'custom'
  for (let index = 0; index < (expected.agreements?.length ?? 0); index += 1) {
    const entry = expected.agreements[index]
    if (Object.hasOwn(actual?.agreements?.[index] ?? {}, 'file') && !Object.hasOwn(entry, 'file')) entry.file = []
  }
  expect(actual, label).toEqual(expected)
  flowExpect(actual, `${label}，正文及所有配置必须完整一致`).toEqual(expected)
}

export function assertStoredSettings(form, settings, { published = false, notificationTemplates } = {}) {
  const agreement = form?.common_config?.[settings.agreement.configKey]
  assertAgreementPersistence(agreement, settings.agreement.storedParameters ?? settings.agreement.savedParameters,
    '用户协议发布回读应匹配实际保存参数')
  if (!settings.classificationTags.skipped) {
    expect(form?.submitted_config?.category_and_tag, '分类标签发布回读应匹配实际保存参数')
      .toEqual(settings.classificationTags.savedParameters)
  }
  let publishedNotifications
  if (published) {
    // Publication moves email content into the customized template resource.
    // Validate it independently; an empty form skeleton alone proves nothing.
    publishedNotifications = {
      managerNotification: assertPublishedNotification(form?.notification_config?.admin_notification,
        settings.managerNotification.savedParameters, notificationTemplates, { variant: 'manager' }),
      automationNotification: assertPublishedNotification(form?.notification_config?.user_notification,
        settings.automationNotification.savedParameters, notificationTemplates, { variant: 'automation' }),
    }
  } else {
    expect(form?.notification_config?.admin_notification, '管理者通知草稿回读应匹配实际保存参数')
      .toEqual(settings.managerNotification.savedParameters)
    expect(form?.notification_config?.user_notification, '自动化通知草稿回读应匹配实际保存参数')
      .toEqual(settings.automationNotification.savedParameters)
  }
  expect(form?.notification_config?.customized_feedback, '自定义反馈发布回读应匹配实际保存参数')
    .toEqual(settings.feedback.savedParameters)
  expect(form?.notification_config?.promotion_link, '底部推广发布回读应匹配实际保存参数')
    .toEqual(settings.promotion.savedParameters)
  return publishedNotifications
}

export async function configureAgreement({ page, formId, content, inspectBusinessResponse, readForm, logger }) {
  await clickWhenReady(page.locator('[data-menu-key="form"]'))
  const toggle = page.getByRole('switch', { name: /(?:用户|用戶)(?:隐私|隱私)?(?:协议|協議)(?:开关|開關)/ })
  await setSwitch(toggle, true, '用户协议')
  const nameInput = page.getByPlaceholder(/请输入自定义协议名称|請輸入自訂協議名稱/)
  if (!await nameInput.isVisible()) await clickWhenReady(page.getByRole('button', { name: /编辑.*协议|編輯.*協議/ }))
  await nameInput.fill(content.name)
  await setSwitch(page.getByRole('switch', { name: /填写前阅读开关|填寫前閱讀開關/ }), false, '填写前阅读')
  const editor = page.locator('.privacy-policy__editor .ProseMirror[contenteditable="true"]')
  const body = await pasteSettingsRichText(editor, content.body, '用户协议')
  const { result: payload, compatibility } = await withAgreementLocaleCompatibility({ page, formId, logger },
    () => confirmConfig({ page, formId, container: page, label: '保存用户协议', inspectBusinessResponse }))
  const configKey = Object.keys(payload.common_config || {}).find(key => /privacy_policy|terms_of_service/.test(key))
  flowExpect(configKey, '用户协议保存请求应包含协议配置').toBeTruthy()
  const savedParameters = payload.common_config[configKey]
  expect(Number(savedParameters.enabled), '用户协议应开启').toBe(1)
  expect(Number(savedParameters.confirm_required), '用户协议不启用填写前阅读').toBe(2)
  expect(savedParameters.name, '用户协议名称应保存').toBe(content.name)
  const entries = savedParameters.agreements ?? savedParameters.terms ?? savedParameters.content
  expect(JSON.stringify(entries), '用户协议内容应保存本次富文本正文').toContain(body.replace(/"/g, '\\"'))
  const detail = await readForm()
  const storedParameters = detail.common_config?.[configKey]
  assertAgreementPersistence(storedParameters, savedParameters)
  return { enabled: true, name: content.name, body, readBeforeFill: false, configKey, savedParameters, storedParameters, compatibility }
}

export async function configureFeedback({ page, formId, content, imagePath, uploadImage, inspectBusinessResponse, readForm }) {
  const toggle = page.getByRole('switch', { name: /启用自定义反馈|啟用自訂反饋/ })
  const section = page.locator('section').filter({ has: toggle }).last()
  await setSwitch(toggle, true, '自定义反馈')
  const editorRoot = page.locator('.message-custom-feedback__editor')
  if (!await editorRoot.isVisible()) await clickWhenReady(section.getByRole('button', { name: /编辑|編輯/ }))
  const editor = editorRoot.locator('.ProseMirror[contenteditable="true"]')
  await pasteSettingsRichText(editor, content.body, '自定义反馈')
  // Cover all supported basic text styles, both list types, alignment, and links.
  for (const selector of ['h2', 'strong', 'em', 'u', 's', 'ul > li', 'ol > li', 'a[href="https://www.baidu.com/"]', '[style*="color"]', '[style*="background"]', '[style*="text-align"]']) {
    await expect(editor.locator(selector).first(), `自定义反馈富文本应保留 ${selector}`).toBeAttached()
  }
  const textBody = await editor.innerHTML()
  const imageInput = editorRoot.locator('input[type="file"][accept*="image"]')
  await flowExpect(imageInput, '自定义反馈富文本应提供图片上传').toHaveCount(1)
  await editor.press('ControlOrMeta+End')
  await editor.press('Enter')
  await uploadImage(page, imageInput, imagePath, { label: '自定义反馈图片' })
  await flowExpect(editor.locator('img').last(), '自定义反馈上传图片应显示').toBeVisible()
  const image = await editor.locator('img').last().evaluate(element => ({
    src: element.getAttribute('src'), alt: element.getAttribute('alt'), uploadId: element.getAttribute('data-upload-id'),
  }))
  await editor.blur()
  const payload = await confirmConfig({ page, formId, container: section, label: '保存自定义反馈', inspectBusinessResponse })
  const savedParameters = payload.notification_config?.customized_feedback
  expect(savedParameters?.enabled, '自定义反馈应开启').toBe(1)
  // Image node views contain resize handles that intentionally do not serialize.
  const textComparison = await page.evaluate(({ saved, expected }) => {
    const normalized = html => {
      const document = new DOMParser().parseFromString(html, 'text/html')
      document.querySelectorAll('img, .ProseMirror-trailingBreak, .ProseMirror-separator').forEach(node => node.remove())
      while (document.body.lastElementChild?.tagName === 'P'
        && document.body.lastElementChild.innerHTML === '') document.body.lastElementChild.remove()
      return document.body.innerHTML
    }
    return { actual: normalized(saved), expected: normalized(expected) }
  }, { saved: savedParameters?.body ?? '', expected: textBody })
  expect(textComparison.actual, '自定义反馈应完整保存全部文字、列表、链接和样式').toBe(textComparison.expected)
  const savedImages = await page.evaluate(html => {
    const document = new DOMParser().parseFromString(html, 'text/html')
    return [...document.querySelectorAll('img')].map(element => ({
      src: element.getAttribute('src'), alt: element.getAttribute('alt'), uploadId: element.getAttribute('data-upload-id'),
    }))
  }, savedParameters?.body ?? '')
  expect(savedImages, '自定义反馈应保存本次上传的图片及上传标识').toEqual([image])
  flowExpect(textComparison.actual, '自定义反馈正文必须完整保存').toBe(textComparison.expected)
  flowExpect(savedImages, '自定义反馈图片必须完整保存').toEqual([image])
  const detail = await readForm()
  expect(detail.notification_config?.customized_feedback, '自定义反馈独立回读应匹配').toEqual(savedParameters)
  return { enabled: true, body: savedParameters.body, savedParameters }
}

export async function configurePromotion({ page, formId, content, inspectBusinessResponse, readForm }) {
  const toggle = page.getByRole('switch', { name: /启用推广|啟用推廣/ })
  const section = page.locator('section').filter({ has: toggle }).last()
  await setSwitch(toggle, true, '底部推广')
  const buttonInput = section.getByRole('textbox', { name: /按钮名称|按鈕名稱/ })
  if (!await buttonInput.isVisible()) await clickWhenReady(section.getByRole('button', { name: /编辑|編輯/ }))
  await buttonInput.fill(content.buttonText)
  await clickWhenReady(section.getByRole('radio', { name: /跳转链接|跳轉連結/ }))
  await section.getByRole('textbox', { name: /链接|連結/, exact: true }).fill(content.link)
  const payload = await confirmConfig({ page, formId, container: section, label: '保存底部推广', inspectBusinessResponse })
  const savedParameters = payload.notification_config?.promotion_link
  expect(savedParameters?.enabled, '底部推广应开启').toBe(1)
  expect(savedParameters?.button_text, '底部推广按钮名称应保存').toBe(content.buttonText)
  expect(savedParameters?.selected, '底部推广应选择跳转链接').toBe('href')
  expect(savedParameters?.actions, '底部推广链接应为百度官网').toEqual([{ type: 'href', link: content.link }])
  const detail = await readForm()
  expect(detail.notification_config?.promotion_link, '底部推广独立回读应匹配').toEqual(savedParameters)
  return { enabled: true, ...content, savedParameters }
}

export async function configurePostCollectionSettings({
  page, formId, title, siteBaseUrl, logger, artifactWriter, imagePath,
  uploadImage, inspectBusinessResponse, readForm, signal, setPhase,
}, { assertClassificationTagOptionsAvailable } = {}) {
  const content = createFormSettingsContent({ title, formId, siteBaseUrl })
  const args = { page, formId, logger, inspectBusinessResponse, readForm }
  setPhase('用户协议')
  const agreement = await configureAgreement({ ...args, content: content.agreement })
  setPhase('分类与标签')
  const classificationTags = await configureFormClassificationTags({
    page, formId, logger, assertOptionsAvailable: assertClassificationTagOptionsAvailable,
  })
  setPhase('管理者通知')
  await clickWhenReady(page.locator('[data-menu-key="permission"]'))
  const managerNotification = await configureManagerNotification({ page, formId, content: content.managerNotification, logger, readForm })
  setPhase('消息及触达')
  const messageStep = page.locator('.form-activity-step-nav .form-activity-step').filter({ hasText: /消息及触达|訊息及觸達/ })
  await clickWhenReady(messageStep)
  const automationNotification = await configureAutomationNotification({ page, formId, content: content.automationNotification, logger, readForm })
  const feedback = await configureFeedback({ ...args, content: content.feedback, imagePath, uploadImage })
  const promotion = await configurePromotion({ ...args, content: content.promotion })
  setPhase('创建分享渠道')
  await createFormShareChannel({ page, formId, channelName: content.channelName, logger })
  setPhase('发布前预览')
  const preview = await inspectSettingsPreview({ page, artifactWriter, logger, signal })
  const settings = { schemaVersion: 1, runMarker: content.runMarker, environment: content.environment,
    agreement, classificationTags, managerNotification, automationNotification, feedback, promotion, preview }
  assertStoredSettings(await readForm(), settings)
  if (artifactWriter) await artifactWriter.writeFile('form-settings.json', JSON.stringify(settings, null, 2), {
    encoding: 'utf8', type: 'attachment', mimeType: 'application/json',
  })
  logger('success', '发布前全部设置已保存并回读，配置记录已准备供后续脚本使用', { formId, runMarker: content.runMarker })
  return settings
}
