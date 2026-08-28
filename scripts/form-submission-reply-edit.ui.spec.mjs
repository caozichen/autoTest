import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect as hardExpect } from '@playwright/test'

import { attachApiResponseRecorder } from './support/api-response-recorder.mjs'
import { launchGoogleChrome } from './support/google-chrome.mjs'
import { expect } from './support/recorded-expect.mjs'
import {
  closePlaywrightHandles,
  closePlaywrightOnAbort,
  throwIfRunAborted,
} from './playwright-run-control.mjs'

const NAVIGATION_TIMEOUT_MS = 45_000
const ACTION_TIMEOUT_MS = 30_000
const DEFAULT_REQUEST_PATH = '/form-activity/submission/preview/reply/lpXAWZ?fid=lg2bkk'
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIRECTORY = resolve(SCRIPT_DIRECTORY, '..', 'outputs', 'form-submission-reply-edit')

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeRequestPath(value = DEFAULT_REQUEST_PATH) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('提报详情 URL 路径不能为空')
  const requestPath = value.trim()
  if (/^[a-z][a-z\d+.-]*:/i.test(requestPath) || requestPath.startsWith('//')) {
    throw new Error('提报详情 URL 路径必须是相对路径')
  }
  if (/\s/.test(requestPath)) throw new Error('提报详情 URL 路径不能包含空格或换行')
  if (requestPath.includes('\\')) throw new Error('提报详情 URL 路径不能包含反斜杠')
  return requestPath.startsWith('/') ? requestPath : `/${requestPath}`
}

function buildDetailUrl(siteBaseUrl, requestPath = DEFAULT_REQUEST_PATH) {
  const siteOrigin = new URL(siteBaseUrl).origin
  const detailUrl = new URL(normalizeRequestPath(requestPath).replace(/^\/+/, ''), `${siteOrigin}/`)
  if (detailUrl.origin !== siteOrigin) throw new Error('提报详情地址必须与所选环境同源')
  return detailUrl.toString()
}

function parseJsonObject(value, label) {
  if (value === undefined || value === null || value === '') return {}
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch (error) {
      throw new Error(`${label} 不是有效 JSON`, { cause: error })
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} 必须是 JSON 对象`)
  }
  return parsed
}

function normalizeString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 必须是非空字符串`)
  return value.trim()
}

function normalizeFieldReference(value, label) {
  const reference = normalizeString(value, label)
  const occurrenceMatch = reference.match(/^(.*)\[(\d+)]$/)
  if (!occurrenceMatch) return reference
  const fieldLabel = normalizeString(occurrenceMatch[1], label + ' 字段名')
  const occurrence = Number(occurrenceMatch[2])
  if (!Number.isSafeInteger(occurrence) || occurrence < 1) {
    throw new Error(label + ' 的重复字段序号必须是从 1 开始的整数')
  }
  return fieldLabel + '[' + occurrence + ']'
}

function parseFieldReference(reference) {
  const occurrenceMatch = reference.match(/^(.*)\[(\d+)]$/)
  return occurrenceMatch
    ? { label: occurrenceMatch[1], occurrence: Number(occurrenceMatch[2]) }
    : { label: reference, occurrence: null }
}

