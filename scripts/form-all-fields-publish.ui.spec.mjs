import { access, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium, expect } from '@playwright/test'

import {
  closePlaywrightHandles,
  closePlaywrightOnAbort,
  throwIfRunAborted,
} from './playwright-run-control.mjs'

const NAVIGATION_TIMEOUT_MS = 45_000
const ACTION_TIMEOUT_MS = 30_000
const AUTHENTICATED_API_PATH_PREFIXES = ['/api/be/', '/api/base/', '/be/', '/base/']
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const SCREENSHOT_DIR = resolve(SCRIPT_DIR, '..', 'outputs', 'form-all-fields-publish')
const DEFAULT_HEADER_IMAGE_PATH = 'C:\\Users\\admin\\Desktop\\\u5fae\u4fe1\u56fe\u7247_20250903191551_63_4.jpeg'

const FORM_SUBTITLE = '\u672c\u8868\u5355\u7528\u4e8e\u6d3b\u52a8\u62a5\u540d\u4e0e\u4fe1\u606f\u767b\u8bb0\uff0c\u8bf7\u6309\u5b9e\u9645\u60c5\u51b5\u5b8c\u6574\u586b\u5199\u3002'
const FORM_CONTENT_HEADING = '\u586b\u5199\u987b\u77e5'
const FORM_CONTENT_ITEMS = [
  '\u8bf7\u786e\u4fdd\u59d3\u540d\u3001\u8bc1\u4ef6\u53ca\u8054\u7cfb\u65b9\u5f0f\u771f\u5b9e\u6709\u6548\u3002',
  '\u63d0\u4ea4\u524d\u8bf7\u4ed4\u7ec6\u6838\u5bf9\uff0c\u5e26\u661f\u53f7\u9879\u76ee\u4e3a\u5fc5\u586b\u3002',
]
const CASCADER_LEVEL_VALUES = ['\u534e\u4e1c\u533a', '\u6c5f\u82cf\u7701', '\u5357\u4eac\u5e02']
const DESCRIPTION_FIELD_TITLE = '\u62a5\u540d\u4e0e\u8054\u7cfb\u4eba\u8bf4\u660e'
const DESCRIPTION_FIELD_CONTENT = '\u8bf7\u786e\u8ba4\u8054\u7cfb\u4eba\u4fe1\u606f\u51c6\u786e\u65e0\u8bef\uff0c\u63d0\u4ea4\u540e\u5c06\u7528\u4e8e\u6d3b\u52a8\u62a5\u540d\u53ca\u76f8\u5173\u901a\u77e5\u3002'
const DIVIDER_TEXT = '\u8865\u5145\u4fe1\u606f'
const SYSTEM_ITEM_KEYS = ['duration', 'device', 'os', 'browser']

const CONTACT_PRESET_TYPES = ['username', 'mobile', 'email']
const CONTACT_EXTRA_TYPES = ['idCard', 'landlinePhone', 'address', 'birthday']
const CONTACT_FIELD_TYPES = [...CONTACT_PRESET_TYPES, ...CONTACT_EXTRA_TYPES]
const COMMON_FIELD_TYPES = [
  'input',
  'textarea',
  'radio',
  'checkbox',
  'select',
  'number',
  'date',
  'time',
  'imageUpload',
  'fileUpload',
]
const ADVANCED_FIELD_TYPES = [
  'cascader',
  'signature',
  'fieldGroup',
  'description',
  'divider',
  'matrix',
  'matrixChoice',
  'ranking',
  'rating',
  'nps',
]
const NON_ANSWERABLE_FIELD_TYPES = new Set(['fieldGroup', 'description', 'divider'])
const REQUIRED_FIELD_TYPES = [
  ...CONTACT_FIELD_TYPES,
  ...COMMON_FIELD_TYPES,
  ...ADVANCED_FIELD_TYPES.filter((type) => !NON_ANSWERABLE_FIELD_TYPES.has(type)),
]
const EXPECTED_FIELD_SEQUENCE = [
  'page',
  ...CONTACT_FIELD_TYPES,
  'page',
  ...COMMON_FIELD_TYPES,
  'page',
  ...ADVANCED_FIELD_TYPES,
]
const FIELD_LABELS = Object.freeze({
  username: '姓名',
  mobile: '手机号',
  email: '邮箱',
  idCard: '身份证件',
  landlinePhone: '固定电话',
  address: '地址',
  birthday: '生日',
  input: '单行文本',
  textarea: '多行文本',
  radio: '单项选择',
  checkbox: '多项选择',
  select: '下拉选择',
  number: '数字',
  date: '日期',
  time: '时间',
  imageUpload: '图片上传',
  fileUpload: '文件上传',
  cascader: '级联选择',
  signature: '手写签名',
  fieldGroup: '题组',
  description: '描述说明',
  divider: '分割线',
  matrix: '矩阵题',
  matrixChoice: '矩阵选择',
  ranking: '排序题',
  rating: '评分题',
  nps: 'NPS',
})

const SERVER_TYPE_BY_DESIGNER_TYPE = Object.freeze({
  idCard: 'id_card',
  landlinePhone: 'landline_phone',
  imageUpload: 'image_upload',
  fileUpload: 'file_upload',
  fieldGroup: 'field_group',
  matrixChoice: 'matrix_choice',
  ranking: 'sort',
})
const EXPECTED_SERVER_FIELD_SEQUENCE = [
  'page',
  ...CONTACT_FIELD_TYPES,
  'page',
  ...COMMON_FIELD_TYPES,
  'page',
  'cascader',
  'signature',
  'fieldGroup',
  ...CONTACT_PRESET_TYPES,
  'description',
  'divider',
  'matrix',
  'matrixChoice',
  'ranking',
  'rating',
  'nps',
].map((type) => SERVER_TYPE_BY_DESIGNER_TYPE[type] || type)

function timestampTitle(now = Date.now()) {
  return `自动化测试全题型表单-${now}`
}

function pageUrl(siteBaseUrl, path) {
  return new URL(path.replace(/^\/+/, ''), `${siteBaseUrl.replace(/\/+$/, '')}/`).toString()
}

function isApiBusinessRequest(request, apiOrigin) {
  const url = new URL(request.url())
  return url.origin === apiOrigin
    && AUTHENTICATED_API_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
}

function redactUrl(rawUrl) {
  const url = new URL(rawUrl)
  return `${url.origin}${url.pathname}`
}

function fieldLocator(page, type) {
  return page.locator(`.form-field[data-component-type="${type}"][data-container-path=""]`)
}

function nestedFieldLocator(page, groupKey) {
  return page.locator(`.form-field[data-container-path="${groupKey}"]`)
}

function propertyLabel(page, label) {
  return page.locator('.fb-edit-aside label').filter({ hasText: label })
}

