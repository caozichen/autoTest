import { clickWhenReady, observeUiReadiness } from './support/ui-readiness.mjs'
import { scaleTimeout } from './support/environment-timeouts.mjs'
import { expect as flowExpect } from './support/environment-timeouts.mjs'

import { attachNetworkObserver } from './support/api-response-recorder.mjs'
import { launchGoogleChrome } from './support/google-chrome.mjs'
import { parseFormLinkContract } from './support/form-link-contract.mjs'
import { expect } from './support/recorded-expect.mjs'
import {
  closePlaywrightHandles,
  closePlaywrightOnAbort,
  throwIfRunAborted,
} from './playwright-run-control.mjs'
import {
  assertEmailFormatBoundary,
  assertField,
  assertPublishedFormContract,
  assertSubmissionPayload,
  createTestData,
  createUploadFixtures,
  drawSignature,
  fieldCard,
  fillAndAssert,
  parseSubmissionRequestPayload,
  rankOptions,
  replaceWithUserInputAndBlur,
  selectCascaderPath,
  selectOption,
  uploadAndAssert,
} from './form-lpxavn-submit.ui.spec.mjs'

const SCRIPT_ID = 'form-submission-reply-create'
const DEFAULT_REQUEST_PATH = '/form-activity/submission/preview/reply/create?fid=q3r72J'
const NAVIGATION_TIMEOUT_MS = 45_000
const ACTION_TIMEOUT_MS = 30_000
const REQUIRED_ERROR_COUNT = 26
const ROOT_FIELD_CARD_COUNT = 25
const ANSWER_FIELD_COUNT = 27
const FIELD_HEADING_COUNT = 28
const ADDRESS_OPTION_ALIASES = Object.freeze({
  province: Object.freeze(['广东省', '廣東省']),
  city: Object.freeze(['深圳市']),
  district: Object.freeze(['南山区', '南山區']),
})
const ROOT_FIELD_NAMES = Object.freeze([
  'username', 'mobile', 'email', 'idCard', 'landlinePhone', 'address', 'birthday',
  'input', 'textarea', 'radio', 'checkbox', 'select', 'number', 'date', 'time',
  'imageUpload', 'fileUpload', 'cascader', 'signature', 'fieldGroup', 'matrix',
  'matrixChoice', 'ranking', 'rating', 'nps',
])
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
  matrix: '矩阵题',
  matrixChoice: '矩阵选择',
  ranking: '排序题',
  rating: '评分题',
  nps: 'NPS',
})

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeRequestPath(value = DEFAULT_REQUEST_PATH) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('手动创建提报 URL 路径不能为空')
  const requestPath = value.trim()
  if (/^[a-z][a-z\d+.-]*:/i.test(requestPath) || requestPath.startsWith('//')) {
    throw new Error('手动创建提报 URL 路径必须是相对路径')
  }
  if (/\s/.test(requestPath)) throw new Error('手动创建提报 URL 路径不能包含空格或换行')
  if (requestPath.includes('\\')) throw new Error('手动创建提报 URL 路径不能包含反斜杠')
  return requestPath.startsWith('/') ? requestPath : `/${requestPath}`
}

function buildCreateUrl(siteBaseUrl, requestPath = DEFAULT_REQUEST_PATH) {
  const siteOrigin = new URL(siteBaseUrl).origin
  const createUrl = new URL(normalizeRequestPath(requestPath).replace(/^\/+/, ''), `${siteOrigin}/`)
  if (createUrl.origin !== siteOrigin) throw new Error('手动创建提报地址必须与所选环境同源')
  return createUrl.toString()
}

function resolveCreateContext(createUrl, variables = {}) {
  const url = new URL(createUrl)
  if (url.pathname !== '/form-activity/submission/preview/reply/create') {
    throw new Error('手动创建提报 URL 必须指向 reply/create 路由')
  }
  const queryFormId = String(url.searchParams.get('fid') || '').trim()
  const variableFormId = String(variables.FORM_ID || '').trim()
  if (variableFormId && queryFormId && variableFormId !== queryFormId) {
    throw new Error('FORM_ID 与手动创建提报 URL 的 fid 参数不一致')
  }
  const formId = queryFormId || variableFormId
  if (!formId || /{{|}}/.test(formId)) {
    throw new Error('无法从 FORM_ID 或手动创建提报地址 fid 参数解析 formId')
  }
  return { formId }
}

function buildAdminApiPath(apiPathPrefix, resourcePath) {
  const normalizedPrefix = String(apiPathPrefix || '')
    .replace(/^\/+|\/+$/g, '')
  const normalizedResourcePath = String(resourcePath || '')
    .replace(/^\/+/, '')
  return `${normalizedPrefix ? `/${normalizedPrefix}` : ''}/${normalizedResourcePath}`
}

function isSubmissionCreateMutation(response, {
  origin,
  formId,
  apiPathPrefix = '/api',
}) {
  const request = response.request()
  if (request.method().toUpperCase() !== 'POST') return false
  const url = new URL(response.url())
  if (url.origin !== origin) return false
  return url.pathname === buildAdminApiPath(
    apiPathPrefix,
    `/be/form/${encodeURIComponent(formId)}/submission`,
  )
}

function submissionIdFromBody(body) {
  return String(
    body?.data?.submission_id
    ?? body?.data?.submissionId
    ?? body?.submission_id
    ?? body?.submissionId
    ?? '',
  ).trim()
}

async function inspectCreateResponse(response) {
  const httpSucceeded = response.ok()
  expect(httpSucceeded, `创建提报接口应返回成功 HTTP 状态，实际 ${response.status()}`).toBe(true)
  const responseOutcome = await response.text().then(
    (text) => ({ text }),
    (error) => ({ error }),
  )
  if ('error' in responseOutcome) {
    return { body: null, succeeded: httpSucceeded, submissionId: '' }
  }
  const responseText = responseOutcome.text
  if (!responseText.trim()) {
    expect(false, '创建提报接口应返回包含 submission_id 的 JSON 对象').toBe(true)
    return { body: null, succeeded: false, submissionId: '' }
  }
  let body
  try {
    body = JSON.parse(responseText)
  } catch {
    expect(false, '创建提报接口应返回有效 JSON').toBe(true)
    return { body: null, succeeded: false, submissionId: '' }
  }
  const objectBody = Boolean(body && typeof body === 'object' && !Array.isArray(body))
  expect(objectBody, '创建提报接口返回的 JSON 应为对象').toBe(true)
  if (!objectBody) return { body: null, succeeded: false, submissionId: '' }

  let businessSucceeded = true
  if (Object.prototype.hasOwnProperty.call(body, 'code')) {
    businessSucceeded = Number(body.code) === 0
    expect(businessSucceeded, `创建提报接口业务码应为 0，实际 ${body.code}`).toBe(true)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'success')) {
    const explicitSuccess = body.success === true
    expect(explicitSuccess, '创建提报接口 success 应为 true').toBe(true)
    businessSucceeded = businessSucceeded && explicitSuccess
  }
  const submissionId = submissionIdFromBody(body)
  if (httpSucceeded && businessSucceeded) {
    expect(submissionId, '创建提报成功响应应包含非空 submission_id').not.toBe('')
  }
  return {
    body,
    succeeded: httpSucceeded && businessSucceeded && Boolean(submissionId),
    submissionId,
  }
}