function normalizeStringList(value, label) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${label} 必须是字符串数组`)
  return value.map((item, index) => normalizeString(item, `${label}[${index}]`))
}

function normalizeFieldAssertions(value) {
  if (value === undefined) return []
  if (Array.isArray(value)) {
    return value.map((label, index) => ({
      label: normalizeFieldReference(label, `SUBMISSION_ASSERTIONS.fields[${index}]`),
    }))
  }
  if (!value || typeof value !== 'object') {
    throw new Error('SUBMISSION_ASSERTIONS.fields 必须是字符串数组或字段值对象')
  }
  return Object.entries(value).map(([label, expectedValue]) => {
    const normalizedLabel = normalizeFieldReference(label, 'SUBMISSION_ASSERTIONS.fields 字段名')
    if (!['string', 'number', 'boolean'].includes(typeof expectedValue)) {
      throw new Error(`SUBMISSION_ASSERTIONS.fields.${normalizedLabel} 必须是字符串、数字或布尔值`)
    }
    return { label: normalizedLabel, expectedText: String(expectedValue) }
  })
}

function normalizeEditFieldAssertions(value) {
  if (value === undefined) return []
  if (Array.isArray(value)) {
    return value.map((label, index) => ({
      label: normalizeFieldReference(label, `SUBMISSION_ASSERTIONS.editFields[${index}]`),
    }))
  }
  if (!value || typeof value !== 'object') {
    throw new Error('SUBMISSION_ASSERTIONS.editFields 必须是字符串数组或字段值对象')
  }
  return Object.entries(value).map(([label, expectedValue]) => {
    const normalizedLabel = normalizeFieldReference(label, 'SUBMISSION_ASSERTIONS.editFields 字段名')
    if (!['string', 'number', 'boolean'].includes(typeof expectedValue)) {
      throw new Error(`SUBMISSION_ASSERTIONS.editFields.${normalizedLabel} 必须是字符串、数字或布尔值`)
    }
    return { label: normalizedLabel, expectedValue: String(expectedValue) }
  })
}

function parseSubmissionAssertions(value) {
  const parsed = parseJsonObject(value, 'SUBMISSION_ASSERTIONS')
  const title = parsed.title === undefined
    ? ''
    : normalizeString(parsed.title, 'SUBMISSION_ASSERTIONS.title')
  const status = parsed.status === undefined
    ? ''
    : normalizeString(parsed.status, 'SUBMISSION_ASSERTIONS.status')
  const texts = normalizeStringList(parsed.texts, 'SUBMISSION_ASSERTIONS.texts')
  const fields = normalizeFieldAssertions(parsed.fields)
  const editFields = normalizeEditFieldAssertions(parsed.editFields)
  const unknownKeys = Object.keys(parsed).filter((key) => (
    !['title', 'status', 'texts', 'fields', 'editFields'].includes(key)
  ))
  if (unknownKeys.length > 0) {
    throw new Error(`SUBMISSION_ASSERTIONS 包含不支持的配置项：${unknownKeys.join(', ')}`)
  }
  return {
    title,
    status,
    texts,
    fields,
    editFields,
    configuredAssertionCount: Number(Boolean(title))
      + Number(Boolean(status))
      + texts.length
      + fields.length
      + editFields.length,
  }
}

function parseSubmissionEditValues(value) {
  const parsed = parseJsonObject(value, 'SUBMISSION_EDIT_VALUES')
  const entries = Object.entries(parsed).map(([field, fieldValue]) => {
    const normalizedField = normalizeFieldReference(field, 'SUBMISSION_EDIT_VALUES 字段名')
    if (!['string', 'number', 'boolean'].includes(typeof fieldValue)) {
      throw new Error(`SUBMISSION_EDIT_VALUES.${normalizedField} 必须是字符串、数字或布尔值`)
    }
    return [normalizedField, String(fieldValue)]
  })
  const normalizedFields = entries.map(([field]) => field)
  if (new Set(normalizedFields).size !== normalizedFields.length) {
    throw new Error('SUBMISSION_EDIT_VALUES 包含重复的字段定位')
  }
  return Object.fromEntries(entries)
}

function resolveSubmissionContext(detailUrl, variables = {}) {
  const url = new URL(detailUrl)
  const pathSegments = url.pathname.split('/').filter(Boolean)
  const replyIndex = pathSegments.lastIndexOf('reply')
  const rawPathSubmissionId = replyIndex >= 0 ? pathSegments[replyIndex + 1] : ''
  const pathSubmissionId = rawPathSubmissionId ? decodeURIComponent(rawPathSubmissionId) : ''
  const queryFormId = String(url.searchParams.get('fid') || '').trim()
  const variableSubmissionId = String(variables.SUBMISSION_ID || '').trim()
  const variableFormId = String(variables.FORM_ID || '').trim()
  if (variableSubmissionId && pathSubmissionId && variableSubmissionId !== pathSubmissionId) {
    throw new Error('SUBMISSION_ID 与提报详情 URL 路径不一致')
  }
  if (variableFormId && queryFormId && variableFormId !== queryFormId) {
    throw new Error('FORM_ID 与提报详情 URL 的 fid 参数不一致')
  }
  const submissionId = pathSubmissionId || variableSubmissionId
  const formId = queryFormId || variableFormId
  if (!submissionId) throw new Error('无法从 SUBMISSION_ID 或提报详情路径解析 submissionId')
  if (!formId) throw new Error('无法从 FORM_ID 或提报详情地址 fid 参数解析 formId')
  return { submissionId, formId }
}

function submissionIdLocator(page, submissionId) {
  const pattern = new RegExp(
    `(?:提報|填报|提交)\\s*ID\\s*[：:]\\s*${escapeRegExp(submissionId)}`,
  )
  return page.getByText(pattern).first()
}

function fieldHeading(page, reference) {
  const { label, occurrence } = parseFieldReference(reference)
  const pattern = new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`)
  const headings = page.locator('.fb-runtime-field-heading').filter({ hasText: pattern })
  return occurrence === null ? headings : headings.nth(occurrence - 1)
}