async function isSwitchChecked(switchControl) {
  return await switchControl.getAttribute('data-state') === 'checked'
    || await switchControl.getAttribute('aria-checked') === 'true'
}

async function ensurePropertySwitchChecked(page, label, assertionLabel = label) {
  const editor = propertyLabel(page, label)
  await expect(editor, `${assertionLabel}设置应唯一存在`).toHaveCount(1)
  const switchControl = editor.getByRole('switch')
  await expect(switchControl, `${assertionLabel}开关应可见`).toBeVisible()
  if (!await isSwitchChecked(switchControl)) {
    await switchControl.click()
  }
  await expect.poll(
    () => isSwitchChecked(switchControl),
    { message: `${assertionLabel}开关应保持开启` },
  ).toBe(true)
  return switchControl
}

function formatBusinessBody(body) {
  try {
    return JSON.stringify(body).slice(0, 500)
  } catch {
    return String(body)
  }
}

async function assertBusinessResponse(response, label) {
  expect(response.ok(), `${label} HTTP 状态应成功，实际 ${response.status()}`).toBeTruthy()
  const body = await response.json().catch(() => null)
  expect(body && typeof body === 'object', `${label}应返回 JSON 业务信封`).toBeTruthy()
  expect(
    Object.prototype.hasOwnProperty.call(body, 'code'),
    `${label}响应必须包含业务码，实际 ${formatBusinessBody(body)}`,
  ).toBeTruthy()
  expect(body.code, `${label}业务码应为 0，实际响应 ${formatBusinessBody(body)}`).toBe(0)
  return body
}

function waitForExactResponse(page, method, pathnameSuffix) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === method && url.pathname.endsWith(pathnameSuffix)
  }, { timeout: ACTION_TIMEOUT_MS })
}

function shanghaiDateParts(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  }
}

function addLocalDays(parts, days) {
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  }
}

function formatLocalDate(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

async function fillRichTextList(page, editor) {
  const root = editor.locator('xpath=ancestor::div[contains(@class,"fb-richtext-editor")][1]')
  const boldButton = root.getByRole('button', { name: /^(加粗|粗體)/ })
  const bulletButton = root.getByRole('button', { name: /^(无序列表|無序列表)/ })
  await expect(editor, '表单内容富文本编辑器应可见').toBeVisible()
  await editor.click()
  await editor.press('Control+A')
  await editor.press('Backspace')
  await boldButton.click()
  await editor.type(FORM_CONTENT_HEADING)
  await boldButton.click()
  await editor.press('Enter')
  await bulletButton.click()
  await editor.type(FORM_CONTENT_ITEMS[0])
  await editor.press('Enter')
  await editor.type(FORM_CONTENT_ITEMS[1])
  await editor.blur()

  await expect(editor.locator('strong'), '富文本应包含加粗的填写须知').toHaveText(FORM_CONTENT_HEADING)
  await expect(editor.locator('ul > li'), '富文本应包含两条无序列表内容').toHaveCount(FORM_CONTENT_ITEMS.length)
}

async function chooseCalendarDate(page, target, displayedMonth) {
  const overlay = page.locator('[data-fb-date-overlay]')
  await expect(overlay, '日期选择浮层应打开').toBeVisible()
  const monthOffset = (target.year - displayedMonth.year) * 12 + target.month - displayedMonth.month
  expect(monthOffset, '日期选择只应向当前日期之后导航').toBeGreaterThanOrEqual(0)
  for (let index = 0; index < monthOffset; index += 1) {
    await overlay.locator('button:has(svg.lucide-chevron-right)').click()
  }
  const dayButton = overlay
    .locator('.fb-grid-cols-7 button:not(.fb-text-slate-300)')
    .filter({ hasText: new RegExp(`^\\s*${target.day}\\s*$`) })
  await expect(dayButton, `日历中应有可选日期 ${formatLocalDate(target)}`).toHaveCount(1)
  await dayButton.click()
  await expect(overlay, '选择日期后浮层应关闭').toBeHidden()
}

async function uploadImageThroughBrowser(page, input, imagePath, { includeTheme = false, label }) {
  const signaturePromise = waitForExactResponse(page, 'POST', '/base/file/browser-upload/signature')
  const completePromise = waitForExactResponse(page, 'POST', '/base/file/browser-upload/complete')
  const themePromise = includeTheme
    ? waitForExactResponse(page, 'GET', '/base/file/browser-upload/theme')
    : null

  await input.setInputFiles(imagePath)
  const signatureResponse = await signaturePromise
  const signatureBody = await assertBusinessResponse(signatureResponse, `${label}上传签名`)
  const uploadId = String(signatureBody.data?.upload_id ?? '').trim()
  expect(uploadId, `${label}上传签名应返回 upload_id`).toBeTruthy()

  if (themePromise) {
    const themeResponse = await themePromise
    const themeBody = await assertBusinessResponse(themeResponse, `${label}智能配色`)
    expect(
      Array.isArray(themeBody.data?.color_theme?.palette)
        && themeBody.data.color_theme.palette.length > 0,
      `${label}智能配色应返回非空 palette`,
    ).toBeTruthy()
    expect(new URL(themeResponse.url()).searchParams.get('upload_id'), '智能配色应使用签名 upload_id').toBe(uploadId)
  }

  const completeResponse = await completePromise
  const completeBody = await assertBusinessResponse(completeResponse, `${label}上传完成确认`)
  expect(completeBody.data?.id, `${label}上传完成应返回文件 id`).toBeTruthy()
  expect(completeBody.data?.full_path, `${label}上传完成应返回完整访问地址`).toBeTruthy()
  return uploadId
}

async function clickFirstVisible(locators, label) {
  for (const locator of locators) {
    if (await locator.first().isVisible().catch(() => false)) {
      await locator.first().click()
      return
    }
  }
  throw new Error(`页面中未找到可点击的“${label}”控件`)
}

async function waitForApiResponse(page, urlPattern, action, label) {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname.includes(urlPattern) && response.request().method() !== 'GET'
  }, { timeout: ACTION_TIMEOUT_MS })
  await action()
  const response = await responsePromise
  const body = await assertBusinessResponse(response, label)
  return { response, body }
}

async function screenshotFailure(page, title) {
  await mkdir(SCREENSHOT_DIR, { recursive: true })
  const safeTitle = title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '_')
  const path = resolve(SCREENSHOT_DIR, `${safeTitle}-失败-${Date.now()}.png`)
  await page.screenshot({ path, fullPage: true }).catch(() => undefined)
  return path
}