function normalizeAdminFormPayload(body) {
  return {
    code: body?.code,
    data: {
      revision_no: body?.data?.revision_no ?? body?.data?.form?.current_revision_no,
      form: body?.data?.form,
      items: body?.data?.items,
    },
  }
}

function isApiBusinessRequest(request, apiOrigin, apiPathPrefix) {
  if (!['fetch', 'xhr'].includes(request.resourceType())) return false
  const url = new URL(request.url())
  if (url.origin !== apiOrigin) return false
  if (apiPathPrefix !== '/' && (
    url.pathname === apiPathPrefix || url.pathname.startsWith(`${apiPathPrefix}/`)
  )) return true
  return /^\/(?:api\/)?(?:be|base)\//.test(url.pathname)
}

async function recordAndRequireCount(locator, count, message) {
  await expect(locator, message).toHaveCount(count)
  await flowExpect(locator, message).toHaveCount(count)
}

async function recordAndRequireVisible(locator, message) {
  await expect(locator, message).toBeVisible()
  await flowExpect(locator, message).toBeVisible()
}

async function recordAndRequireEnabled(locator, message) {
  await expect(locator, message).toBeEnabled()
  await flowExpect(locator, message).toBeEnabled()
}

async function requiredField(page, key, label) {
  const card = await assertField(page, key, label)
  await flowExpect(card, `后续填写依赖“${label}”题目唯一存在`).toHaveCount(1)
  await flowExpect(card, `后续填写依赖“${label}”题目可见`).toBeVisible()
  return card
}