function detailFieldRow(page, reference) {
  const { label, occurrence } = parseFieldReference(reference)
  const labelPattern = new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`)
  const rows = page.locator('.reply-kv__row').filter({
    has: page.locator('.reply-kv__label').filter({ hasText: labelPattern }),
  })
  return occurrence === null ? rows : rows.nth(occurrence - 1)
}

async function detailFieldValue(row) {
  const value = row.locator('.reply-kv__value')
  return await value.count() === 1 ? value : row
}

function fieldContainerFromHeading(heading) {
  return heading.locator(
    'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " fb-p-4 ")'
      + ' and contains(concat(" ", normalize-space(@class), " "), " fb-px-6 ")][1]',
  )
}

function simpleTextControls(root) {
  return root.locator([
    'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([disabled]):visible',
    'textarea:not([disabled]):visible',
    '[contenteditable="true"]:visible',
  ].join(', '))
}

async function recordAndRequireCount(locator, count, message) {
  await expect(locator, message).toHaveCount(count)
  await hardExpect(locator, message).toHaveCount(count)
}

async function recordAndRequireVisible(locator, message) {
  await expect(locator, message).toBeVisible()
  await hardExpect(locator, message).toBeVisible()
}

async function recordAndRequireEnabled(locator, message) {
  await expect(locator, message).toBeEnabled()
  await hardExpect(locator, message).toBeEnabled()
}

async function recordAndRequireText(locator, expectedText, message) {
  await expect(locator, message).toContainText(expectedText)
  await hardExpect(locator, message).toContainText(expectedText)
}

function actionableButton(page, namePattern) {
  return page
    .locator('button:visible:not([disabled]):not([aria-disabled="true"])')
    .filter({ hasText: namePattern })
}

async function assertInitialDetailStructure(page, {
  submissionId,
  assertions,
  verifyConfiguredAssertions = true,
}) {
  const title = page.getByRole('heading', { level: 2 }).first()
  await recordAndRequireVisible(title, '提报详情初始态应显示 h2 标题')
  await recordAndRequireVisible(
    submissionIdLocator(page, submissionId),
    `提报详情初始态应显示提报 ID：${submissionId}`,
  )
  await recordAndRequireVisible(
    page.getByText(/^(?:已提交|已提交成功)$/).first(),
    '提报详情初始态应显示“已提交”状态',
  )
  await recordAndRequireVisible(
    page.getByRole('heading', { level: 3, name: /^(?:提報資訊|填报信息|提报信息)$/ }).first(),
    '提报详情初始态应显示“提报信息”分区',
  )
  const editButton = page.getByRole('button', { name: /^(?:编辑|編輯)$/ })
  await recordAndRequireCount(editButton, 1, '提报详情初始态应唯一显示“编辑”按钮')
  await recordAndRequireVisible(editButton, '提报详情初始态的“编辑”按钮应可见')
  await recordAndRequireEnabled(editButton, '提报详情初始态的“编辑”按钮应可用')
  await recordAndRequireCount(
    actionableButton(page, /^(?:\s*)(?:取消编辑|取消編輯)(?:\s*)$/),
    0,
    '提报详情初始态不应存在可操作的“取消编辑”按钮',
  )
  await recordAndRequireCount(
    actionableButton(page, /^\s*提交\s*$/),
    0,
    '提报详情初始态不应存在可操作的“提交”按钮',
  )

  if (verifyConfiguredAssertions && assertions.title) {
    await recordAndRequireText(title, assertions.title, '提报详情标题应匹配 SUBMISSION_ASSERTIONS.title')
  }
  if (verifyConfiguredAssertions && assertions.status) {
    await recordAndRequireVisible(
      page.getByText(assertions.status, { exact: true }).first(),
      '提报详情状态应匹配 SUBMISSION_ASSERTIONS.status',
    )
  }
  for (const text of verifyConfiguredAssertions ? assertions.texts : []) {
    await recordAndRequireVisible(
      page.getByText(text, { exact: true }).first(),
      `提报详情应显示配置文本“${text}”`,
    )
  }
  for (const field of verifyConfiguredAssertions ? assertions.fields : []) {
    const replyRows = detailFieldRow(page, field.label)
    const useReplyRow = await replyRows.count() > 0
    const fieldTarget = useReplyRow ? replyRows : fieldHeading(page, field.label)
    const fieldContainer = useReplyRow
      ? await detailFieldValue(replyRows)
      : fieldContainerFromHeading(fieldTarget)
    await recordAndRequireCount(fieldTarget, 1, `提报详情应唯一显示字段“${field.label}”`)
    await recordAndRequireVisible(fieldTarget, `提报详情字段“${field.label}”应可见`)
    if (field.expectedText !== undefined) {
      await recordAndRequireVisible(fieldContainer, `提报详情字段“${field.label}”容器应可见`)
      await recordAndRequireText(
        fieldContainer,
        field.expectedText,
        `提报详情字段“${field.label}”应显示配置值`,
      )
    }
  }
  return editButton
}

async function resolveEditableControl(page, field) {
  const { label, occurrence } = parseFieldReference(field)
  const keyedRoot = page.locator(`[data-item-key=${JSON.stringify(field)}]`)
  if (await keyedRoot.count() === 1) {
    const controls = simpleTextControls(keyedRoot)
    if (await controls.count() > 0) return controls.first()
  }

  const heading = fieldHeading(page, field)
  if (await heading.count() === 1) {
    const container = fieldContainerFromHeading(heading)
    const controls = simpleTextControls(container)
    if (await controls.count() > 0) return controls.first()
  }

  const labelledMatches = page.getByLabel(label, { exact: true })
  const labelled = occurrence === null ? labelledMatches : labelledMatches.nth(occurrence - 1)
  if (await labelled.count() === 1 && await labelled.isVisible().catch(() => false)) return labelled

  const named = page.locator(`[name=${JSON.stringify(field)}]:visible`)
  if (await named.count() === 1) return named

  const placeholderMatches = page.getByPlaceholder(new RegExp(
    `^(?:(?:请|請)输入)?${escapeRegExp(label)}$`,
  ))
  const placeholder = occurrence === null
    ? placeholderMatches
    : placeholderMatches.nth(occurrence - 1)
  if (await placeholder.count() === 1 && await placeholder.isVisible().catch(() => false)) {
    return placeholder
  }
  throw new Error(`编辑态未找到字段“${field}”对应的唯一简单文本控件`)
}

async function assertEditStructure(page, editFields) {
  const cancelButton = page.getByRole('button', { name: /^(?:取消编辑|取消編輯)$/ })
  const submitButton = page.getByRole('button', { name: /^提交$/ })
  await recordAndRequireCount(cancelButton, 1, '编辑态应唯一显示“取消编辑”按钮')
  await recordAndRequireVisible(cancelButton, '编辑态“取消编辑”按钮应可见')
  await recordAndRequireCount(submitButton, 1, '编辑态应唯一显示“提交”按钮')
  await recordAndRequireVisible(submitButton, '编辑态“提交”按钮应可见')
  await recordAndRequireEnabled(submitButton, '编辑态“提交”按钮应可用')

  const editHeadings = page.locator('.fb-runtime-field-heading')
  await expect(editHeadings, '编辑态应至少显示一个字段标题').not.toHaveCount(0)
  await hardExpect(editHeadings, '编辑态应至少显示一个字段标题').not.toHaveCount(0)
  const editableControls = simpleTextControls(page.locator('.fb-p-4.fb-px-6'))
  await expect(editableControls, '编辑态应至少显示一个可编辑的简单文本控件').not.toHaveCount(0)
  await hardExpect(editableControls, '编辑态应至少显示一个可编辑的简单文本控件').not.toHaveCount(0)
  for (const field of editFields) {
    const control = await resolveEditableControl(page, field.label)
    await recordAndRequireVisible(control, `编辑态字段“${field.label}”应显示可编辑控件`)
    await recordAndRequireEnabled(control, `编辑态字段“${field.label}”控件应可用`)
    if (field.expectedValue !== undefined) {
      const tagName = await control.evaluate((element) => element.tagName.toLowerCase())
      if (tagName === 'input' || tagName === 'textarea') {
        await expect(control, `编辑态字段“${field.label}”初始值应匹配配置`).toHaveValue(field.expectedValue)
        await hardExpect(control, `编辑态字段“${field.label}”初始值应匹配配置`).toHaveValue(field.expectedValue)
      } else {
        await expect(control, `编辑态字段“${field.label}”初始文本应匹配配置`).toHaveText(field.expectedValue)
        await hardExpect(control, `编辑态字段“${field.label}”初始文本应匹配配置`).toHaveText(field.expectedValue)
      }
    }
  }
  return { cancelButton, submitButton }
}

async function applyEditValues(page, editValues) {
  const appliedEditFields = []
  for (const [field, value] of Object.entries(editValues)) {
    const control = await resolveEditableControl(page, field)
    await recordAndRequireVisible(control, `待修改字段“${field}”应显示简单文本控件`)
    await hardExpect(control, `待修改字段“${field}”控件应可用`).toBeEnabled()
    await control.fill(value)
    const tagName = await control.evaluate((element) => element.tagName.toLowerCase())
    if (tagName === 'input' || tagName === 'textarea') {
      await expect(control, `字段“${field}”应回显修改值`).toHaveValue(value)
      await hardExpect(control, `字段“${field}”应回显修改值`).toHaveValue(value)
    } else {
      await expect(control, `字段“${field}”应回显修改值`).toHaveText(value)
      await hardExpect(control, `字段“${field}”应回显修改值`).toHaveText(value)
    }
    appliedEditFields.push(field)
  }
  return appliedEditFields
}

async function assertAppliedDetailValues(page, editValues) {
  for (const [field, value] of Object.entries(editValues)) {
    const row = detailFieldRow(page, field)
    await recordAndRequireCount(row, 1, `提交成功后详情态应唯一显示字段“${field}”`)
    await recordAndRequireVisible(row, `提交成功后详情态字段“${field}”应可见`)
    await recordAndRequireText(
      await detailFieldValue(row),
      value,
      `提交成功后详情态字段“${field}”应回显修改值`,
    )
  }
}

function isSubmissionMutation(response, { origin, formId, submissionId }) {
  const request = response.request()
  const method = request.method().toUpperCase()
  if (method !== 'PUT') return false
  const url = new URL(response.url())
  if (url.origin !== origin) return false
  const exactSuffix = `/be/form/${encodeURIComponent(formId)}/submission/${encodeURIComponent(submissionId)}`
  return url.pathname.endsWith(exactSuffix)
}

async function assertSuccessfulMutationResponse(response) {
  if (!response.ok()) throw new Error(`保存提报修改接口返回 HTTP ${response.status()}`)
  const responseText = await response.text().catch(() => '')
  if (!responseText.trim()) return null
  let body
  try {
    body = JSON.parse(responseText)
  } catch (error) {
    throw new Error('保存提报修改接口未返回有效 JSON', { cause: error })
  }
  if (!body || typeof body !== 'object') throw new Error('保存提报修改接口返回的 JSON 结构无效')
  if (Object.prototype.hasOwnProperty.call(body, 'code') && Number(body.code) !== 0) {
    throw new Error(`保存提报修改接口业务码异常：${body.code}`)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'success') && body.success !== true) {
    throw new Error('保存提报修改接口未返回成功状态')
  }
  return body
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

async function screenshotFailure(page, submissionId) {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true })
  const safeId = submissionId.replace(/[^a-zA-Z0-9_-]+/g, '_')
  const screenshotPath = resolve(OUTPUT_DIRECTORY, `${safeId || 'unknown'}-编辑失败-${Date.now()}.png`)
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined)
  return screenshotPath
}

export async function run({
  siteBaseUrl,
  apiBaseUrl,
  requestPath = DEFAULT_REQUEST_PATH,
  variables = {},
  extraHTTPHeaders,
  ignoreHTTPSErrors = false,
  signal,
  logger,
  recordApiResponse,
  captureFailureScreenshot = true,
}) {
  if (!siteBaseUrl) throw new Error('运行环境必须提供 Web 基址')
  if (!apiBaseUrl) throw new Error('运行环境必须提供 API 基址')
  const authorization = extraHTTPHeaders?.Authorization
  if (!authorization) throw new Error('提报编辑必须使用环境登录后的 Token')

  const detailUrl = buildDetailUrl(siteBaseUrl, requestPath)
  const siteOrigin = new URL(siteBaseUrl).origin
  const apiUrl = new URL(apiBaseUrl)
  if (apiUrl.origin !== siteOrigin) throw new Error('Web 基址与 API 基址必须同源')
  const apiPathPrefix = apiUrl.pathname.replace(/\/+$/, '') || '/'
  const { submissionId, formId } = resolveSubmissionContext(detailUrl, variables)
  const assertions = parseSubmissionAssertions(variables.SUBMISSION_ASSERTIONS)
  const editValues = parseSubmissionEditValues(variables.SUBMISSION_EDIT_VALUES)

  let browser
  let context
  let page
  let stopAbortClose = () => undefined
  let stopApiResponseRecorder = async () => undefined
  try {
    throwIfRunAborted(signal)
    logger('info', '启动 Google Chrome 无头浏览器，打开提报详情页', {
      browser: 'Google Chrome',
      headless: true,
      submissionId,
      formId,
      detailUrl,
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
    throwIfRunAborted(signal)
    page = await context.newPage()
    stopApiResponseRecorder = attachApiResponseRecorder(page, {
      onApiResponse: recordApiResponse,
      shouldRecord: ({ url }) => url.origin === apiUrl.origin,
    })
    page.setDefaultTimeout(ACTION_TIMEOUT_MS)
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS)

    let businessRequestCount = 0
    let authenticatedRequestCount = 0
    const tokenViolations = []
    page.on('request', (request) => {
      if (!isApiBusinessRequest(request, apiUrl.origin, apiPathPrefix)) return
      businessRequestCount += 1
      if (request.headers().authorization === authorization) {
        authenticatedRequestCount += 1
      } else {
        const url = new URL(request.url())
        tokenViolations.push(`${request.method()} ${url.origin}${url.pathname}`)
      }
    })

    await page.goto(detailUrl, { waitUntil: 'domcontentloaded' })
    await hardExpect(page, 'Token 生效后不应跳转登录页').not.toHaveURL(/\/login(?:[/?#]|$)/)
    const editButton = await assertInitialDetailStructure(page, { submissionId, assertions })

    logger('info', '提报详情初始态断言通过，进入编辑态')
    await editButton.click()
    const { submitButton } = await assertEditStructure(page, assertions.editFields)
    const appliedEditFields = await applyEditValues(page, editValues)

    throwIfRunAborted(signal)
    logger('info', '编辑态结构和字段值断言通过，提交提报修改', { appliedEditFields })
    const updateResponsePromise = page.waitForResponse((response) => isSubmissionMutation(response, {
      origin: apiUrl.origin,
      formId,
      submissionId,
    }), { timeout: ACTION_TIMEOUT_MS })
    await submitButton.click()
    const updateResponseObject = await updateResponsePromise
    const updateResponse = await assertSuccessfulMutationResponse(updateResponseObject)
    await hardExpect(
      updateResponseObject.request().headers().authorization,
      '保存提报修改请求必须携带环境 Token',
    ).toBe(authorization)

    await assertInitialDetailStructure(page, {
      submissionId,
      assertions,
      verifyConfiguredAssertions: false,
    })
    await assertAppliedDetailValues(page, editValues)
    expect(tokenViolations, '所有 API 业务请求都必须携带环境 Token').toEqual([])
    hardExpect(tokenViolations, '所有 API 业务请求都必须携带环境 Token').toEqual([])
    expect(authenticatedRequestCount, '至少应观察到一个携带 Token 的 API 业务请求').toBeGreaterThan(0)
    hardExpect(authenticatedRequestCount, '至少应观察到一个携带 Token 的 API 业务请求').toBeGreaterThan(0)
    expect(authenticatedRequestCount, '携带 Token 的请求数应等于全部 API 业务请求数').toBe(businessRequestCount)
    hardExpect(authenticatedRequestCount, '携带 Token 的请求数应等于全部 API 业务请求数').toBe(businessRequestCount)
    logger('success', '提报修改已提交，页面恢复详情态', {
      submissionId,
      formId,
      appliedEditFields,
      businessRequestCount,
    })

    return {
      submissionId,
      formId,
      detailUrl,
      submitted: true,
      appliedEditFields,
      configuredAssertionCount: assertions.configuredAssertionCount,
      updateResponse,
    }
  } catch (error) {
    if (signal?.aborted) {
      logger('info', '已响应强制停止，正在清理 Chrome 无头浏览器')
    } else if (captureFailureScreenshot && page) {
      const screenshotPath = await screenshotFailure(page, submissionId)
      logger('error', '提报详情编辑自动化执行失败，已保存当前页面截图', { screenshotPath })
    } else {
      logger('error', '提报详情编辑自动化执行失败（测试模式未输出失败截图）')
    }
    throw error
  } finally {
    await stopApiResponseRecorder()
    const abortCloseStarted = await stopAbortClose()
    if (!abortCloseStarted) await closePlaywrightHandles({ context, browser }, { logger })
  }
}

export {
  DEFAULT_REQUEST_PATH,
  buildDetailUrl,
  isSubmissionMutation,
  normalizeRequestPath,
  parseSubmissionAssertions,
  parseSubmissionEditValues,
  resolveSubmissionContext,
}