async function chooseContactCollectionInDesigner(page, logger) {
  const prompt = page.getByRole('dialog').filter({ hasText: /此表单目前设置为不收录联系人|此表單目前設定為不收錄聯絡人/ })
  if (await prompt.isVisible().catch(() => false)) {
    logger('info', '联系人题触发全局收录提示，选择开启收录联系人')
    await clickFirstVisible([
      prompt.getByRole('button', { name: /是|確認|确定|Yes/i }),
      prompt.locator('.fb-dialog-btn--primary'),
    ], '开启收录联系人')
  }

  const collectDialog = page.getByRole('dialog').filter({ hasText: /是否收录联系人|是否收錄聯絡人/ })
  const collectDialogVisible = await collectDialog
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false)
  if (collectDialogVisible) {
    await clickFirstVisible([
      collectDialog.getByRole('button', { name: /确认收录到联系人|確認收錄到聯絡人/ }),
    ], '确认收录到联系人')
  }

  const replaceDialog = page.getByRole('dialog').filter({ hasText: /联系人信息替换确认|聯絡人資訊替換確認/ })
  const replaceDialogVisible = await replaceDialog
    .waitFor({ state: 'visible', timeout: collectDialogVisible ? 5_000 : 1_000 })
    .then(() => true)
    .catch(() => false)
  if (replaceDialogVisible) {
    await replaceDialog.getByText(/忽略，不替换|忽略，不替換/, { exact: true }).click()
    const saveResult = await waitForApiResponse(
      page,
      '/config',
      () => clickFirstVisible([
        replaceDialog.getByRole('button', { name: /确定|確認|OK/i }),
        replaceDialog.locator('button').last(),
      ], '确认忽略不替换'),
      '保存联系人收录策略',
    )
    expect(saveResult.body?.code ?? 0, '联系人收录策略应保存成功').toBe(0)
    await expect(replaceDialog, '联系人收录设置保存后弹窗应关闭').toBeHidden()
  } else if (collectDialogVisible) {
    throw new Error('确认收录联系人后未进入“联系人信息替换确认”步骤')
  }
}

async function hasPresetContactFields(page) {
  const counts = await Promise.all(CONTACT_PRESET_TYPES.map((type) => fieldLocator(page, type).count()))
  return counts.every((count) => count === 1)
}

async function ensureFieldRequired(page, type, logger) {
  const label = FIELD_LABELS[type] || type
  const field = fieldLocator(page, type)
  await expect(field, `${label}题应唯一存在`).toHaveCount(1)
  await field.click()

  const requiredEditor = page
    .locator('.fb-edit-aside label')
    .filter({ hasText: /是否必填/ })
  await expect(requiredEditor, `${label}题应提供唯一的“是否必填”设置`).toHaveCount(1)
  const requiredSwitch = requiredEditor.getByRole('switch')
  await expect(requiredSwitch, `${label}题的必填开关应可见`).toBeVisible()
  if (!await isSwitchChecked(requiredSwitch)) {
    await requiredSwitch.click()
  }
  await expect.poll(
    () => isSwitchChecked(requiredSwitch),
    { message: `${label}题应设置为必填` },
  ).toBe(true)
  logger('success', `${label}题已设置为必填`, { type })
}

async function addPaletteField(page, type, logger, { required = true } = {}) {
  const label = FIELD_LABELS[type] || type
  const palette = page.locator(`button[data-component-type="${type}"]`)
  const fields = fieldLocator(page, type)
  const beforeCount = await fields.count()
  await expect(palette, `题型库应显示${label}`).toBeVisible()
  await expect(palette, `${label}题型应可用`).toBeEnabled()
  await expect(page.locator('.fb-dialog-overlay[data-state="open"]'), `添加${label}前不应存在遮罩弹窗`).toHaveCount(0)
  logger('info', `添加${label}题`, { type })
  await palette.click()
  await expect(fields, `${label}题应成功加入表单`).toHaveCount(beforeCount + 1)
  if (required) {
    await ensureFieldRequired(page, type, logger)
  }
}

async function addPageBreak(page, expectedPageCount, logger, label) {
  const palette = page.locator('button[data-component-type="page"]')
  await expect(palette, '题型库应显示分页组件').toBeVisible()
  await expect(palette, '分页组件应可用').toBeEnabled()
  logger('info', `添加分页：${label}`)
  await palette.click()
  await expect(fieldLocator(page, 'page'), `添加后应形成 ${expectedPageCount} 页`).toHaveCount(expectedPageCount)
  logger('success', `分页断言通过：当前共 ${expectedPageCount} 页`)
}

async function assertFieldStructure(page, logger) {
  const rootFields = page.locator('.form-field[data-container-path=""]')
  await expect(rootFields, `表单根级组件总数应为 ${EXPECTED_FIELD_SEQUENCE.length}`).toHaveCount(EXPECTED_FIELD_SEQUENCE.length)
  const actualTypes = await rootFields.evaluateAll((elements) => elements.map((element) => element.dataset.componentType))
  expect(actualTypes, '三页题型顺序应为联系人、通用、高级').toEqual(EXPECTED_FIELD_SEQUENCE)
  await expect(fieldLocator(page, 'payment'), '不应添加付款档位').toHaveCount(0)
  logger('success', '三页题型结构断言通过', {
    pageCount: 3,
    contactFieldCount: CONTACT_FIELD_TYPES.length,
    commonFieldCount: COMMON_FIELD_TYPES.length,
    advancedFieldCount: ADVANCED_FIELD_TYPES.length,
    totalComponentCount: EXPECTED_FIELD_SEQUENCE.length,
    requiredQuestionCount: REQUIRED_FIELD_TYPES.length,
  })
}

async function configureFormIntroduction(page, title, logger) {
  const titleEditor = page.locator('h1 .editable-div[contenteditable="true"]').first()
  await expect(titleEditor, '表单标题编辑区应可见').toBeVisible()
  await titleEditor.fill(title)
  await titleEditor.blur()
  await expect(titleEditor, '表单标题应更新为当前时间戳名称').toHaveText(title)

  const subtitleEditor = page.locator('.fb-runtime-form-subtitle .editable-div[contenteditable="true"]')
  await expect(subtitleEditor, '表单描述纯文本编辑区应唯一存在').toHaveCount(1)
  await subtitleEditor.fill(FORM_SUBTITLE)
  await subtitleEditor.blur()
  await expect(subtitleEditor, '表单描述应保存为纯文本').toHaveText(FORM_SUBTITLE)

  const contentEditor = page.locator('.designer-info-content-wrap .ProseMirror[contenteditable="true"]')
  await expect(contentEditor, '表单内容富文本编辑区应唯一存在').toHaveCount(1)
  await fillRichTextList(page, contentEditor)
  logger('success', '表单标题、纯文本描述和富文本内容已填写')
}

async function configureFirstPageFields(page, logger) {
  await fieldLocator(page, 'username').click()
  await ensurePropertySwitchChecked(page, /采集称谓|採集稱謂/, '姓名题“采集称谓”')

  await fieldLocator(page, 'idCard').click()
  await ensurePropertySwitchChecked(page, /自定义证件类型|自訂證件類型/, '身份证件“自定义证件类型”')
  logger('success', '第 1 页姓名称谓和自定义证件类型已开启')
}