async function assertInitialCreateStructure(page, {
  createUrl,
  title,
  fieldKeys,
  submissionRequestCount,
}) {
  await expect(page, '手动创建提报页应保持在精确创建地址').toHaveURL(createUrl)
  await flowExpect(page, 'Token 生效后不应跳转登录页').not.toHaveURL(/\/login(?:[/?#]|$)/)
  await recordAndRequireVisible(
    page.getByRole('heading', { level: 2, name: title, exact: true }),
    '页面应显示目标表单标题',
  )
  await expect(page.getByText('创建后记录提交时间', { exact: true }), '创建态应说明提交时间在创建后记录')
    .toBeVisible()
  await expect(page.getByText('编辑中', { exact: true }).first(), '创建态应显示“编辑中”状态')
    .toBeVisible()
  await expect(
    page.getByRole('heading', { level: 3, name: /^(?:提報資訊|填报信息|提报信息)$/ }),
    '创建态应显示“提报信息”分区',
  ).toBeVisible()

  const cancelButton = page.getByRole('button', { name: /^取消创建$/ })
  const createButton = page.getByRole('button', { name: /^创建提报$/ })
  await expect(cancelButton, '创建态应唯一显示“取消创建”按钮').toHaveCount(1)
  await expect(cancelButton, '创建态“取消创建”按钮应可见且可用').toBeVisible()
  await expect(cancelButton, '创建态“取消创建”按钮应可见且可用').toBeEnabled()
  await recordAndRequireCount(createButton, 1, '创建态应唯一显示“创建提报”按钮')
  await recordAndRequireVisible(createButton, '创建态“创建提报”按钮应可见')
  await recordAndRequireEnabled(createButton, '创建态“创建提报”按钮应可用')

  const renderer = page.locator('form-renderer[admin-create-submission]')
  await recordAndRequireCount(renderer, 1, '创建态应唯一加载后台提报表单渲染器')
  await expect(page.locator('.fb-runtime-field-card'), '创建态应同时显示 24 个根级答案题块')
    .toHaveCount(ROOT_FIELD_CARD_COUNT - 1)
  await expect(page.locator('.fb-runtime-structural-field-card'), '创建态应显示 1 个题组结构题块')
    .toHaveCount(1)
  await expect(
    page.locator('.fb-runtime-field-card, .fb-runtime-structural-field-card'),
    '创建态应同时显示 25 个根级题块',
  ).toHaveCount(ROOT_FIELD_CARD_COUNT)
  await expect(page.locator('[data-item-key]'), '创建态应渲染 28 个动态题目节点').toHaveCount(FIELD_HEADING_COUNT)
  await expect(page.locator('[data-field-key]'), '创建态应渲染 27 个可作答字段节点').toHaveCount(ANSWER_FIELD_COUNT)
  await expect(page.locator('.fb-runtime-field-heading'), '创建态应显示 28 个题目标题').toHaveCount(FIELD_HEADING_COUNT)

  for (const name of ROOT_FIELD_NAMES) {
    const key = fieldKeys[name]
    await expect(key, `表单契约应包含 ${name} 的动态 item_key`).not.toBe('')
    if (!key) continue
    const card = fieldCard(page, key)
    await expect(card, `创建态应唯一显示“${FIELD_LABELS[name]}”题目`).toHaveCount(1)
    await expect(card, `创建态“${FIELD_LABELS[name]}”题目应可见`).toBeVisible()
    await expect(
      card.locator('.fb-runtime-field-heading').first(),
      `创建态“${FIELD_LABELS[name]}”题目标题应显示正确`,
    ).toHaveText(FIELD_LABELS[name])
  }
  for (const name of ['description', 'divider']) {
    await expect(fieldCard(page, fieldKeys[name]), `后台创建态不应渲染${name === 'description' ? '描述说明' : '分割线'}`)
      .toHaveCount(0)
  }
  const group = fieldCard(page, fieldKeys.fieldGroup)
  await expect(group.locator('.fb-runtime-field-group-instance'), '题组应默认显示一个信息实例').toHaveCount(1)
  const groupContent = group.locator('.fb-runtime-field-group-instance-content')
  await expect(groupContent.locator('[data-field-key]'), '题组实例应显示姓名、手机号、邮箱三个子题').toHaveCount(3)
  for (const name of ['groupUsername', 'groupMobile', 'groupEmail']) {
    const key = fieldKeys[name]
    await expect(key, `表单契约应包含 ${name} 的动态 item_key`).not.toBe('')
    if (!key) continue
    const child = groupContent.locator(`[data-field-key$=${JSON.stringify(key)}]`)
    await expect(
      child,
      `题组应唯一显示动态子题 ${key}`,
    ).toHaveCount(1)
    await expect(
      child.locator('.fb-runtime-field-heading'),
      `题组子题“${FIELD_LABELS[name.replace('group', '').replace(/^./, (value) => value.toLowerCase())]}”标题应正确`,
    ).toHaveText(FIELD_LABELS[name.replace('group', '').replace(/^./, (value) => value.toLowerCase())])
  }
  await expect(page.getByRole('button', { name: /^(?:上一页|下一页)$/ }), '后台创建态不应显示公开端分页按钮')
    .toHaveCount(0)
  for (const text of ['基本信息', '变更详情', '核准记录', '备注', '特殊编号']) {
    await expect(page.getByText(text, { exact: true }).first(), `右侧信息区应显示“${text}”`).toBeVisible()
  }

  await clickWhenReady(createButton)
  await expect(page.locator('.fb-runtime-field-error'), '空表创建应显示 26 个必填错误').toHaveCount(REQUIRED_ERROR_COUNT)
  await expect(page, '空表必填校验后应停留在创建页').toHaveURL(createUrl)
  expect(submissionRequestCount(), '空表必填校验不得发送创建 POST').toBe(0)
  await flowExpect(
    submissionRequestCount(),
    '空表校验若误发创建 POST，必须立即停止以避免后续重复创建',
  ).toBe(0)
  return { cancelButton, createButton }
}

async function assertValidationMessage(card, message, label) {
  await expect(card.locator('.fb-runtime-field-error'), label).toContainText(message)
}

async function fillAllFields(page, fieldKeys, data, fixtures, logger) {
  const username = await requiredField(page, fieldKeys.username, '姓名')
  await selectOption(page, username.locator('[role="combobox"]'), data.nameTitle, '姓名-称谓', logger)
  await fillAndAssert(username.locator('input').first(), data.username, '姓名')

  const mobile = await requiredField(page, fieldKeys.mobile, '手机号')
  await expect(mobile.getByRole('combobox'), '手机号区号应为中国大陆 +86').toContainText('+86')
  await fillAndAssert(mobile.locator('input').first(), data.invalidMobile, '手机号非法边界值')
  await mobile.locator('input').first().press('Tab')
  await assertValidationMessage(mobile, /正确.*手机|手机.*正确/, '手机号非法值应显示格式错误')
  await replaceWithUserInputAndBlur(mobile.locator('input').first(), data.mobile, '手机号合法恢复值')

  const email = await requiredField(page, fieldKeys.email, '邮箱')
  await fillAndAssert(email.locator('input').first(), data.email, '邮箱')
  await assertEmailFormatBoundary(email.locator('input').first(), data.invalidEmail, data.email)

  const idCard = await requiredField(page, fieldKeys.idCard, '身份证件')
  await expect(idCard.getByRole('combobox'), '证件类型应为身份证').toContainText(/身份证|身份證/)
  await fillAndAssert(idCard.locator('input').first(), data.idCard, '身份证件')

  const landline = await requiredField(page, fieldKeys.landlinePhone, '固定电话')
  await fillAndAssert(landline.locator('input').first(), data.landlinePhone, '固定电话')

  const address = await requiredField(page, fieldKeys.address, '地址')
  const addressSelects = address.locator('[role="combobox"]')
  await expect(addressSelects, '地址题应显示省、市、区县三级下拉').toHaveCount(3)
  data.province = await selectOption(page, addressSelects.nth(0), ADDRESS_OPTION_ALIASES.province, '地址-省份', logger)
  data.city = await selectOption(page, addressSelects.nth(1), ADDRESS_OPTION_ALIASES.city, '地址-城市', logger)
  data.district = await selectOption(page, addressSelects.nth(2), ADDRESS_OPTION_ALIASES.district, '地址-区县', logger)
  await fillAndAssert(address.locator('input').first(), data.street, '详细地址')

  const birthday = await requiredField(page, fieldKeys.birthday, '生日')
  const birthdaySelects = birthday.locator('[role="combobox"]')
  await expect(birthdaySelects, '生日题应显示年、月、日三个下拉').toHaveCount(3)
  await selectOption(page, birthdaySelects.nth(0), data.birthday.year, '生日-年份', logger)
  await selectOption(page, birthdaySelects.nth(1), data.birthday.month, '生日-月份', logger)
  await selectOption(page, birthdaySelects.nth(2), data.birthday.day, '生日-日期', logger)

  const input = await requiredField(page, fieldKeys.input, '单行文本')
  const singleLineInput = input.locator('input').first()
  await singleLineInput.fill(data.singleLineTooLong)
  const overLimitValue = await singleLineInput.inputValue()
  expect(overLimitValue.length, '单行文本控件不应接受超过 20 字的内容').toBeLessThanOrEqual(20)
  if (overLimitValue !== data.singleLine) {
    await replaceWithUserInputAndBlur(singleLineInput, data.singleLine, '单行文本 20 字合法上边界')
  } else {
    await expect(singleLineInput, '单行文本第 21 字应被截断').toHaveValue(data.singleLine)
  }

  const textarea = await requiredField(page, fieldKeys.textarea, '多行文本')
  await fillAndAssert(textarea.locator('textarea').first(), data.multiLine, '多行文本')

  const radio = await requiredField(page, fieldKeys.radio, '单项选择')
  const radioControls = radio.locator('.fb-ui-radio-group-item')
  await expect(radioControls, '单项选择应显示三个选项').toHaveCount(3)
  const radioImages = radio.locator('img')
  await expect(radioImages, '单项选择前两个选项应渲染图片').toHaveCount(2)
  for (let index = 0; index < 2; index += 1) {
    await expect(radioImages.nth(index), `单项选择第 ${index + 1} 张图片应包含地址`).toHaveAttribute('src', /^https?:\/\//)
  }
  const customRadio = radioControls.nth(2)
  await clickWhenReady(customRadio)
  await expect(customRadio, '单项选择“其他”应可选中').toHaveAttribute('data-state', 'checked')
  const customRadioInput = radio.locator('input[type="text"]:visible')
  await expect(customRadioInput, '选择“其他”后应显示自定义文本框').toHaveCount(1)
  await fillAndAssert(customRadioInput, '其他边界选项', '单项选择-其他')
  const radioChoice = radioControls.nth(data.radioIndex)
  await clickWhenReady(radioChoice)
  await expect(radioChoice, '单项选择应最终选中“选项1”').toHaveAttribute('data-state', 'checked')

  const checkbox = await requiredField(page, fieldKeys.checkbox, '多项选择')
  const checkboxControls = checkbox.locator('.fb-ui-checkbox-root')
  await expect(checkboxControls, '多项选择应显示三个选项').toHaveCount(3)
  await clickWhenReady(checkboxControls.nth(0))
  await assertValidationMessage(checkbox, /2\s*-\s*3|2-3/, '多项选择仅选一项应显示最小数量错误')
  await clickWhenReady(checkboxControls.nth(1))
  await expect(checkbox.locator('.fb-ui-checkbox-root[data-state="checked"]'), '多项选择两项应达到合法最小边界').toHaveCount(2)
  await clickWhenReady(checkboxControls.nth(2))
  await expect(checkbox.locator('.fb-ui-checkbox-root[data-state="checked"]'), '多项选择三项应达到合法最大边界').toHaveCount(3)

  const select = await requiredField(page, fieldKeys.select, '下拉选择')
  await selectOption(page, select.locator('[role="combobox"]'), data.select, '下拉选择', logger)

  const number = await requiredField(page, fieldKeys.number, '数字')
  const numberInput = number.locator('input').first()
  await fillAndAssert(numberInput, data.numberTooLarge, '数字上边界越界值')
  await numberInput.press('Tab')
  await assertValidationMessage(number, /0\s*-\s*100|0.*100/, '数字 100.01 应显示范围错误')
  await replaceWithUserInputAndBlur(numberInput, data.number, '数字 100.00 合法上边界')

  const date = await requiredField(page, fieldKeys.date, '日期')
  const dateTrigger = date.locator('button').first()
  const datePlaceholder = (await dateTrigger.innerText()).trim()
  await clickWhenReady(dateTrigger)
  const dateOverlay = page.locator('[data-fb-date-overlay]')
  await expect(dateOverlay, '日期题应打开日期面板').toBeVisible()
  await expect(dateOverlay.locator('button[disabled]'), '日期面板应禁用范围外日期').not.toHaveCount(0)
  await expect(dateOverlay.locator('button:not([disabled])'), '日期面板应保留范围内日期').not.toHaveCount(0)
  await clickWhenReady(dateOverlay.locator('button.fb-ring-1:not([disabled])'))
  await expect.poll(async () => (await dateTrigger.innerText()).trim(), { message: '日期选择后应更新回显' })
    .not.toBe(datePlaceholder)
  data.selectedDate = (await dateTrigger.innerText()).trim()

  const time = await requiredField(page, fieldKeys.time, '时间')
  const timeTrigger = time.locator('button').first()
  const timePlaceholder = (await timeTrigger.innerText()).trim()
  await clickWhenReady(timeTrigger)
  const timePanel = page.locator('.fb-timepicker-container:visible')
  await expect(timePanel, '时间题应打开时间面板').toBeVisible()
  const timeActions = timePanel.locator('button.fb-h-7.fb-min-w-14')
  await expect(timeActions, '时间面板应显示设为当前时间和确认两个操作').toHaveCount(2)
  await clickWhenReady(timeActions.nth(0))
  await clickWhenReady(timeActions.nth(1))
  await expect(timePanel, '确认时间后时间面板应关闭').toBeHidden()
  await expect.poll(async () => (await timeTrigger.innerText()).trim(), { message: '时间选择后应更新回显' })
    .not.toBe(timePlaceholder)
  data.selectedTime = (await timeTrigger.innerText()).trim()

  const imageUpload = await requiredField(page, fieldKeys.imageUpload, '图片上传')
  await uploadAndAssert(imageUpload, fixtures.imagePath, '图片上传')
  const fileUpload = await requiredField(page, fieldKeys.fileUpload, '文件上传')
  await uploadAndAssert(fileUpload, fixtures.filePath, '文件上传')

  const cascader = await requiredField(page, fieldKeys.cascader, '级联选择')
  await selectCascaderPath(page, cascader.locator('.fb-runtime-cascader-trigger'), data.cascader, logger)

  const signature = await requiredField(page, fieldKeys.signature, '手写签名')
  await drawSignature(page, signature, logger)

  const fieldGroup = await requiredField(page, fieldKeys.fieldGroup, '题组')
  const groupInstances = fieldGroup.locator('.fb-runtime-field-group-instance')
  await expect(groupInstances, '题组应保持一个信息实例').toHaveCount(1)
  const groupContent = groupInstances.first().locator('.fb-runtime-field-group-instance-content')
  const groupInputs = groupContent.locator('input')
  await expect(groupInputs, '题组实例应包含姓名、手机号、邮箱三个输入控件').toHaveCount(3)
  await fillAndAssert(groupInputs.nth(0), data.groupUsername, '题组-姓名')
  await expect(groupContent.getByRole('combobox'), '题组手机号区号应为中国大陆 +86').toContainText('+86')
  await fillAndAssert(groupInputs.nth(1), data.groupMobile, '题组-手机号')
  await fillAndAssert(groupInputs.nth(2), data.groupEmail, '题组-邮箱')

  const matrix = await requiredField(page, fieldKeys.matrix, '矩阵题')
  const matrixInputs = matrix.locator('tbody input[type="text"]')
  await expect(matrixInputs, '矩阵题应显示 3×3 共九个输入格').toHaveCount(9)
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const value = data.matrix[row][column]
      const cell = matrixInputs.nth(row * 3 + column)
      await cell.fill(value)
      await expect(cell, `矩阵题第 ${row + 1} 行第 ${column + 1} 列应回显答案`).toHaveValue(value)
    }
  }

  const matrixChoice = await requiredField(page, fieldKeys.matrixChoice, '矩阵选择')
  const matrixRadios = matrixChoice.getByRole('radio')
  await expect(matrixRadios, '矩阵选择应显示 3×3 共九个选项').toHaveCount(9)
  for (const index of data.matrixChoiceIndexes) {
    await clickWhenReady(matrixRadios.nth(index))
    await expect(matrixRadios.nth(index), `矩阵选择第 ${Math.floor(index / 3) + 1} 行应选中目标列`).toBeChecked()
  }

  const ranking = await requiredField(page, fieldKeys.ranking, '排序题')
  await rankOptions(ranking, data.ranking)
  const rankedLabels = await ranking.locator('.fb-runtime-ranking-ranked-list .fb-runtime-ranking-label').allTextContents()
  expect(rankedLabels.map((value) => value.trim()), '排序题顺序应与测试数据一致').toEqual(data.ranking)

  const rating = await requiredField(page, fieldKeys.rating, '评分题')
  const ratingButtons = rating.locator('button.rating-item')
  await expect(ratingButtons, '评分题应显示五个评分按钮').toHaveCount(5)
  await clickWhenReady(ratingButtons.first())
  await expect(ratingButtons.first().locator('.rating-icon--accent'), '评分题应支持一分下边界').toBeVisible()
  await clickWhenReady(ratingButtons.nth(data.rating - 1))
  await expect(ratingButtons.nth(data.rating - 1).locator('.rating-icon--accent'), '评分题应最终选择五分').toBeVisible()

  const nps = await requiredField(page, fieldKeys.nps, 'NPS')
  const npsButtons = nps.locator('button.nps-scale__score-btn')
  await expect(npsButtons, 'NPS 应显示一到十共十个分值').toHaveCount(10)
  const minimumNps = npsButtons.filter({ hasText: /^1$/ })
  await clickWhenReady(minimumNps)
  await expect(minimumNps, 'NPS 应支持一分下边界').toHaveClass(/fb-text-white/)
  const targetNps = npsButtons.filter({ hasText: new RegExp(`^${data.nps}$`) })
  await clickWhenReady(targetNps)
  await expect(targetNps, 'NPS 应最终选择十分上边界').toHaveClass(/fb-text-white/)
  await expect(minimumNps, '选择十分后，一分应取消选中').not.toHaveClass(/fb-text-white/)

  await expect(page.locator('.fb-runtime-field-error'), '全部字段恢复合法值后不应残留校验错误').toHaveCount(0)
  logger('success', '后台单页全部题型填写和边界断言执行完成', {
    answerFieldCount: ANSWER_FIELD_COUNT,
    matrixCellCount: 9,
    matrixChoiceCount: 3,
    imageFixture: fixtures.imagePath,
    fileFixture: fixtures.filePath,
  })
}

function replyRows(page, label) {
  const pattern = new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`)
  return page.locator('.reply-kv__row').filter({
    has: page.locator('.reply-kv__label').filter({ hasText: pattern }),
  })
}

async function assertReplyValue(page, label, value, occurrence = 1) {
  const rows = replyRows(page, label)
  await expect(rows, `详情态应显示第 ${occurrence} 个“${label}”字段`).not.toHaveCount(0)
  if (await rows.count() < occurrence) return 0
  const row = rows.nth(occurrence - 1)
  await expect(row, `详情态第 ${occurrence} 个“${label}”字段应可见`).toBeVisible()
  await expect(row.locator('.reply-kv__value'), `详情态“${label}”应回显创建值`).toContainText(String(value))
  return 1
}

async function openMatrixDetail(page, label) {
  const row = replyRows(page, label).first()
  await expect(row, `详情态应显示“${label}”字段`).toBeVisible()
  const button = row.locator('.reply-kv__matrix-view')
  await expect(button, `详情态“${label}”应提供“点击查看”操作`).toHaveCount(1)
  if (await button.count() !== 1) return null
  await clickWhenReady(button)
  const modal = page.locator('.arco-modal-container:visible')
  await expect(modal, `点击“${label}”后应打开详情弹层`).toBeVisible()
  await expect(modal.locator('.arco-modal-title'), `“${label}”详情弹层标题应正确`).toHaveText(label)
  return modal
}

async function closeMatrixDetail(modal, label) {
  const closeButton = modal.locator('[role="button"][aria-label="Close"]')
  await expect(closeButton, `“${label}”详情弹层应提供关闭操作`).toHaveCount(1)
  if (await closeButton.count() !== 1) return
  await clickWhenReady(closeButton)
  await expect(modal, `关闭后“${label}”详情弹层应隐藏`).toBeHidden()
}

async function assertDetailState(page, { formId, submissionId, title, data, fixtures }) {
  await expect(page.getByRole('heading', { level: 2 }).first(), '创建成功后详情态应显示表单标题')
    .toContainText(title, { timeout: scaleTimeout(ACTION_TIMEOUT_MS) })
  const summaryStatuses = page.locator('.reply-detail-page__summary-status')
  const summaryStatusTexts = (await summaryStatuses.allTextContents())
    .map((value) => value.trim())
    .filter(Boolean)
  expect(summaryStatusTexts, '创建成功后详情页头应唯一显示“已提交”状态').toEqual(['已提交'])
  if (await summaryStatuses.count() > 0) {
    await expect(summaryStatuses.first(), '创建成功后的“已提交”状态应可见').toBeVisible()
  }
  await expect(page.getByRole('button', { name: /^(?:编辑|編輯)$/ }), '详情态应唯一显示“编辑”按钮').toHaveCount(1)
  await expect(page.getByRole('button', { name: /^(?:创建提报|取消创建)$/ }), '详情态不应残留创建操作').toHaveCount(0)
  expect(new URL(page.url()).searchParams.get('fid'), '详情态 URL 应保留目标 fid').toBe(formId)

  let assertedValueCount = 0
  for (const [label, value, occurrence] of [
    ['姓名', data.username, 1],
    ['手机号', data.mobile, 1],
    ['邮箱', data.email, 1],
    ['身份证件', data.idCard, 1],
    ['固定电话', data.landlinePhone, 1],
    ['单行文本', data.singleLine, 1],
    ['多行文本', data.multiLine, 1],
    ['单项选择', data.radio, 1],
    ['下拉选择', data.select, 1],
    ['数字', data.number, 1],
    ['日期', data.selectedDate, 1],
    ['时间', data.selectedTime, 1],
    ['姓名', data.groupUsername, 2],
    ['手机号', data.groupMobile, 2],
    ['邮箱', data.groupEmail, 2],
    ['评分题', data.rating, 1],
    ['NPS', data.nps, 1],
  ]) {
    assertedValueCount += await assertReplyValue(page, label, value, occurrence)
  }
  const addressRow = replyRows(page, '地址').first()
  await expect(addressRow, '详情态应显示地址字段').toBeVisible()
  for (const value of [data.province, data.city, data.district, data.street]) {
    await expect(addressRow, `详情态地址应回显“${value}”`).toContainText(value)
    assertedValueCount += 1
  }
  const birthdayRow = replyRows(page, '生日').first()
  await expect(birthdayRow, '详情态应显示生日字段').toBeVisible()
  for (const value of Object.values(data.birthday)) {
    await expect(birthdayRow, `详情态生日应包含“${value}”`).toContainText(String(Number(value)))
    assertedValueCount += 1
  }
  const checkboxRow = replyRows(page, '多项选择').first()
  for (const value of data.checkbox) {
    await expect(checkboxRow, `详情态多项选择应回显“${value}”`).toContainText(value)
    assertedValueCount += 1
  }
  const cascaderRow = replyRows(page, '级联选择').first()
  for (const value of data.cascader) {
    await expect(cascaderRow, `详情态级联选择应回显“${value}”`).toContainText(value)
    assertedValueCount += 1
  }
  const matrixModal = await openMatrixDetail(page, '矩阵题')
  if (matrixModal) {
    await expect(matrixModal.locator('.submission-matrix-table tbody tr'), '矩阵题详情应显示三行').toHaveCount(3)
    await expect(matrixModal.locator('.submission-matrix-table tbody td'), '矩阵题详情应显示 3×3 共九个答案格').toHaveCount(9)
    for (const value of data.matrix.flat()) {
      await expect(matrixModal, `矩阵题详情应回显“${value}”`).toContainText(value)
      assertedValueCount += 1
    }
    await closeMatrixDetail(matrixModal, '矩阵题')
  }
  const matrixChoiceModal = await openMatrixDetail(page, '矩阵选择')
  if (matrixChoiceModal) {
    const matrixChoiceCells = matrixChoiceModal.locator('.submission-matrix-choice-cell')
    await expect(matrixChoiceCells, '矩阵选择详情应显示 3×3 共九个选项格').toHaveCount(9)
    for (const index of data.matrixChoiceIndexes) {
      await expect(
        matrixChoiceCells.nth(index).locator('.submission-matrix-choice-check'),
        `矩阵选择详情第 ${Math.floor(index / 3) + 1} 行应回显目标选项`,
      ).toHaveText('✓')
      assertedValueCount += 1
    }
    await closeMatrixDetail(matrixChoiceModal, '矩阵选择')
  }
  const rankingRow = replyRows(page, '排序题').first()
  const rankingText = await rankingRow.innerText().catch(() => '')
  let cursor = -1
  for (const value of data.ranking) {
    const index = rankingText.indexOf(value, cursor + 1)
    expect(index, `详情态排序题中“${value}”顺序应正确`).toBeGreaterThan(cursor)
    cursor = index
    assertedValueCount += 1
  }
  const signatureRow = replyRows(page, '手写签名').first()
  await expect(signatureRow.locator('img'), '详情态手写签名应回显图片').not.toHaveCount(0)
  const imageRow = replyRows(page, '图片上传').first()
  await expect(imageRow.locator('img'), '详情态图片上传应回显图片').not.toHaveCount(0)
  const fileRow = replyRows(page, '文件上传').first()
  await expect(fileRow, '详情态文件上传应回显原文件名').toContainText(fixtures.filePath.split(/[\\/]/).pop())
  return assertedValueCount + 3
}

function detailSubmissionId(url) {
  const segments = new URL(url).pathname.split('/').filter(Boolean)
  const replyIndex = segments.lastIndexOf('reply')
  const value = replyIndex >= 0 ? decodeURIComponent(segments[replyIndex + 1] || '') : ''
  return value === 'create' ? '' : value
}

async function screenshotFailure(page, formId, artifactWriter) {
  if (!artifactWriter || typeof artifactWriter.captureScreenshot !== 'function') {
    throw new Error('Runner 必须提供 artifactWriter')
  }
  const safeId = formId.replace(/[^a-zA-Z0-9_-]+/g, '_')
  return artifactWriter.captureScreenshot(
    page,
    `screenshots/${safeId || 'unknown'}-手动创建提报失败-${Date.now()}.png`,
    { fullPage: true },
  )
}

function createOutput({
  formId,
  submissionId = '',
  createUrl,
  detailUrl = '',
  title,
  status,
  fieldKeys,
  linkedContractUsed,
  businessRequestCount,
  authenticatedRequestCount,
  submissionRequestCount,
  validatePageRequestCount,
  formConfigRequestCount,
  detailRequestCount,
  assertedAnswerFieldCount = 0,
  assertedDetailValueCount = 0,
  createResponse = null,
}) {
  return {
    formId,
    submissionId,
    createUrl,
    detailUrl,
    title,
    status,
    submitted: status === 'submitted',
    browser: 'chrome',
    headless: true,
    fieldKeys,
    linkedContractUsed,
    businessRequestCount,
    authenticatedRequestCount,
    submissionRequestCount,
    validatePageRequestCount,
    formConfigRequestCount,
    detailRequestCount,
    assertedAnswerFieldCount,
    assertedDetailValueCount,
    createResponse,
  }
}

export async function run({
  scriptId = SCRIPT_ID,
  scriptName = scriptId,
  siteBaseUrl,
  apiBaseUrl,
  requestPath = DEFAULT_REQUEST_PATH,
  variables = {},
  extraHTTPHeaders,
  ignoreHTTPSErrors = false,
  artifactWriter,
  signal,
  logger = () => undefined,
  recordApiResponse,
  recordResourceResponse,
  captureFailureScreenshot = true,
}) {
  if (!siteBaseUrl) throw new Error('运行环境必须提供 Web 基址')
  if (!apiBaseUrl) throw new Error('运行环境必须提供 API 基址')
  if (!artifactWriter
    || typeof artifactWriter.writeFile !== 'function'
    || typeof artifactWriter.captureScreenshot !== 'function') {
    throw new Error('Runner 必须提供 artifactWriter')
  }
  const authorization = extraHTTPHeaders?.Authorization
  if (!authorization) throw new Error('手动创建提报必须使用环境登录后的 Token')

  const createUrl = buildCreateUrl(siteBaseUrl, requestPath)
  const siteOrigin = new URL(siteBaseUrl).origin
  const apiUrl = new URL(apiBaseUrl)
  if (apiUrl.origin !== siteOrigin) throw new Error('Web 基址与 API 基址必须同源')
  const apiPathPrefix = apiUrl.pathname.replace(/\/+$/, '') || '/'
  const { formId } = resolveCreateContext(createUrl, variables)
  const formApiPath = buildAdminApiPath(
    apiPathPrefix,
    `/be/form/${encodeURIComponent(formId)}`,
  )
  const submissionApiPath = `${formApiPath}/submission`
  const detailApiPathPattern = new RegExp(`^${escapeRegExp(submissionApiPath)}/[^/]+$`)
  const linkedFormContract = parseFormLinkContract(variables.FORM_CONTRACT)
  const data = createTestData()

  let browser
  let context
  let page
  let stopAbortClose = () => undefined
  let networkObserver = { setPhase: () => undefined, stop: async () => undefined }
  let businessRequestCount = 0
  let authenticatedRequestCount = 0
  let submissionRequestCount = 0
  let validatePageRequestCount = 0
  let formConfigRequestCount = 0
  let detailRequestCount = 0
  let capturedCreateRequest = null
  const tokenViolations = []
  const detailResponses = []

  try {
    throwIfRunAborted(signal)
    const fixtures = await createUploadFixtures(data.runId, artifactWriter)
    logger('info', '启动 Google Chrome 无头浏览器，打开后台手动创建提报页', {
      scriptId,
      scriptName,
      formId,
      createUrl,
    })
    browser = await launchGoogleChrome()
    stopAbortClose = closePlaywrightOnAbort(signal, () => ({ browser, context }), { logger })
    throwIfRunAborted(signal)
    context = await browser.newContext({
      ignoreHTTPSErrors,
      viewport: { width: 1440, height: 1000 },
      locale: 'zh-CN',
    })
    await context.addInitScript(({ token }) => {
      localStorage.setItem('token', token)
      localStorage.setItem('arco-locale', 'zh-CN')
    }, { token: authorization })
    networkObserver = attachNetworkObserver(context, {
      initialPhase: '浏览器初始化',
      onApiResponse: recordApiResponse,
      onResourceResponse: recordResourceResponse,
    })
    await networkObserver.ready
    page = await context.newPage()
    observeUiReadiness(page)
    page.setDefaultTimeout(scaleTimeout(ACTION_TIMEOUT_MS))
    page.setDefaultNavigationTimeout(scaleTimeout(NAVIGATION_TIMEOUT_MS))

    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.origin === apiUrl.origin
        && request.method() === 'POST'
        && url.pathname === submissionApiPath) {
        submissionRequestCount += 1
        capturedCreateRequest = request
      }
      if (url.origin === apiUrl.origin
        && request.method() === 'POST'
        && url.pathname.includes('/submission/validate-page')) {
        validatePageRequestCount += 1
      }
      if (url.origin === apiUrl.origin
        && request.method() === 'GET'
        && url.pathname === formApiPath) {
        formConfigRequestCount += 1
      }
      if (url.origin === apiUrl.origin
        && request.method() === 'GET'
        && detailApiPathPattern.test(url.pathname)) {
        detailRequestCount += 1
      }
      if (!isApiBusinessRequest(request, apiUrl.origin, apiPathPrefix)) return
      businessRequestCount += 1
      if (request.headers().authorization === authorization) authenticatedRequestCount += 1
      else tokenViolations.push(`${request.method()} ${url.origin}${url.pathname}`)
    })
    page.on('response', (response) => {
      const url = new URL(response.url())
      if (url.origin === apiUrl.origin
        && response.request().method() === 'GET'
        && detailApiPathPattern.test(url.pathname)) {
        detailResponses.push(response)
      }
    })

    networkObserver.setPhase('手动创建页加载')
    const [formResponse] = await Promise.all([
      page.waitForResponse((response) => {
        const url = new URL(response.url())
        return url.origin === apiUrl.origin
          && response.request().method() === 'GET'
          && url.pathname === formApiPath
      }, { timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS) }),
      page.goto(createUrl, { waitUntil: 'domcontentloaded' }),
    ])
    await flowExpect(page, 'Token 生效后不应跳转登录页').not.toHaveURL(/\/login(?:[/?#]|$)/)
    expect(formResponse.ok(), `表单详情接口应返回成功 HTTP 状态，实际 ${formResponse.status()}`).toBe(true)
    await flowExpect(formResponse.ok(), '后续填写依赖表单详情接口 HTTP 成功').toBe(true)
    const formBody = await formResponse.json().catch(() => null)
    expect(formBody && typeof formBody === 'object', '表单详情接口应返回有效 JSON 对象').toBeTruthy()
    await flowExpect(formBody && typeof formBody === 'object', '后续填写依赖有效表单详情 JSON').toBeTruthy()
    const publishedContract = assertPublishedFormContract(
      normalizeAdminFormPayload(formBody),
      formId,
      linkedFormContract,
    )
    const fieldKeys = publishedContract.fieldKeys
    const title = publishedContract.title
    for (const name of [...ROOT_FIELD_NAMES, 'groupUsername', 'groupMobile', 'groupEmail']) {
      await flowExpect(fieldKeys[name], `后续填写依赖 ${name} 的动态 item_key`).toBeTruthy()
    }

    networkObserver.setPhase('创建态结构与空表校验')
    const { createButton } = await assertInitialCreateStructure(page, {
      createUrl,
      title,
      fieldKeys,
      submissionRequestCount: () => submissionRequestCount,
    })
    expect(validatePageRequestCount, '后台单页创建流程不应调用公开端分页校验接口').toBe(0)

    networkObserver.setPhase('单页全题型填写')
    await fillAllFields(page, fieldKeys, data, fixtures, logger)
    expect(submissionRequestCount, '字段填写阶段不得提前发送创建 POST').toBe(0)
    await flowExpect(
      submissionRequestCount,
      '最终创建前若已出现创建 POST，必须立即停止以避免重复创建',
    ).toBe(0)
    expect(validatePageRequestCount, '后台单页填写全程不应调用 validate-page').toBe(0)

    throwIfRunAborted(signal)
    networkObserver.setPhase('创建提报')
    logger('info', '全部题型填写完成，点击一次“创建提报”并等待精确 POST；结果不确定时不会重试')
    const createResponsePromise = page.waitForResponse((response) => isSubmissionCreateMutation(response, {
      origin: apiUrl.origin,
      formId,
      apiPathPrefix,
    }), { timeout: scaleTimeout(ACTION_TIMEOUT_MS) }).catch(() => null)
    await clickWhenReady(createButton)
    // Read one DOM snapshot: navigation can remove the button between separate
    // locator calls, making getAttribute wait for a button that will never return.
    await expect.poll(() => createButton.evaluateAll((buttons) => (
      buttons.length === 0 || buttons.every((button) => (
        button.matches(':disabled') || button.getAttribute('aria-disabled') === 'true'
      ))
    )), { message: '创建请求发出后按钮应禁用或随详情跳转消失', timeout: scaleTimeout(ACTION_TIMEOUT_MS) }).toBe(true)
    const createResponseObject = await createResponsePromise
    expect(createResponseObject, '点击“创建提报”后应发送精确创建 POST 并收到响应').toBeTruthy()
    expect(submissionRequestCount, '空表校验不应误提交，整个流程只允许一次创建 POST').toBe(1)
    await flowExpect(
      submissionRequestCount,
      '创建动作只允许产生一次 POST，出现重复请求时必须停止',
    ).toBe(1)
    expect(validatePageRequestCount, '后台手动创建流程不应调用公开端 validate-page').toBe(0)

    let payloadAssertion = { answerFieldCount: 0, indexedFieldCount: 0 }
    if (capturedCreateRequest) {
      expect(capturedCreateRequest.headers().authorization, '创建提报 POST 必须携带环境 Token').toBe(authorization)
      const requestPayload = parseSubmissionRequestPayload(capturedCreateRequest)
      expect(Number(requestPayload?.revision_no), '创建提报请求 revision_no 应与表单详情一致')
        .toBe(publishedContract.revisionNo)
      const updaterName = requestPayload?.updater_name ?? requestPayload?.answers?.updater_name
      expect(String(updaterName ?? '').trim(), '后台创建提报请求应包含当前操作人 updater_name').not.toBe('')
      payloadAssertion = assertSubmissionPayload(requestPayload, data, publishedContract)
    }

    const createOutcome = createResponseObject
      ? await inspectCreateResponse(createResponseObject)
      : { body: null, succeeded: false, submissionId: '' }
    if (!createResponseObject || !createOutcome.succeeded) {
      await expect(page, '创建失败或结果不确定时不应伪造详情跳转').toHaveURL(createUrl)
      expect(tokenViolations, '所有后台 API 业务请求都必须携带环境 Token').toEqual([])
      expect(authenticatedRequestCount, '至少应观察到一个携带 Token 的后台 API 请求').toBeGreaterThan(0)
      expect(authenticatedRequestCount, '携带 Token 的请求数应等于后台 API 业务请求总数').toBe(businessRequestCount)
      return createOutput({
        formId,
        createUrl,
        title,
        status: createResponseObject ? 'create-failed' : 'create-result-unknown',
        fieldKeys,
        linkedContractUsed: Boolean(linkedFormContract),
        businessRequestCount,
        authenticatedRequestCount,
        submissionRequestCount,
        validatePageRequestCount,
        formConfigRequestCount,
        detailRequestCount,
        assertedAnswerFieldCount: payloadAssertion.answerFieldCount,
        createResponse: createOutcome.body,
      })
    }

    networkObserver.setPhase('创建后详情验证')
    const responseSubmissionId = createOutcome.submissionId
    const expectedDetailUrl = new URL(
      `/form-activity/submission/preview/reply/${encodeURIComponent(responseSubmissionId)}?fid=${encodeURIComponent(formId)}`,
      siteOrigin,
    ).toString()
    await expect(page, '创建成功后应跳转到新提报的精确详情地址').toHaveURL(expectedDetailUrl, {
      timeout: scaleTimeout(NAVIGATION_TIMEOUT_MS),
    })
    const renderedSubmissionId = detailSubmissionId(page.url())
    expect(renderedSubmissionId, '详情 URL 应包含非空的新提报 ID').not.toBe('')
    expect(renderedSubmissionId, '详情 URL 的提报 ID 应与创建接口响应一致').toBe(responseSubmissionId)
    const detailLoaded = page.url() === expectedDetailUrl
    let assertedDetailValueCount = 0
    if (detailLoaded) {
      await expect.poll(() => detailResponses.length, {
        message: '详情态应加载新提报详情接口',
        timeout: scaleTimeout(ACTION_TIMEOUT_MS),
      }).toBeGreaterThan(0)
      for (const response of detailResponses) {
        expect(response.ok(), `新提报详情接口应返回成功 HTTP 状态，实际 ${response.status()}`).toBe(true)
      }
      assertedDetailValueCount = await assertDetailState(page, {
        formId,
        submissionId: responseSubmissionId,
        title,
        data,
        fixtures,
      })
    }

    expect(tokenViolations, '所有后台 API 业务请求都必须携带环境 Token').toEqual([])
    expect(authenticatedRequestCount, '至少应观察到一个携带 Token 的后台 API 请求').toBeGreaterThan(0)
    expect(authenticatedRequestCount, '携带 Token 的请求数应等于后台 API 业务请求总数').toBe(businessRequestCount)
    expect(formConfigRequestCount, '创建页应至少加载一次目标表单详情').toBeGreaterThanOrEqual(1)
    expect(detailRequestCount, '创建成功后应加载一次新提报详情').toBeGreaterThanOrEqual(1)
    logger('success', '后台手动创建提报流程、请求载荷、详情回显和网络鉴权断言执行完成', {
      formId,
      submissionId: responseSubmissionId,
      submissionRequestCount,
      assertedAnswerFieldCount: payloadAssertion.answerFieldCount,
      assertedDetailValueCount,
      businessRequestCount,
      token: '[REDACTED]',
    })

    networkObserver.setPhase('运行结果汇总')
    return createOutput({
      formId,
      submissionId: responseSubmissionId,
      createUrl,
      detailUrl: expectedDetailUrl,
      title,
      status: detailLoaded ? 'submitted' : 'submitted-without-detail',
      fieldKeys,
      linkedContractUsed: Boolean(linkedFormContract),
      businessRequestCount,
      authenticatedRequestCount,
      submissionRequestCount,
      validatePageRequestCount,
      formConfigRequestCount,
      detailRequestCount,
      assertedAnswerFieldCount: payloadAssertion.answerFieldCount,
      assertedDetailValueCount,
      createResponse: createOutcome.body,
    })
  } catch (error) {
    if (signal?.aborted) {
      logger('info', '已响应强制停止，正在清理 Chrome 无头浏览器')
    } else if (captureFailureScreenshot && page) {
      try {
        const screenshot = await screenshotFailure(page, formId, artifactWriter)
        logger('error', '手动创建提报自动化执行失败，已保存当前页面截图', {
          screenshotPath: screenshot.absolutePath,
          artifact: screenshot,
        })
      } catch (screenshotError) {
        logger('error', '手动创建提报自动化执行失败，当前页面截图保存失败', {
          reason: screenshotError instanceof Error ? screenshotError.message : String(screenshotError),
        })
      }
    }
    throw error
  } finally {
    networkObserver.setPhase('结束清理')
    await networkObserver.stop()
    const abortCloseStarted = await stopAbortClose()
    if (!abortCloseStarted) await closePlaywrightHandles({ context, browser }, { logger })
  }
}

export {
  DEFAULT_REQUEST_PATH,
  buildCreateUrl,
  detailSubmissionId,
  inspectCreateResponse,
  isSubmissionCreateMutation,
  normalizeAdminFormPayload,
  normalizeRequestPath,
  resolveCreateContext,
}