async function configureSecondPageFields(page, imagePath, today, endDate, logger) {
  const inputField = fieldLocator(page, 'input')
  await inputField.click()
  await ensurePropertySwitchChecked(page, /是否字数限制|是否字數限制/, '单行文本字数限制')
  const inputLengthRange = page.locator('.fb-edit-aside .property-editor-range-number')
  await expect(inputLengthRange, '单行文本应显示唯一字数范围设置').toHaveCount(1)
  const inputMax = inputLengthRange.getByPlaceholder(/最大值/)
  await inputMax.fill('20')
  await inputMax.blur()
  await expect(inputMax, '单行文本最多输入数应为 20').toHaveValue('20')

  const radioField = fieldLocator(page, 'radio')
  await radioField.click()
  await ensurePropertySwitchChecked(page, /允许用户输入|允許用戶輸入/, '单项选择允许用户输入')
  await ensurePropertySwitchChecked(page, /添加选项图片|新增選項圖片/, '单项选择添加选项图片')
  const optionImageInputs = radioField.locator(
    'input[type="file"][id^="option-image-"]:not([id$="--1"])',
  )
  await expect(optionImageInputs, '单项选择前两个普通选项应各有图片上传框').toHaveCount(2)
  const radioOptionUploadIds = []
  for (let index = 0; index < 2; index += 1) {
    radioOptionUploadIds.push(await uploadImageThroughBrowser(
      page,
      optionImageInputs.nth(index),
      imagePath,
      { label: `单项选择第 ${index + 1} 个选项图片` },
    ))
  }
  await expect(radioField.locator('img'), '单项选择前两个选项应显示已上传图片').toHaveCount(2)

  const checkboxField = fieldLocator(page, 'checkbox')
  await checkboxField.click()
  const checkboxOptionHandles = checkboxField.locator(
    'button.checkbox-option-handle:not(.fb-text-transparent)',
  )
  for (let attempts = 0; attempts < 3 && await checkboxOptionHandles.count() < 3; attempts += 1) {
    await checkboxField.getByRole('button', { name: /添加选项|新增選項/, exact: true }).click()
  }
  await expect(checkboxOptionHandles, '多项选择至少应有 3 个普通选项').toHaveCount(3)
  await ensurePropertySwitchChecked(page, /选择限制|選擇限制/, '多项选择数量限制')
  const checkboxRange = page.locator('.fb-edit-aside .property-editor-range-number')
  await expect(checkboxRange, '多项选择应显示唯一数量范围设置').toHaveCount(1)
  await checkboxRange.getByPlaceholder(/最小值/).fill('2')
  await checkboxRange.getByPlaceholder(/最大值/).fill('3')
  await expect(checkboxRange.getByPlaceholder(/最小值/)).toHaveValue('2')
  await expect(checkboxRange.getByPlaceholder(/最大值/)).toHaveValue('3')

  await fieldLocator(page, 'number').click()
  await ensurePropertySwitchChecked(page, /设置限制|設定限制/, '数字设置限制')

  await fieldLocator(page, 'date').click()
  await ensurePropertySwitchChecked(page, /日期范围限定|日期範圍限定/, '日期范围限定')
  const dateRows = page.locator('.fb-edit-aside .date-range-limit > div')
  await expect(dateRows, '日期范围应包含开始和结束日期').toHaveCount(2)
  const startRow = dateRows.filter({ hasText: /开始日期|開始日期/ })
  const endRow = dateRows.filter({ hasText: /结束日期|結束日期/ })
  await startRow.getByRole('button').first().click()
  await chooseCalendarDate(page, today, today)
  await endRow.getByRole('button').first().click()
  await chooseCalendarDate(page, endDate, today)
  await expect(startRow.getByRole('button').first()).toContainText(formatLocalDate(today))
  await expect(endRow.getByRole('button').first()).toContainText(formatLocalDate(endDate))

  logger('success', '第 2 页输入、选择、数字和日期限制已配置', {
    dateStart: formatLocalDate(today),
    dateEnd: formatLocalDate(endDate),
  })
  return radioOptionUploadIds
}

async function configureCascader(page, logger) {
  const cascaderField = fieldLocator(page, 'cascader')
  await cascaderField.click()
  const multipleButton = page.locator('.fb-edit-aside').getByRole('button', {
    name: /^(多选|多選)$/,
  })
  await expect(multipleButton, '级联选择题型设置应提供“多选”').toHaveCount(1)
  await multipleButton.click()

  await cascaderField.getByRole('button', { name: /添加选项|新增選項/, exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: /选项设置|選項設定/ })
  await expect(dialog, '级联选择应打开选项设置弹窗').toBeVisible()
  await dialog.getByRole('tab', { name: /^(3级|3級)$/ }).click()
  const batchButtons = dialog.getByRole('button', { name: /批量编辑|批量編輯/, exact: true })
  await expect(batchButtons, '三级级联应显示三列批量编辑入口').toHaveCount(3)

  for (let level = 0; level < CASCADER_LEVEL_VALUES.length; level += 1) {
    await batchButtons.nth(level).click()
    const batchOverlay = page.locator('div.fb-fixed.fb-inset-0').filter({
      has: page.locator('textarea'),
    }).last()
    await expect(batchOverlay, `第 ${level + 1} 级批量编辑弹层应可见`).toBeVisible()
    await batchOverlay.locator('textarea').fill(CASCADER_LEVEL_VALUES[level])
    await batchOverlay.getByRole('button', { name: /^(确定|確認)$/ }).click()
    await expect(batchOverlay, `第 ${level + 1} 级批量编辑弹层应关闭`).toBeHidden()
  }

  await dialog.getByRole('button', { name: /保存设置|儲存設定/, exact: true }).click()
  await expect(dialog, '保存三级级联后设置弹窗应关闭').toBeHidden()
  logger('success', '级联选择已开启多选并配置固定三级数据', {
    path: CASCADER_LEVEL_VALUES.join(' -> '),
  })
}

async function handleProxyEnrollmentDialog(page, formId, logger) {
  const dialog = page.getByRole('dialog').filter({
    hasText: /支持在题组创建姓名题型并收录联系人|支持在題組建立姓名題型並收錄聯絡人/,
  })
  const visible = await dialog.waitFor({ state: 'visible', timeout: 2_000 })
    .then(() => true)
    .catch(() => false)
  if (!visible) return

  logger('info', '题组联系人触发代为报名确认，保存活动报名类型')
  const updatePromise = waitForExactResponse(page, 'PUT', `/be/form/${formId}/activity/update-props`)
  const detailPromise = waitForExactResponse(page, 'GET', `/be/form/${formId}`)
  await dialog.getByRole('button', { name: /我已知悉/ }).click()
  await assertBusinessResponse(await updatePromise, '保存代为报名设置')
  await assertBusinessResponse(await detailPromise, '刷新代为报名表单详情')
  await expect(dialog, '代为报名确认完成后弹窗应关闭').toBeHidden()
}

async function addContactFieldsToGroup(page, formId, logger) {
  const group = fieldLocator(page, 'fieldGroup')
  await group.scrollIntoViewIfNeeded()
  await group.click()
  const groupKey = String(await group.getAttribute('data-field-key') ?? '').trim()
  expect(groupKey, '题组根节点必须包含 data-field-key').toBeTruthy()
  const groupPanel = group.locator('.field-panel').first()
  await expect(groupPanel, '题组内应有可拖放子画布').toBeVisible()
  const contactPalette = page.locator('button[data-component-type="contactGroup"]')
  await contactPalette.scrollIntoViewIfNeeded()
  await contactPalette.dragTo(groupPanel)
  await handleProxyEnrollmentDialog(page, formId, logger)

  const children = nestedFieldLocator(page, groupKey)
  await expect(children, '题组内联系人应平铺生成 3 个子题').toHaveCount(3)
  const childTypes = await children.evaluateAll((elements) => (
    elements.map((element) => element.dataset.componentType)
  ))
  expect(childTypes, '题组内联系人顺序应为姓名、手机号、邮箱').toEqual(CONTACT_PRESET_TYPES)

  for (const type of CONTACT_PRESET_TYPES) {
    const child = page.locator(
      `.form-field[data-component-type="${type}"][data-container-path="${groupKey}"]`,
    )
    await child.click()
    await ensurePropertySwitchChecked(
      page,
      /是否收录联系人|是否收錄聯絡人/,
      `题组内${FIELD_LABELS[type]}收录联系人`,
    )
  }
  logger('success', '题组内已加入姓名、手机号、邮箱，且全部开启收录联系人')
  return groupKey
}

async function configureLayoutFields(page, logger) {
  const descriptionField = fieldLocator(page, 'description')
  await descriptionField.click()
  const descriptionTitle = descriptionField.locator('.editable-div[contenteditable="true"]').first()
  await descriptionTitle.fill(DESCRIPTION_FIELD_TITLE)
  await descriptionTitle.blur()
  const descriptionEditor = descriptionField.locator(
    '.description-wrapper__desc-editor .ProseMirror[contenteditable="true"]',
  )
  await descriptionEditor.fill(DESCRIPTION_FIELD_CONTENT)
  await descriptionEditor.blur()
  await expect(descriptionTitle).toHaveText(DESCRIPTION_FIELD_TITLE)
  await expect(descriptionEditor).toContainText(DESCRIPTION_FIELD_CONTENT)

  await fieldLocator(page, 'divider').click()
  const dividerEditor = propertyLabel(page, /分割线文案|分割線文案/)
  await expect(dividerEditor, '分割线文案设置应唯一存在').toHaveCount(1)
  await dividerEditor.locator('input').fill(DIVIDER_TEXT)
  await dividerEditor.locator('input').blur()
  await expect(dividerEditor.locator('input')).toHaveValue(DIVIDER_TEXT)
  logger('success', '题组后描述说明和分割线内容已补充')
}

async function uploadHeaderImageAndApplyTheme(page, imagePath, logger) {
  const previewButton = page.getByRole('button', { name: /^(预览|預覽)$/ })
  await expect(previewButton, '设计器顶部应显示预览按钮').toBeVisible()
  await previewButton.click()
  await expect(page.getByText(/呈现设置|呈現設定/, { exact: true }), '预览模式应显示呈现设置').toBeVisible()
  const previewSettings = page.locator('.fb-form-fields')
  const headerImageInput = previewSettings.locator('input[type="file"][accept="image/*"]')
  await expect(headerImageInput, '呈现设置中应有唯一头图上传框').toHaveCount(1)
  const uploadId = await uploadImageThroughBrowser(page, headerImageInput, imagePath, {
    includeTheme: true,
    label: '表单头图',
  })

  const colorDialog = page.getByRole('dialog').filter({ hasText: /智能色系调色盘|智能色系調色盤/ })
  await expect(colorDialog, '头图上传后应显示智能色系调色盘').toBeVisible()
  await colorDialog.getByRole('button', { name: /应用配色|應用配色/, exact: true }).click()
  await expect(colorDialog, '应用系统推荐配色后弹窗应关闭').toBeHidden()
  logger('success', '头图上传完成并已应用系统推荐配色', { uploadId })
  return uploadId
}

function findServerItem(items, typeCode, predicate = () => true) {
  return items.find((item) => item?.type_code === typeCode && predicate(item))
}

function expectHexColor(value, label) {
  expect(String(value ?? ''), `${label}应为十六进制颜色`).toMatch(/^#[0-9a-f]{6}$/i)
}

function assertSavedPayloads({
  itemsPayload,
  configPayload,
  title,
  today,
  endDate,
  radioOptionUploadIds,
  headerUploadId,
}) {
  expect(Number(itemsPayload?.revision_no), '题目保存 revision_no 应至少为 1').toBeGreaterThanOrEqual(1)
  expect(configPayload?.revision_no, '题目和配置保存必须使用同一 revision_no').toBe(itemsPayload.revision_no)
  expect(itemsPayload.title, '保存标题应与设计器一致').toBe(title)
  expect(itemsPayload.subtitle, '表单描述应以纯文本保存').toBe(FORM_SUBTITLE)
  expect(itemsPayload.description, '表单内容应包含加粗格式').toContain('<strong>')
  expect(itemsPayload.description, '表单内容应包含无序列表').toContain('<ul>')
  for (const text of [FORM_CONTENT_HEADING, ...FORM_CONTENT_ITEMS]) {
    expect(itemsPayload.description, `表单内容应包含“${text}”`).toContain(text)
  }

  const items = itemsPayload.items
  expect(Array.isArray(items), '题目保存 payload.items 必须为数组').toBeTruthy()
  expect(items.every((item) => Number(item?.sort) >= 1), '保存的每个题目都应包含有效 sort').toBeTruthy()
  const businessItems = items.filter((item) => Number(item?.hidden) !== 1)
  expect(
    businessItems.map((item) => item.type_code),
    '服务端题目顺序应包含三页根组件及题组内联系人',
  ).toEqual(EXPECTED_SERVER_FIELD_SEQUENCE)
  for (const systemKey of SYSTEM_ITEM_KEYS) {
    expect(items.some((item) => item?.item_key === systemKey && Number(item.hidden) === 1),
      `保存 payload 应包含隐藏系统题 ${systemKey}`).toBeTruthy()
  }

  const rootUsername = findServerItem(items, 'username', (item) => !item.group_code)
  expect(rootUsername?.common_config?.name_title?.enabled, '姓名题应开启采集称谓').toBe(1)
  const idCard = findServerItem(items, 'id_card')
  expect(idCard?.common_config?.collect_mode?.custom_enabled, '身份证件应开启自定义证件类型').toBe(1)
  const input = findServerItem(items, 'input', (item) => item.item_key !== 'device')
  expect(input?.rule_config?.length?.enabled, '单行文本应开启字数限制').toBe(1)
  expect(Number(input?.rule_config?.length?.max), '单行文本最大字数应为 20').toBe(20)

  const radio = findServerItem(items, 'radio')
  expect(radio?.common_config?.allow_customized_text?.enabled, '单项选择应允许用户输入').toBe(1)
  expect(radio?.common_config?.allow_image, '单项选择应开启选项图片').toBe(1)
  expect(radio?.option?.choices?.slice(0, 2).map((choice) => choice.upload_id),
    '单项选择前两个选项应保存对应 upload_id').toEqual(radioOptionUploadIds)

  const checkbox = findServerItem(items, 'checkbox')
  expect(checkbox?.option?.choices?.length, '多项选择至少应有三个选项').toBeGreaterThanOrEqual(3)
  expect(checkbox?.rule_config?.length?.enabled, '多项选择应开启数量限制').toBe(1)
  expect(Number(checkbox?.rule_config?.length?.min), '多项选择最少应选 2 个').toBe(2)
  expect(Number(checkbox?.rule_config?.length?.max), '多项选择最多应选 3 个').toBe(3)

  const number = findServerItem(items, 'number', (item) => item.item_key !== 'duration')
  const numberLimit = number?.rule_config?.length
  expect(numberLimit?.enabled, '数字应开启设置限制').toBe(1)
  const numberBounds = [numberLimit?.min, numberLimit?.max]
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
  expect(
    numberBounds.every((value) => Number.isFinite(Number(value))),
    '数字默认最小值和最大值（如有）应为有效数字',
  ).toBeTruthy()
  if (numberBounds.length === 2) {
    expect(Number(numberLimit.min), '数字默认最小值不应大于最大值').toBeLessThanOrEqual(Number(numberLimit.max))
  }
  const numberDecimals = Number(number?.common_config?.decimals)
  expect(Number.isInteger(numberDecimals), '数字默认小数位应为整数').toBeTruthy()
  expect(numberDecimals, '数字默认小数位应在 0-3 范围内').toBeGreaterThanOrEqual(0)
  expect(numberDecimals, '数字默认小数位应在 0-3 范围内').toBeLessThanOrEqual(3)

  const date = findServerItem(items, 'date')
  expect(date?.rule_config?.date_range?.enabled, '日期应开启范围限定').toBe(1)
  expect(date?.rule_config?.date_range?.start, '日期开始值应为运行当天').toBe(formatLocalDate(today))
  expect(date?.rule_config?.date_range?.end, '日期结束值应为运行当天加 30 天').toBe(formatLocalDate(endDate))

  const cascader = findServerItem(items, 'cascader')
  expect(cascader?.common_config?.type_mode, '级联选择应为多选').toBe('multiple')
  expect(Number(cascader?.common_config?.levels), '级联选择应为三级').toBe(3)
  const cascaderPath = [
    cascader?.option?.choices?.[0]?.name,
    cascader?.option?.choices?.[0]?.sub_choices?.[0]?.name,
    cascader?.option?.choices?.[0]?.sub_choices?.[0]?.sub_choices?.[0]?.name,
  ]
  expect(cascaderPath, '级联选择应保存固定三级数据').toEqual(CASCADER_LEVEL_VALUES)

  const fieldGroup = findServerItem(items, 'field_group')
  expect(fieldGroup?.item_key, '题组应保存 item_key').toBeTruthy()
  const groupChildren = items.filter((item) => item?.group_code === fieldGroup.item_key)
  expect(groupChildren.map((item) => item.type_code), '题组内应保存姓名、手机号、邮箱').toEqual(CONTACT_PRESET_TYPES)
  for (const child of groupChildren) {
    expect(child?.common_config?.collect_to_contact?.enabled,
      `题组内 ${child.type_code} 应默认收录联系人`).toBe(1)
  }

  const description = findServerItem(items, 'description')
  expect(description?.label, '描述说明标题应保存').toBe(DESCRIPTION_FIELD_TITLE)
  expect(description?.description, '描述说明正文应保存').toContain(DESCRIPTION_FIELD_CONTENT)
  const divider = findServerItem(items, 'divider')
  expect(divider?.label, '分割线文案应保存').toBe(DIVIDER_TEXT)

  expect(
    configPayload?.theme_config?.header_image?.image?.upload_id,
    '配置保存应携带头图 upload_id',
  ).toBe(headerUploadId)
  expectHexColor(configPayload?.theme_config?.submit_button?.background_color, '系统推荐提交按钮配色')
  expectHexColor(configPayload?.theme_config?.form_container?.background_color, '系统推荐表单底色')
  expectHexColor(configPayload?.theme_config?.wallpaper?.background_color?.color, '系统推荐页面底色')
  return Number(itemsPayload.revision_no)
}

async function ensureIgnoreStrategyInSettings(page, logger) {
  logger('info', '进入基础设置并打开“收录联系人设置”')
  const basicSettingsStep = page
    .locator('.form-activity-step-nav .form-activity-step')
    .filter({ hasText: /基础设置|基礎設定/ })
  await expect(basicSettingsStep, '顶部步骤导航中应有唯一的“基础设置”入口').toHaveCount(1)
  await expect(basicSettingsStep, '“基础设置”步骤应可点击').toBeVisible()
  await basicSettingsStep.click()
  await page.waitForURL(/\/form-activity\/settings\?[^#]*id=/, { timeout: NAVIGATION_TIMEOUT_MS })
  await page.locator('[data-menu-key="collect-contact"]').click()

  const switchControl = page.getByRole('switch', { name: /是否收录联系人开关|是否收錄聯絡人開關/ })
  await expect(switchControl, '联系人收录开关应显示').toBeVisible()
  const state = await switchControl.getAttribute('data-state')
  if (state !== 'checked' && await switchControl.getAttribute('aria-checked') !== 'true') {
    await switchControl.click()
  } else {
    await page.getByRole('button', { name: /是否收录联系人|是否收錄聯絡人/ }).click()
  }

  const ignoreRadio = page.getByRole('radio', { name: /忽略，不替换|忽略，不替換/ })
  await expect(ignoreRadio, '应显示“忽略，不替换”策略').toBeVisible()
  await ignoreRadio.click()
  await waitForApiResponse(
    page,
    '/config',
    () => page.getByRole('button', { name: /确认|確認/, exact: true }).click(),
    '确认联系人收录设置',
  )

  await expect.poll(
    () => isSwitchChecked(switchControl),
    { message: '联系人收录开关应保持开启' },
  ).toBe(true)
  await expect(page.getByText(/忽略，不替换|忽略，不替換/, { exact: true }), '设置页应回显忽略策略').toBeVisible()
  logger('success', '联系人收录已开启，冲突策略为“忽略，不替换”')
}

export async function run({
  siteBaseUrl,
  apiBaseUrl,
  ignoreHTTPSErrors = false,
  extraHTTPHeaders,
  headerImagePath = DEFAULT_HEADER_IMAGE_PATH,
  captureFailureScreenshot = true,
  signal,
  logger,
}) {
  expect(siteBaseUrl, '运行环境必须提供 Web 基址').toBeTruthy()
  expect(apiBaseUrl, '运行环境必须提供 API 基址').toBeTruthy()
  const authorization = extraHTTPHeaders?.Authorization
  expect(authorization, '所有业务请求必须使用环境登录后的 Token').toBeTruthy()

  const title = timestampTitle()
  const imagePath = resolve(headerImagePath)
  await access(imagePath).catch(() => {
    throw new Error(`头图文件不存在或不可读取：${imagePath}`)
  })
  const today = shanghaiDateParts()
  const endDate = addLocalDays(today, 30)
  const siteOrigin = new URL(siteBaseUrl).origin
  const apiOrigin = new URL(apiBaseUrl).origin
  expect(siteOrigin, 'Web 基址与 API 基址必须同源').toBe(apiOrigin)

  let browser
  let context
  let page
  let stopAbortClose = () => undefined
  try {
    throwIfRunAborted(signal)
    logger('info', '启动 Chrome 无头浏览器，界面不会显示', { browser: 'Google Chrome', headless: true })
    browser = await chromium.launch({ channel: 'chrome', headless: true })
    stopAbortClose = closePlaywrightOnAbort(signal, () => ({ browser, context }), { logger })
    throwIfRunAborted(signal)
    context = await browser.newContext({
      ignoreHTTPSErrors,
      viewport: { width: 1600, height: 1000 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    })
    throwIfRunAborted(signal)
    page = await context.newPage()
    page.setDefaultTimeout(ACTION_TIMEOUT_MS)
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS)

    let businessRequestCount = 0
    let authenticatedRequestCount = 0
    const tokenViolations = []
    page.on('request', (request) => {
      if (!isApiBusinessRequest(request, apiOrigin)) return
      businessRequestCount += 1
      if (request.headers().authorization === authorization) {
        authenticatedRequestCount += 1
        return
      }
      tokenViolations.push(`${request.method()} ${redactUrl(request.url())}`)
    })

    await context.addInitScript(({ token }) => {
      localStorage.setItem('token', token)
      localStorage.setItem('arco-locale', 'zh-CN')
    }, { token: authorization })
    logger('success', '已将环境登录 Token 注入浏览器会话（Token 内容已隐藏）')

    let formId = ''
    logger('info', '访问表单活动创建页', { path: '/form-activity/index', title })
    await page.goto(pageUrl(siteBaseUrl, '/form-activity/index'), { waitUntil: 'domcontentloaded' })
    await expect(page, 'Token 生效后不应跳转登录页').not.toHaveURL(/\/login(?:[/?#]|$)/)

    const createResponse = await waitForApiResponse(
      page,
      '/be/form',
      () => page.getByText(/从空白表单开始|從空白表單開始/, { exact: true }).click(),
      '通过页面创建空白表单',
    )
    await page.waitForURL(/\/form-activity\/designer\?[^#]*id=/, { timeout: NAVIGATION_TIMEOUT_MS })
    formId = new URL(page.url()).searchParams.get('id') || String(createResponse.body?.data?.id ?? '')
    expect(formId, '创建表单后 URL 或响应中必须包含表单 id').toBeTruthy()
    logger('success', '已通过页面进入表单设计器', { formId })

    const contactPalette = page.locator('button[data-component-type="contactGroup"]')
    await expect(contactPalette, '设计器题型库应显示联系人快捷项').toBeVisible()

    const initialCollectDialog = page.getByRole('dialog').filter({ hasText: /是否收录联系人|是否收錄聯絡人/ })
    const initialDialogVisible = await initialCollectDialog
      .waitFor({ state: 'visible', timeout: 3_000 })
      .then(() => true)
      .catch(() => false)
    if (initialDialogVisible) {
      logger('info', '检测到设计器首次联系人收录弹窗，先完成“忽略，不替换”设置')
      await chooseContactCollectionInDesigner(page, logger)
    }

    if (!await hasPresetContactFields(page)) {
      await expect(page.locator('.fb-dialog-overlay[data-state="open"]'), '点击联系人前页面不应存在遮罩弹窗').toHaveCount(0)
      await contactPalette.click()
      await chooseContactCollectionInDesigner(page, logger)
    } else {
      logger('info', '首次联系人收录设置已自动生成姓名、手机号、邮箱')
    }

    for (const type of CONTACT_PRESET_TYPES) {
      await ensureFieldRequired(page, type, logger)
    }
    for (const type of CONTACT_EXTRA_TYPES) {
      await addPaletteField(page, type, logger)
    }
    logger('success', '第 1 页联系人题添加完成，共 7 题且全部必填')

    await addPageBreak(page, 2, logger, '联系人题之后')
    for (const type of COMMON_FIELD_TYPES) {
      await addPaletteField(page, type, logger)
    }
    logger('success', '第 2 页通用题添加完成，共 10 题且全部必填')

    await addPageBreak(page, 3, logger, '通用题之后')
    for (const type of ADVANCED_FIELD_TYPES) {
      await addPaletteField(page, type, logger, {
        required: !NON_ANSWERABLE_FIELD_TYPES.has(type),
      })
    }
    logger('info', '题组、描述说明和分割线是布局组件，不设置“是否必填”')
    logger('success', '第 3 页高级题添加完成，共 10 个根组件，7 个可作答题均为必填')

    await assertFieldStructure(page, logger)

    await configureFormIntroduction(page, title, logger)
    await configureFirstPageFields(page, logger)
    const radioOptionUploadIds = await configureSecondPageFields(
      page,
      imagePath,
      today,
      endDate,
      logger,
    )
    await configureCascader(page, logger)
    await addContactFieldsToGroup(page, formId, logger)
    await configureLayoutFields(page, logger)
    const headerUploadId = await uploadHeaderImageAndApplyTheme(page, imagePath, logger)

    logger('info', '点击“保存草稿”')
    const itemSavePromise = waitForExactResponse(page, 'PUT', `/be/form/${formId}/items`)
    const configSavePromise = waitForExactResponse(page, 'PUT', `/be/form/${formId}/config`)
    await page.getByRole('button', { name: /^(保存草稿|儲存草稿|保存|儲存)$/ }).click()
    const [itemSaveResponse, configSaveResponse] = await Promise.all([
      itemSavePromise,
      configSavePromise,
    ])
    await assertBusinessResponse(itemSaveResponse, '保存表单题目')
    await assertBusinessResponse(configSaveResponse, '保存表单配置')
    const itemsPayload = itemSaveResponse.request().postDataJSON()
    const configPayload = configSaveResponse.request().postDataJSON()
    const savedRevisionNo = assertSavedPayloads({
      itemsPayload,
      configPayload,
      title,
      today,
      endDate,
      radioOptionUploadIds,
      headerUploadId,
    })
    await expect(page.getByText(/保存成功|儲存成功/).last(), '页面应提示保存成功').toBeVisible()
    logger('success', '三页全题型表单已保存为草稿', {
      title,
      revisionNo: savedRevisionNo,
      totalComponentCount: EXPECTED_FIELD_SEQUENCE.length,
      requiredQuestionCount: REQUIRED_FIELD_TYPES.length,
    })

    await ensureIgnoreStrategyInSettings(page, logger)

    logger('info', '点击设置页“发布”按钮')
    const publishButton = page.getByRole('button', { name: /^(发布|發佈)$/ })
    if (!await publishButton.isVisible().catch(() => false)) {
      const auditButton = page.getByRole('button', { name: /提交审核|提交審核/ })
      if (await auditButton.isVisible().catch(() => false)) {
        throw new Error('当前机构要求发布审批，本脚本需要可直接发布环境；未自动绕过审批流程')
      }
    }
    await expect(publishButton, '设置页应显示可直接发布按钮').toBeVisible()
    const publishPromise = waitForExactResponse(page, 'POST', `/be/form/${formId}/publish`)
    await publishButton.click()
    const publishResponse = await publishPromise
    const publishBody = await assertBusinessResponse(publishResponse, '发布表单')
    expect(String(publishBody.data?.form_id ?? ''), '发布响应 form_id 应匹配').toBe(String(formId))
    expect(publishBody.data?.status, '发布响应状态应为 published').toBe('published')
    expect(Number(publishBody.data?.revision_no), '发布响应 revision_no 应匹配已保存版本').toBe(savedRevisionNo)
    await page.waitForURL(/\/form-activity\/list(?:[/?#]|$)/, { timeout: NAVIGATION_TIMEOUT_MS })
    logger('success', '表单发布成功并已回到列表页')

    const auditTabs = page.locator('.form-activity-audit-tabs')
    if (await auditTabs.isVisible().catch(() => false)) {
      await auditTabs.getByText(/已发布|已發佈/, { exact: true }).click()
    }
    const titleInput = page.getByPlaceholder(/请输入标题|請輸入標題/)
    await expect(titleInput, '列表标题筛选框应可见').toBeVisible()
    await titleInput.fill(title)
    const listSearchPromise = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === 'GET'
        && url.pathname.endsWith('/be/form/list')
        && url.searchParams.get('filter[title]') === title
    }, { timeout: ACTION_TIMEOUT_MS })
    await page.getByRole('button', { name: /查询|查詢|搜索|搜尋/ }).click()
    const listBody = await assertBusinessResponse(await listSearchPromise, '查询已发布表单列表')
    const publishedRecord = listBody.data?.list?.find((record) => String(record?.id ?? '') === String(formId))
    expect(publishedRecord, '列表接口应返回本次发布的表单').toBeTruthy()
    expect(publishedRecord.title, '列表接口标题应匹配').toBe(title)
    expect(publishedRecord.status, '列表接口状态应为 published').toBe('published')
    expect(Number(publishedRecord.current_revision_no), '列表接口版本应匹配发布版本').toBe(savedRevisionNo)
    const titleLink = page.locator('.form-activity-list__title-link', { hasText: title })
    await expect(titleLink, '已发布列表中应找到本次创建的全题型表单').toHaveCount(1)
    await expect(titleLink, '列表中的表单标题应完全匹配').toHaveText(title)
    logger('success', '已发布列表断言通过，目标表单可见', { formId, title })

    expect(tokenViolations, '所有 API 业务请求都必须携带环境 Token').toEqual([])
    expect(authenticatedRequestCount, '至少应观察到一个携带 Token 的业务请求').toBeGreaterThan(0)
    expect(authenticatedRequestCount, '携带 Token 的请求数应等于全部业务请求数').toBe(businessRequestCount)
    logger('success', '浏览器请求 Token 断言通过', {
      businessRequestCount,
      authenticatedRequestCount,
      token: '[REDACTED]',
    })
    logger('success', 'Chrome 无头全题型三页 UI 自动化执行完成，所有断言通过')

    return {
      formId,
      title,
      status: 'published',
      browser: 'chrome',
      headless: true,
      pageCount: 3,
      contactFieldTypes: CONTACT_FIELD_TYPES,
      commonFieldTypes: COMMON_FIELD_TYPES,
      advancedFieldTypes: ADVANCED_FIELD_TYPES,
      totalComponentCount: EXPECTED_FIELD_SEQUENCE.length,
      nestedContactFieldCount: CONTACT_PRESET_TYPES.length,
      totalPersistedComponentCount: EXPECTED_SERVER_FIELD_SEQUENCE.length,
      requiredQuestionCount: REQUIRED_FIELD_TYPES.length,
      revisionNo: savedRevisionNo,
      dateRange: {
        start: formatLocalDate(today),
        end: formatLocalDate(endDate),
      },
      authenticatedRequestCount,
    }
  } catch (error) {
    if (signal?.aborted) {
      logger('info', '已响应强制停止，正在清理 Chrome 无头浏览器')
    } else if (captureFailureScreenshot && page) {
      const screenshotPath = await screenshotFailure(page, title)
      logger('error', 'UI 自动化执行失败，已保存当前页面截图', { screenshotPath })
    } else {
      logger('error', 'UI 自动化执行失败（测试模式未输出失败截图）')
    }
    throw error
  } finally {
    const abortCloseStarted = await stopAbortClose()
    if (!abortCloseStarted) await closePlaywrightHandles({ context, browser }, { logger })
  }
}

export {
  ADVANCED_FIELD_TYPES,
  CASCADER_LEVEL_VALUES,
  COMMON_FIELD_TYPES,
  CONTACT_FIELD_TYPES,
  DEFAULT_HEADER_IMAGE_PATH,
  DESCRIPTION_FIELD_CONTENT,
  DESCRIPTION_FIELD_TITLE,
  DIVIDER_TEXT,
  EXPECTED_FIELD_SEQUENCE,
  EXPECTED_SERVER_FIELD_SEQUENCE,
  FORM_CONTENT_HEADING,
  FORM_CONTENT_ITEMS,
  FORM_SUBTITLE,
  REQUIRED_FIELD_TYPES,
  timestampTitle,
}
